<?php

namespace Modules\Billing\Services;

use App\Support\Money\Shillings;
use Modules\Billing\Pricing\DistanceGate;
use Modules\Billing\Pricing\RateCardNotConfiguredException;
use Modules\Billing\Pricing\RateCardResolver;
use Modules\Billing\Pricing\TripPricingEngine;
use Modules\Dispatch\Support\GreatCircle;
use Modules\Trips\Distance\DistancePolicy;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * What a walk-in ride costs (ADR-0026).
 *
 * Two questions, asked at two different moments, and the difference between
 * them is the whole of §2:
 *
 * - **`quote()`** — before the ride, when there is no trip and no route.
 *   Great-circle distance between two points, and it is an *estimate* in
 *   every place it surfaces.
 * - **`settle()`** — after it, from the distance the trip actually
 *   travelled, which `TripStateMachine` computed from the odometer and
 *   reconciled against GPS. That is evidence, and it is what is charged.
 *
 * Neither writes an invoice. `invoices` answers "what does this client owe"
 * and `InvoiceService` already refuses a walk-in trip by name; a cash fare
 * in a taxi is not an invoice, and settlement — who collected it, in what
 * form — stays deferred (ADR-0026 §3).
 */
class WalkInFareService
{
    public function __construct(
        private readonly RateCardResolver $rateCards,
        private readonly TripPricingEngine $pricing,
        private readonly DistanceGate $distances,
    ) {}

    /**
     * Prices a completed walk-in trip and records the total on it.
     *
     * Idempotent: a trip already priced keeps its original fare and its
     * original rate card version. Re-pricing would silently re-quote a
     * finished journey against whatever the tariff says today, and the
     * passenger has already paid — the same immutability
     * `RateCardVersion` gives an invoice, applied to the thing that stands
     * in for one.
     *
     * @throws RateCardNotConfiguredException no public tariff, or none priced this category
     */
    public function settle(Trip $trip): Trip
    {
        if ($trip->fare_minor !== null) {
            return $trip;
        }

        // The vehicle decides the rate, so pricing without it would bill the
        // wrong category — `TripPricingEngine` refuses outright if the
        // relation is missing, and loading it here is cheaper than the
        // exception.
        $trip->loadMissing('vehicle');

        $version = $this->rateCards->resolveFor($trip);

        // ADR-0045 §2: a trace-priced tariff does not settle an unresolved
        // trip, and no tariff settles a held one. Thrown, not swallowed — the
        // listener decides what "not yet" means for a cash ride.
        $this->distances->assertBillable($trip, $version);

        $price = $this->pricing->price($trip, $version);

        $trip->forceFill([
            // `Shillings::toMinor`, not the Money object: `trips.fare_minor`
            // is a plain integer column, unlike `invoices.total_minor`
            // which carries a MoneyMinorCast. Handing a Money to an
            // uncast column is how a total ends up stored as a
            // stringified object.
            'fare_minor' => Shillings::toMinor($price->total()),
            'fare_currency' => $version->currency,
            // What priced it, so the amount can be re-derived years later.
            // A total with no version behind it is a number nobody can
            // defend when somebody disputes it.
            'fare_rate_card_version_id' => $version->id,
            'fare_computed_at' => now(),
        ])->save();

        return $trip;
    }

    /**
     * The fare the driver shows at the kerb, before the resolver has spoken
     * (ADR-0045 §5; Phase 2 of `docs/measured-distance-plan.md`).
     *
     * A walk-in fare is settled after the trip's distance is resolved — a
     * grace period and a queue hop after Trip Completed — but a cash
     * passenger pays now. So this prices, at completion and through the same
     * engine, the distance the tariff *will* bill on as best it can be known
     * at the kerb: under the `odometer` policy the odometer delta (which is
     * exactly what will settle); under a trace policy the handset's own
     * measurement of its buffered pings, sent with the completion, and the
     * odometer delta if it sent none.
     *
     * Recorded on the trip as `fare_provisional_minor` and never overwritten:
     * it is what the passenger was shown and what the driver took, and the
     * ledger records it as the cash collected for that reason. The settled
     * fare lands beside it, and a difference is a visible fact rather than a
     * silent restatement.
     *
     * Idempotent, and quiet on a tariff problem for the same reason
     * `SettleWalkInFare` is: the trip still completes.
     */
    public function priceProvisional(Trip $trip): Trip
    {
        if ($trip->fare_provisional_minor !== null || $trip->fare_minor !== null) {
            return $trip;
        }

        $trip->loadMissing('vehicle');

        $version = $this->rateCards->resolveFor($trip);

        $distanceKm = $version->distance_policy === DistancePolicy::ODOMETER
            ? $trip->distance_km
            : ($trip->provisional_distance_km ?? $trip->distance_km);

        if ($distanceKm === null) {
            return $trip;
        }

        // Priced on a stand-in rather than the trip itself, so the engine
        // reads the provisional distance without the trip's own columns being
        // touched: `billed_distance_km` stays whatever the resolver said or
        // will say, and `distance_km` stays the odometer.
        $probe = $trip->replicate(['id', 'billed_distance_km']);
        $probe->distance_km = $distanceKm;
        $probe->billed_distance_km = null;
        $probe->setRelation('vehicle', $trip->vehicle);

        $trip->forceFill([
            'fare_provisional_minor' => Shillings::toMinor($this->pricing->price($probe, $version)->total()),
        ])->save();

        return $trip;
    }

    /**
     * What a ride between two points would cost, before anybody drives it.
     *
     * **An estimate, and it under-reads on purpose.** The distance is the
     * great circle between pickup and drop-off, because before a trip exists
     * there is no route to measure — and real roads are longer than the
     * crow's flight, so this is a floor rather than a prediction.
     *
     * There is deliberately no "road winding" multiplier. A 1.3× would turn
     * a measurable quantity into a guess wearing a decimal point, and it is
     * the invented number that would need defending the first time a
     * passenger compared two apps. ADR-0020 §3 took the same line about
     * refusing to promise an ETA from a straight line.
     *
     * Returns null when the ride cannot be estimated at all — no
     * coordinates at either end, or no vehicle of that category on the
     * fleet. Null is a screen that shows no figure, which is the honest
     * rendering; a zero would read as a free ride.
     *
     * @throws RateCardNotConfiguredException no public tariff, or none priced this category
     */
    public function quote(
        string $vehicleCategory,
        ?float $pickupLatitude,
        ?float $pickupLongitude,
        ?float $dropoffLatitude,
        ?float $dropoffLongitude,
    ): ?WalkInQuote {
        if ($pickupLatitude === null || $pickupLongitude === null
            || $dropoffLatitude === null || $dropoffLongitude === null) {
            return null;
        }

        $distanceKm = GreatCircle::kilometres(
            $pickupLatitude,
            $pickupLongitude,
            $dropoffLatitude,
            $dropoffLongitude,
        );

        // Priced through the same engine as everything else, by handing it an
        // unsaved Trip carrying the estimated distance.
        //
        // That is deliberate rather than expedient: a second arithmetic path
        // for estimates would be a second definition of what a fare is, and
        // the two would disagree the first time somebody changed a rounding
        // rule or added a night multiplier. The engine is pure — it "reads,
        // computes, writes nothing" — which is precisely what makes this
        // safe, and its own docblock anticipated this use.
        $vehicle = new Vehicle(['category' => $vehicleCategory]);

        $trip = new Trip([
            'distance_km' => round($distanceKm, 2),
            'origin' => 'Estimate',
            'destination' => 'Estimate',
        ]);

        // `RateCardResolver` picks the version in force on the trip's date,
        // reading `started_at ?? created_at` — and an *unsaved* model has
        // neither, so this blew up on a null before the estimate got
        // anywhere near a price. A quote is for a ride happening now, so now
        // is the honest date to price it at.
        $trip->created_at = now();
        $trip->setRelation('vehicle', $vehicle);

        $version = $this->rateCards->resolveFor($trip);
        $price = $this->pricing->price($trip, $version);

        return new WalkInQuote(
            vehicleCategory: $vehicleCategory,
            distanceKm: round($distanceKm, 2),
            totalMinor: Shillings::toMinor($price->total()),
            currency: $version->currency,
        );
    }
}
