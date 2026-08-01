<?php

namespace Modules\Billing\Pricing;

use App\Support\Money\Shillings;
use Brick\Money\Money;
use Modules\Billing\Enums\InvoiceLineType;
use Modules\Billing\Models\RateCardRate;
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
 */
class TripPricingEngine
{
    public function __construct(private readonly WaitingTimeCalculator $waiting) {}

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
        $rate = $version->rateFor($category);

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
        RateCardRate $rate,
        string $category,
        int $multiplierBp,
    ): array {
        $distanceKm = (string) ($trip->distance_km ?? '0.00');
        $night = $multiplierBp !== RateCardVersion::NO_MULTIPLIER_BP;

        $lines = [
            new PricedLine(
                type: InvoiceLineType::BASE_FARE,
                description: $night ? 'Base fare (night rate)' : 'Base fare',
                quantity: '1.00',
                unitAmount: $rate->baseFare(),
                rounding: $version->rounding_mode,
                rateCardVersionId: $version->id,
                vehicleCategory: $category,
                multiplierBp: $multiplierBp,
            ),
            new PricedLine(
                type: InvoiceLineType::DISTANCE,
                description: $night
                    ? sprintf('Distance travelled (%s km, night rate)', $distanceKm)
                    : sprintf('Distance travelled (%s km)', $distanceKm),
                quantity: $distanceKm,
                unitAmount: $rate->perKilometre(),
                rounding: $version->rounding_mode,
                rateCardVersionId: $version->id,
                vehicleCategory: $category,
                multiplierBp: $multiplierBp,
                distanceKm: $distanceKm,
            ),
        ];

        $billableMinutes = $this->billableWaitingMinutes($trip, $version);

        if ($billableMinutes > 0) {
            $lines[] = new PricedLine(
                type: InvoiceLineType::WAITING,
                description: sprintf(
                    'Waiting time (%d min billable, %d min included)',
                    $billableMinutes,
                    $version->free_waiting_minutes,
                ),
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
                multiplierBp: RateCardVersion::NO_MULTIPLIER_BP,
                waitingMinutes: $billableMinutes,
            );
        }

        return $lines;
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
        RateCardRate $rate,
        RateCardVersion $version,
        string $category,
    ): ?PricedLine {
        $subtotal = $this->subtotal($lines);
        $minimum = $rate->minimumCharge();
        $maximum = $rate->maximumCharge();

        if ($subtotal->isLessThan($minimum)) {
            return $this->adjustment(
                InvoiceLineType::MINIMUM_CHARGE_ADJUSTMENT,
                sprintf('Minimum charge adjustment (minimum %s)', $minimum->getAmount()),
                $minimum->minus($subtotal),
                $version,
                $category,
            );
        }

        if ($maximum !== null && $subtotal->isGreaterThan($maximum)) {
            return $this->adjustment(
                InvoiceLineType::MAXIMUM_CHARGE_ADJUSTMENT,
                sprintf('Maximum charge adjustment (capped at %s)', $maximum->getAmount()),
                // Negative: this line takes money off.
                $maximum->minus($subtotal),
                $version,
                $category,
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
    ): PricedLine {
        return new PricedLine(
            type: $type,
            description: $description,
            quantity: '1.00',
            unitAmount: $amount,
            rounding: $version->rounding_mode,
            rateCardVersionId: $version->id,
            vehicleCategory: $category,
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
