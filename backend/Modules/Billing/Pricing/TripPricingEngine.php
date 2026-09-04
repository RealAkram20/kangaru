<?php

namespace Modules\Billing\Pricing;

use App\Support\Money\Shillings;
use Brick\Money\Money;
use Modules\Billing\Enums\InvoiceLineType;
use Modules\Billing\Models\PricedRate;
use Modules\Billing\Models\RateCardVersion;
use Modules\Trips\Models\Trip;

/**
 * Turns a completed trip and a rate card version into priced invoice lines.
 *
 * Pure: it reads, it computes, it writes nothing. That is what lets the
 * pricing tests assert on shillings without a single invoice existing, and
 * what lets a future "preview this trip's charge" screen reuse it without
 * risking a stray invoice.
 *
 * Every amount here is a Brick\Money\Money from the moment it leaves the
 * rate card until it is handed back. There is no integer arithmetic on
 * money in this file, which is AGENTS.md's rule stated as a property of the
 * code rather than a promise in a comment.
 *
 * The order of operations is fixed and is the invoice's own reading order:
 *
 *   1. base fare      x night multiplier
 *   2. distance       x night multiplier
 *   3. waiting time   (never multiplied — see below)
 *   4. minimum or maximum charge adjustment against the sum of 1-3
 *
 * ## Where the zone fits (ADR-0021, billing half)
 *
 * The zone is resolved once, before anything is priced, and its only effect
 * is to **choose which rate row supplies the unit amounts**. There is no
 * zone line, no zone multiplier and no second arithmetic path: a zone rate
 * is a complete price, so every line below reads its unit from `$rate`
 * without knowing or caring which kind of rate it got.
 *
 * That is why zone pricing changes four line descriptions and one lookup
 * and nothing else. A surcharge line or a second multiplier would have
 * needed a new line type, a new column, and a second definition of how an
 * amount is computed — and `InvoiceLine::computeAmount()` being the single
 * definition is what makes an invoice reproducible.
 */
class TripPricingEngine
{
    public function __construct(
        private readonly WaitingTimeCalculator $waiting,
        private readonly TripZoneResolver $zones,
    ) {}

    /**
     * @throws RateCardNotConfiguredException the version does not price this vehicle's category
     */
    public function price(Trip $trip, RateCardVersion $version): TripPrice
    {
        $vehicle = $trip->vehicle;

        // A trip always has a vehicle — `trips.vehicle_id` is non-nullable
        // and restrictOnDelete — so a null here means the row was loaded
        // without the relation, not that the journey had no vehicle.
        // Pricing without knowing the category would silently bill the
        // wrong rate, so it stops instead.
        if ($vehicle === null) {
            throw new \LogicException(
                "Trip #{$trip->id} was priced without its vehicle loaded; the vehicle category decides the rate."
            );
        }

        $category = $vehicle->category;

        // Null here is a real answer meaning "price at the default rate",
        // not a failure — see TripZoneResolver. It never suppresses the
        // refusal below, which is about the category being unpriced.
        $rate = $version->rateFor($category, $this->zones->pricingZoneFor($trip));

        if ($rate === null) {
            throw RateCardNotConfiguredException::categoryNotPriced(
                $version->rateCard->name,
                $version->version,
                $category,
            );
        }

        $multiplierBp = $this->multiplierFor($trip, $version);

        $lines = $this->chargeLines($trip, $version, $rate, $category, $multiplierBp);
        $adjustment = $this->chargeCapAdjustment($lines, $rate, $version, $category);

        if ($adjustment !== null) {
            $lines[] = $adjustment;
        }

        return new TripPrice($version, $lines);
    }

    /**
     * Base fare, distance, and waiting time.
     *
     * Base fare and distance are always present on a completed trip, even
     * at zero — an invoice that silently omits a line is one a client
     * cannot check against their rate card. Waiting appears only when there
     * is billable waiting time, because "Waiting: 0 minutes" on a trip that
     * never stopped is noise rather than evidence.
     *
     * @return array<int, PricedLine>
     */
    private function chargeLines(
        Trip $trip,
        RateCardVersion $version,
        PricedRate $rate,
        string $category,
        int $multiplierBp,
    ): array {
        // The resolver's figure when it has one (ADR-0045): the measured
        // trace, or the odometer held inside the road's corridor, according
        // to the version's `distance_policy`. Falls back to `distance_km` —
        // the odometer delta — for a trip the resolver has not answered for,
        // which under the odometer policy is the same figure, and for the
        // unsaved trips the walk-in quote and the provisional fare price
        // through here. `DistanceGate` is what stops a trace-priced contract
        // billing an unresolved trip; this line does not judge, it reads.
        $distanceKm = (string) ($trip->billed_distance_km ?? $trip->distance_km ?? '0.00');
        $night = $multiplierBp !== RateCardVersion::NO_MULTIPLIER_BP;
        $zone = $rate->pricingZoneName();

        $lines = [
            new PricedLine(
                type: InvoiceLineType::BASE_FARE,
                description: $this->describe('Base fare', [$zone, $night ? 'night rate' : null]),
                quantity: '1.00',
                unitAmount: $rate->baseFare(),
                rounding: $version->rounding_mode,
                rateCardVersionId: $version->id,
                vehicleCategory: $category,
                multiplierBp: $multiplierBp,
                zone: $zone,
                zoneId: $rate->pricingZoneId(),
            ),
            new PricedLine(
                type: InvoiceLineType::DISTANCE,
                description: $this->describe('Distance travelled', [
                    sprintf('%s km', $distanceKm),
                    $zone,
                    $night ? 'night rate' : null,
                ]),
                quantity: $distanceKm,
                unitAmount: $rate->perKilometre(),
                rounding: $version->rounding_mode,
                rateCardVersionId: $version->id,
                vehicleCategory: $category,
                multiplierBp: $multiplierBp,
                distanceKm: $distanceKm,
                zone: $zone,
                zoneId: $rate->pricingZoneId(),
            ),
        ];

        $billableMinutes = $this->billableWaitingMinutes($trip, $version);

        if ($billableMinutes > 0) {
            $lines[] = new PricedLine(
                type: InvoiceLineType::WAITING,
                description: $this->describe('Waiting time', [
                    sprintf('%d min billable', $billableMinutes),
                    sprintf('%d min included', $version->free_waiting_minutes),
                    $zone,
                ]),
                quantity: sprintf('%d.00', $billableMinutes),
                unitAmount: $rate->perWaitingMinute(),
                rounding: $version->rounding_mode,
                rateCardVersionId: $version->id,
                vehicleCategory: $category,
                // Waiting is deliberately never multiplied by the night
                // rate. The night rate prices the journey being driven at
                // an unsociable hour; a vehicle standing still costs the
                // same per minute whenever it happens, and charging a
                // surcharge on top of a per-minute charge is the kind of
                // double-counting a client queries.
                //
                // A zone, by contrast, does reach this line: the zone rate
                // carries its own per-waiting-minute price, because standing
                // still upcountry with a vehicle that has to get home is not
                // the same cost as standing still in town. That is a rate,
                // not a surcharge stacked on one.
                multiplierBp: RateCardVersion::NO_MULTIPLIER_BP,
                waitingMinutes: $billableMinutes,
                zone: $zone,
                zoneId: $rate->pricingZoneId(),
            );
        }

        return $lines;
    }

    /**
     * One line's wording: a label, then the qualifiers that apply to it in
     * parentheses.
     *
     * Shared by all four line types so a zone, a night rate and a distance
     * are punctuated the same way wherever they appear — the repo's rule
     * that when two places format the same string they share one function.
     *
     * With no qualifiers this returns the bare label, so a rate card with no
     * zones and no night rate produces exactly the wording it always has.
     * Descriptions are rendered once, at issue time, onto a document that
     * must never change afterwards.
     *
     * @param  array<int, string|null>  $qualifiers  nulls are the ones that do not apply
     */
    private function describe(string $label, array $qualifiers): string
    {
        $applicable = array_filter($qualifiers, fn (?string $q) => $q !== null && $q !== '');

        return $applicable === []
            ? $label
            : sprintf('%s (%s)', $label, implode(', ', $applicable));
    }

    /**
     * Billable minutes: what the timeline says, less the version's free
     * allowance, floored at zero.
     */
    private function billableWaitingMinutes(Trip $trip, RateCardVersion $version): int
    {
        return max(0, $this->waiting->minutesFor($trip) - $version->free_waiting_minutes);
    }

    /**
     * The line that lifts a small charge to the rate card's minimum or
     * caps a large one at its maximum.
     *
     * Expressed as a line rather than by overwriting the total, so the
     * arithmetic on the issued invoice still adds up and the client can see
     * exactly which rule moved the number. Minimum is checked first: if a
     * rate card ever had a minimum above its maximum the minimum would win,
     * so StoreRateCardVersionRequest refuses that combination at the door.
     *
     * @param  array<int, PricedLine>  $lines
     */
    private function chargeCapAdjustment(
        array $lines,
        PricedRate $rate,
        RateCardVersion $version,
        string $category,
    ): ?PricedLine {
        $subtotal = $this->subtotal($lines);
        $minimum = $rate->minimumCharge();
        $maximum = $rate->maximumCharge();
        $zone = $rate->pricingZoneName();

        if ($subtotal->isLessThan($minimum)) {
            return $this->adjustment(
                InvoiceLineType::MINIMUM_CHARGE_ADJUSTMENT,
                $this->describe('Minimum charge adjustment', [
                    sprintf('minimum %s', $minimum->getAmount()),
                    $zone,
                ]),
                $minimum->minus($subtotal),
                $version,
                $category,
                $rate,
            );
        }

        if ($maximum !== null && $subtotal->isGreaterThan($maximum)) {
            return $this->adjustment(
                InvoiceLineType::MAXIMUM_CHARGE_ADJUSTMENT,
                $this->describe('Maximum charge adjustment', [
                    sprintf('capped at %s', $maximum->getAmount()),
                    $zone,
                ]),
                // Negative: this line takes money off.
                $maximum->minus($subtotal),
                $version,
                $category,
                $rate,
            );
        }

        return null;
    }

    /**
     * The figure the minimum and maximum are compared against: the sum of
     * the chargeable lines only. An adjustment must never be part of the
     * subtotal it was derived from.
     *
     * @param  array<int, PricedLine>  $lines
     */
    private function subtotal(array $lines): Money
    {
        return array_reduce(
            array_filter($lines, fn (PricedLine $line) => $line->type->isChargeable()),
            fn (Money $carry, PricedLine $line) => $carry->plus($line->amount),
            Shillings::zero(),
        );
    }

    private function adjustment(
        InvoiceLineType $type,
        string $description,
        Money $amount,
        RateCardVersion $version,
        string $category,
        PricedRate $rate,
    ): PricedLine {
        return new PricedLine(
            type: $type,
            description: $description,
            quantity: '1.00',
            unitAmount: $amount,
            rounding: $version->rounding_mode,
            rateCardVersionId: $version->id,
            vehicleCategory: $category,
            // The adjustment came from this rate's own minimum or maximum,
            // so it records the same zone as the lines it adjusts. An
            // adjustment line with no zone beside four that have one would
            // read as a charge from somewhere else.
            zone: $rate->pricingZoneName(),
            zoneId: $rate->pricingZoneId(),
        );
    }

    /**
     * Whether the rate card's night multiplier applies to this trip,
     * decided by when the journey started in the billing timezone
     * (config/billing.php) — not UTC, in which "22:00 to 06:00" would mean
     * a window three hours out of step with the driver.
     *
     * Windows that wrap midnight are the normal case, so they are handled
     * explicitly rather than treated as a misconfiguration.
     */
    private function multiplierFor(Trip $trip, RateCardVersion $version): int
    {
        if (! $version->hasNightRate() || $trip->started_at === null) {
            return RateCardVersion::NO_MULTIPLIER_BP;
        }

        /** @var string $timezone */
        $timezone = config('billing.timezone', 'Africa/Kampala');

        $startedAt = $trip->started_at->copy()->setTimezone($timezone)->format('H:i:s');
        $from = (string) $version->night_starts_at;
        $until = (string) $version->night_ends_at;

        // 'HH:MM:SS' strings compare correctly lexicographically, so no
        // date arithmetic is needed to answer a time-of-day question.
        $inWindow = $from <= $until
            ? ($startedAt >= $from && $startedAt < $until)
            : ($startedAt >= $from || $startedAt < $until);

        return $inWindow ? $version->night_multiplier_bp : RateCardVersion::NO_MULTIPLIER_BP;
    }
}
