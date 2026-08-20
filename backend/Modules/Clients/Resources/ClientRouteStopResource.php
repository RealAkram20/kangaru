<?php

namespace Modules\Clients\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Clients\Models\ClientRouteStop;

/**
 * A stop's position in a route, with the place nested rather than flattened.
 *
 * Nested because they are two objects with two lifetimes: the place moves
 * when an officer drags its pin, and every route holding it moves with it.
 * Flattening `place.name` up to `stop.name` here would read like a snapshot
 * and be edited like one within a month — and a snapshot is precisely what
 * this side of ADR-0045 must not be. `trip_stops` is where copying is
 * correct.
 *
 * @mixin ClientRouteStop
 */
class ClientRouteStopResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'sequence' => $this->sequence,
            'expected_dwell_minutes' => $this->expected_dwell_minutes,
            'driver_notes' => $this->driver_notes,
            'place' => new ClientPlaceResource($this->whenLoaded('place')),
        ];
    }
}
