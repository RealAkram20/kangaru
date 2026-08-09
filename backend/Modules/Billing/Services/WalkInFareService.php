<?php

namespace Modules\Billing\Services;

use App\Support\Money\Shillings;
use Modules\Billing\Pricing\RateCardNotConfiguredException;
use Modules\Billing\Pricing\RateCardResolver;
use Modules\Billing\Pricing\TripPricingEngine;
use Modules\Dispatch\Support\GreatCircle;
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
