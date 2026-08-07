<?php

namespace Modules\Trips\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Trips\Support\LivePosition;

/**
 * One vehicle's current position, for the live map (ADR-0019).
 *
 * @property LivePosition $resource
 */
class LivePositionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
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
        ];
    }
}
