<?php

namespace Modules\Dispatch\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Dispatch\Services\DispatchSuggestion;
use Modules\Drivers\Resources\DriverResource;
use Modules\Vehicles\Resources\VehicleResource;

/**
 * A pair the matcher would choose, with its reasons (ADR-0020).
 *
 * @property DispatchSuggestion $resource
 */
class DispatchSuggestionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'vehicle' => new VehicleResource($this->resource->vehicle),
            'driver' => new DriverResource($this->resource->driver),
            'score' => $this->resource->score,
            // Null when the pickup has no coordinates or the vehicle has not
            // reported — reported as absent rather than as a guessed number.
            'pickup_distance_km' => $this->resource->pickupDistanceKm,
            // Plain sentences, because a ranking a dispatcher cannot audit
            // is one they override on instinct.
            'reasons' => $this->resource->reasons,
        ];
    }
}
