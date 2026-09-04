<?php

namespace Modules\Customers\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Billing\Pricing\RateCardNotConfiguredException;
use Modules\Billing\Services\WalkInFareService;
use Modules\Bookings\Models\OrderRequest;
use Modules\Dispatch\Services\DispatchOfferService;
use Modules\Trips\Support\ContactChannel;

/**
 * A ride as the person waiting for it sees it (ADR-0024 §7).
 *
 * ## The phase names are `RidePhase`'s own
 *
 * `frontend/src/pages/public/ride.ts` defines the states its screens were
 * designed against and says why they were named as they were:
 *
 * > The phase names are deliberately `TripStatus`'s own names, so that
 * > mapping is an identity function rather than a translation table somebody
 * > has to keep in step.
 *
 * This resource honours that. `driver_en_route`, `driver_arrived`,
 * `passenger_onboard`, `trip_completed` and `cancelled` come straight off the
 * trip; `searching`, `offered` and `unmatched` come from
 * `DispatchOfferService::searchState()` and have no `TripStatus` twin
 * because they happen before a trip exists at all.
 *
 * ## What the customer is not told
 *
 * Which drivers were offered the job, what they scored, who declined. That
 * is the platform's own bookkeeping — the audit ADR-0020 §4 requires is for
 * the operator, not the passenger, and "three drivers turned you down" is
 * not information anybody standing on a kerb can use.
 *
 * @mixin OrderRequest
 */
class CustomerRideResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var OrderRequest $order */
        $order = $this->resource;
        $trip = $order->trip;

        return [
            'reference' => $order->reference,
            'service_type' => $order->service_type->value,

            // Before a trip exists this is the search state; once one does,
            // it is the trip's own status. One field, because the customer's
            // screen renders one timeline and should not have to decide
            // which of two fields is authoritative right now.
            'phase' => $trip === null
                ? app(DispatchOfferService::class)->searchState($order)
                : $trip->status->value,

            'pickup' => [
                'label' => $order->pickup_location,
                'latitude' => $order->pickup_latitude,
                'longitude' => $order->pickup_longitude,
            ],
            'dropoff' => [
                'label' => $order->dropoff_location,
                'latitude' => $order->dropoff_latitude,
                'longitude' => $order->dropoff_longitude,
            ],

            'trip_id' => $trip?->id,
            'captain' => $trip === null ? null : $this->captain(),

            // The money, in the two shapes `TripResource` gives the driver:
            // what the ride is *expected* to cost while it runs, and what it
            // *did* cost once it is over. Both were absent here, so the
            // passenger's screen hard-coded null for each and its own
            // completion card — fare, pay, rate — could never appear: the
            // owner watched a ride end on the driver's phone while the web
            // stayed on "on trip". A quote and a bill are different claims
            // (ADR-0026 §2), so they are different fields, and each carries
            // `is_estimate` so no screen has to remember which is which.
            'estimated_fare' => $this->estimatedFare(),
            'fare' => $this->settledFare(),
            'created_at' => $order->created_at,
        ];
    }

    /**
     * What the ride is expected to cost, priced from the trip's own vehicle.
     *
     * The same call `TripResource::estimatedFare()` makes for the driver, so
     * the two people in the car are quoted one number. Null before there is
     * a vehicle to price against, once a settled fare exists, when either end
     * has no pin, or when no public tariff prices this category — every one
     * of them a screen that shows no figure, never a zero.
     *
     * @return array<string, mixed>|null
     */
    private function estimatedFare(): ?array
    {
        /** @var OrderRequest $order */
        $order = $this->resource;
        $trip = $order->trip;
        $category = $trip?->vehicle?->category;

        if ($trip === null || $trip->fare_minor !== null || ! is_string($category)) {
            return null;
        }

        try {
            return app(WalkInFareService::class)->quote(
                $category,
                $order->pickup_latitude === null ? null : (float) $order->pickup_latitude,
                $order->pickup_longitude === null ? null : (float) $order->pickup_longitude,
                $order->dropoff_latitude === null ? null : (float) $order->dropoff_latitude,
                $order->dropoff_longitude === null ? null : (float) $order->dropoff_longitude,
            )?->toArray();
        } catch (RateCardNotConfiguredException) {
            return null;
        }
    }

    /**
     * What the ride cost, once `WalkInFareService::settle()` has run.
     *
     * The distance is the trip's measured one — the figure the fare was
     * priced from — not the crow's flight the estimate used.
     *
     * @return array<string, mixed>|null
     */
    private function settledFare(): ?array
    {
        /** @var OrderRequest $order */
        $order = $this->resource;
        $trip = $order->trip;

        if ($trip === null || $trip->fare_minor === null) {
            return null;
        }

        return [
            'total_minor' => (int) $trip->fare_minor,
            'currency' => $trip->fare_currency,
            'distance_km' => $trip->distance_km === null ? null : (float) $trip->distance_km,
            'is_estimate' => false,
        ];
    }

    /**
     * The driver, their vehicle, and a number to ring.
     *
     * Everything `ride.ts`'s `Captain` is typed for, minus what the platform
     * does not have: there is no driver rating (`Modules/Drivers/README.md`
     * lists it as unbuilt) and no road-distance ETA (ADR-0020 §3 — ranking is
     * straight-line, and promising an arrival time needs the Directions
     * API). Both are omitted rather than faked. A number the screen invents
     * is worse than a screen that does not show one.
     *
     * `phone` comes through `ContactChannel`, so the same three rules apply
     * here as on the driver's side: walk-in only, live trips only, and null
     * when there is nothing to dial. That policy is in one class precisely
     * so this resource cannot disagree with `TripResource` about it.
     *
     * @return array<string, mixed>|null
     */
    private function captain(): ?array
    {
        /** @var OrderRequest $order */
        $order = $this->resource;
        $trip = $order->trip;

        if ($trip === null) {
            return null;
        }

        $driver = $trip->driver;

        if ($driver === null) {
            return null;
        }

        $vehicle = $trip->vehicle;
        $contact = app(ContactChannel::class)->forDriver($trip);

        return [
            'name' => $driver->name,
            // Null once the trip is over, and that is the point: a completed
            // trip is not a directory (ADR-0024 §7).
            'phone' => $contact?->phone,
            'phone_label' => $contact?->label,
            // "A white Premio" is how a passenger actually spots a car at a
            // kerb, so make and model are joined here rather than left for
            // the screen to concatenate — and either may be blank, which is
            // why the join is filtered before it is trimmed.
            'vehicle' => $vehicle === null
                ? null
                : (implode(' ', array_filter([$vehicle->make, $vehicle->model])) ?: $vehicle->category),
            'plate' => $vehicle?->registration_number,
            // `color`, the column's own spelling. Renamed on the way out
            // because every other string this API sends a customer is
            // British English, and the inconsistency would be visible in
            // the JSON.
            'vehicle_colour' => $vehicle?->color,
        ];
    }
}
