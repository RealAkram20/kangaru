<?php

namespace Modules\Fleet\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Support\DriverPresence;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * One on-duty driver, for the live map (ADR-0024 §2, office side).
 *
 * Not `DriverPresenceResource`: that one is the driver's own `/me/duty`
 * answer and carries `heartbeat_seconds` and `dispatchable`, which are
 * instructions to a handset. This is a description for a dispatcher, and
 * it is shaped like `LivePositionResource` on purpose — `age_seconds` and
 * `stale` mean the same thing in both, so the page can merge the two lists
 * into one and sort them by who needs attention.
 *
 * Allow-listed fields throughout. `Driver` carries a phone and a licence
 * number, `Vehicle` a VIN; a map needs a name and a plate.
 *
 * @property DriverPresence $resource
 */
class OnDutyDriverResource extends JsonResource
{
    public function __construct(
        DriverPresence $resource,
        private readonly ?Driver $driver,
        private readonly ?Vehicle $vehicle,
        private readonly ?Trip $trip,
    ) {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $presence = $this->resource;

        return [
            'driver_id' => $presence->driverId,
            'driver' => $this->driver === null ? null : [
                'id' => $this->driver->id,
                'name' => $this->driver->name,
            ],
            'vehicle_id' => $this->vehicle?->id,
            'vehicle' => $this->vehicle === null ? null : [
                'id' => $this->vehicle->id,
                'registration_number' => $this->vehicle->registration_number,
                'make' => $this->vehicle->make,
                'model' => $this->vehicle->model,
                // The silhouette source, as on LivePositionResource.
                'category' => $this->vehicle->category,
            ],
            // Null, not zero, when the handset has never reported — a
            // position the platform does not have is not a position at the
            // origin.
            'latitude' => $presence->latitude,
            'longitude' => $presence->longitude,
            'accuracy_metres' => $presence->accuracyMetres,
            'recorded_at' => $presence->recordedAt?->toIso8601String(),
            // Null when never reported, like `recorded_at`; `stale` is then
            // true, because a place nobody has named cannot be current.
            'age_seconds' => $presence->ageSeconds(),
            'stale' => $presence->isStale(),
            // The occupying trip they are on, or null when they are waiting
            // for work. Id and status only: the rest of the trip is on
            // `/live-positions` once the vehicle reports, and on the trip
            // record behind the policy that governs it.
            'trip' => $this->trip === null ? null : [
                'id' => $this->trip->id,
                'status' => $this->trip->status->value,
            ],
        ];
    }
}
