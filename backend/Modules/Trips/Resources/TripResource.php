<?php

namespace Modules\Trips\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Drivers\Resources\DriverResource;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
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
            'tenant_id' => $this->tenant_id,
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
            'distance_km' => $this->distance_km,
            'gps_distance_km' => $this->gps_distance_km,
            'distance_variance_flagged' => $this->distance_variance_flagged,
            'cancellation_charge_applicable' => $this->cancellation_charge_applicable,
            'started_at' => $this->started_at,
            'completed_at' => $this->completed_at,
            // Bank acceptance criterion #6. Served explicitly rather than
            // left for each client to re-derive from the two timestamps.
            'duration_minutes' => $this->durationMinutes(),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
