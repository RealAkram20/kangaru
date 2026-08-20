<?php

namespace Modules\Trips\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Trips\Models\Trip;
use Modules\Trips\Support\LivePosition;

/**
 * One vehicle's current position, for the live map (ADR-0019).
 *
 * Carries the trip it was read through, so the marker can be named — "UBK
 * 421H · Grace Nakato · heading to pickup" — rather than numbered. The flat
 * `vehicle_id` / `trip_id` / `driver_id` fields stay exactly as they were:
 * AGENTS.md allows additive changes only, and the client dashboard already
 * reads them.
 *
 * What is deliberately **not** here: the passenger. ADR-0024 §7 releases a
 * rider's name and phone to the driver only after acceptance, and a map is
 * not the place to put a person's name beside a moving dot. The trip record
 * behind "Open trip" has the passenger, behind the policy that governs it.
 *
 * @property LivePosition $resource
 */
class LivePositionResource extends JsonResource
{
    /**
     * @param  Trip|null  $trip  the occupying trip, with `vehicle`, `driver`
     *                           and `tenant` loaded; null leaves the nested
     *                           objects null, which the map renders as
     *                           "Vehicle #id" rather than failing.
     */
    public function __construct(LivePosition $resource, private readonly ?Trip $trip = null)
    {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $trip = $this->trip;
        $vehicle = $trip?->vehicle;
        $driver = $trip?->driver;
        $client = $trip?->tenant;

        return [
            'vehicle_id' => $this->resource->vehicleId,
            'trip_id' => $this->resource->tripId,
            'driver_id' => $this->resource->driverId,
            'latitude' => $this->resource->latitude,
            'longitude' => $this->resource->longitude,
            'speed_kph' => $this->resource->speedKph,
            'heading_degrees' => $this->resource->headingDegrees,
            'recorded_at' => $this->resource->recordedAt,
            // Both, deliberately. `age_seconds` is what an operations
            // dashboard graphs against PROJECT.md's freshness target;
            // `stale` is the single boolean a map needs to grey a marker,
            // and computing it client-side would put the threshold in two
            // places that could disagree.
            'age_seconds' => $this->resource->ageSeconds(),
            'stale' => $this->resource->isStale(),
            // Allow-listed fields, never the models spread. `Vehicle` carries
            // a VIN and `Driver` a licence number and phone, none of which a
            // map needs.
            'vehicle' => $vehicle === null ? null : [
                'id' => $vehicle->id,
                'registration_number' => $vehicle->registration_number,
                'make' => $vehicle->make,
                'model' => $vehicle->model,
                // So the map can draw the right silhouette — the same field
                // the public nearby read serves as `kind`'s source.
                'category' => $vehicle->category,
            ],
            'driver' => $driver === null ? null : [
                'id' => $driver->id,
                'name' => $driver->name,
            ],
            'trip' => $trip === null ? null : [
                'id' => $trip->id,
                'status' => $trip->status->value,
                'origin' => $trip->origin,
                'destination' => $trip->destination,
                // Null on a walk-in (ADR-0024 §1) — Shanitah's own ride, no
                // client to name.
                'client' => $client === null ? null : ['id' => $client->id, 'name' => $client->name],
            ],
        ];
    }
}
