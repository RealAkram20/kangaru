<?php

namespace Modules\Trips\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Drivers\Resources\DriverResource;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Support\ContactChannel;
use Modules\Vehicles\Resources\VehicleResource;

/**
 * @mixin Trip
 */
class TripResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            // Null on a walk-in trip (ADR-0024 §1), where `customer_id`
            // carries the ownership instead. Exactly one of the pair is ever
            // set, so a client can branch on either without asking both.
            'tenant_id' => $this->tenant_id,
            'customer_id' => $this->customer_id,
            // Which client this trip is for, by name. See BookingResource
            // for the reasoning — same rule, same ADR-0006 queue, and a
            // trips list opened by platform staff spans clients too.
            'client' => $this->whenLoaded('tenant', function () {
                // See BookingResource — same shape, same reason for the
                // local and the null branch.
                $client = $this->tenant;

                return $client === null ? null : ['id' => $client->id, 'name' => $client->name];
            }),
            // Null on an ad-hoc trip raised without a booking.
            'booking_id' => $this->booking_id,
            'vehicle_id' => $this->vehicle_id,
            'vehicle' => new VehicleResource($this->whenLoaded('vehicle')),
            'driver_id' => $this->driver_id,
            'driver' => new DriverResource($this->whenLoaded('driver')),
            'origin' => $this->origin,
            'destination' => $this->destination,
            'status' => $this->status->value,
            // Served so the UI never has to carry its own copy of the
            // transition graph. TripStatus stays the single source of
            // truth (AGENTS.md: "Allowed transitions are defined in one
            // place"), and a client that duplicated the map would drift
            // from it the first time the lifecycle changed.
            //
            // This is what is *legal from this state*, not what this user
            // may do — TripPolicy still authorises each attempt.
            'allowed_transitions' => array_map(
                fn (TripStatus $status) => $status->value,
                $this->status->allowedTransitions(),
            ),
            'odometer_start' => $this->odometer_start,
            'odometer_start_photo_path' => $this->odometer_start_photo_path,
            'odometer_end' => $this->odometer_end,
            'odometer_end_photo_path' => $this->odometer_end_photo_path,
            // Where to fetch the dashboard photos, rather than leaving a
            // client to build the path itself. Null when none was captured,
            // so "is there a photo" is one field rather than a string test.
            //
            // The `_path` fields above are kept alongside these: AGENTS.md
            // allows additive changes within a version but not removals, and
            // dropping them would break any client already reading them.
            'odometer_start_photo_url' => $this->odometer_start_photo_path === null
                ? null
                : route('trips.odometer-photo.show', ['trip' => $this->id, 'moment' => 'start']),
            'odometer_end_photo_url' => $this->odometer_end_photo_path === null
                ? null
                : route('trips.odometer-photo.show', ['trip' => $this->id, 'moment' => 'end']),
            'distance_km' => $this->distance_km,
            'gps_distance_km' => $this->gps_distance_km,
            'distance_variance_flagged' => $this->distance_variance_flagged,
            'cancellation_charge_applicable' => $this->cancellation_charge_applicable,
            'started_at' => $this->started_at,
            'completed_at' => $this->completed_at,
            // Bank acceptance criterion #6. Served explicitly rather than
            // left for each client to re-derive from the two timestamps.
            'duration_minutes' => $this->durationMinutes(),
            // Who to ring, if anybody (ADR-0024 §7). Null far more often
            // than not — see below.
            'passenger_contact' => $this->passengerContactFor($request),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }

    /**
     * The passenger's number, for the driver on this trip and nobody else.
     *
     * Three gates, and only the third is in this method:
     *
     * - **`ContactChannel` decides whether the trip is one where the parties
     *   may speak at all** — walk-in only, and only from `accepted` to
     *   `trip_completed`. That policy lives in one class because the
     *   customer's ride payload asks the same question, and a rule split
     *   across two resources is a rule applied to one and a half of them.
     * - **This method decides whether the *caller* is the driver.** A
     *   dispatcher listing trips holds `trips.view.all` and can already see
     *   the whole board; that does not make a passenger's mobile number part
     *   of a list view. It is served to the one person who needs to ring
     *   the passenger to find them at a busy pickup.
     * - The customer guard never reaches this resource at all.
     *
     * Note it is keyed off `driver->user_id`, the same ownership test
     * `TripPolicy::transition` uses. That relation is loaded on every path
     * that serves this resource; where it is not, `?->` yields null and the
     * field is withheld — which fails closed, and is the right direction for
     * a field like this one to fail in.
     *
     * @return array<string, string>|null
     */
    private function passengerContactFor(Request $request): ?array
    {
        $user = $request->user();

        if ($user === null || $this->driver?->user_id !== $user->id) {
            return null;
        }

        /** @var Trip $trip */
        $trip = $this->resource;

        return app(ContactChannel::class)->forPassenger($trip)?->toArray();
    }
}
