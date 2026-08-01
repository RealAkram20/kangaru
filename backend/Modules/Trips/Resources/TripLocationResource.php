<?php

namespace Modules\Trips\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Trips\Models\TripLocation;

/**
 * @mixin TripLocation
 */
class TripLocationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            // Numbers, not the decimal strings the cast returns: a map
            // library wants floats, and a coordinate is not money — the
            // reason AGENTS.md keeps amounts out of floats does not apply
            // to a point that is already accurate to the centimetre.
            'latitude' => (float) $this->latitude,
            'longitude' => (float) $this->longitude,
            'speed_kph' => $this->speed_kph === null ? null : (float) $this->speed_kph,
            'heading_degrees' => $this->heading_degrees,
            'accuracy_metres' => $this->accuracy_metres === null ? null : (float) $this->accuracy_metres,
            // The device's clock, which is what the route is ordered by.
            'recorded_at' => $this->recorded_at,
        ];
    }
}
