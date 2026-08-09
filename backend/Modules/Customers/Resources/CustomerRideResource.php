<?php

namespace Modules\Customers\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
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
            'created_at' => $order->created_at,
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