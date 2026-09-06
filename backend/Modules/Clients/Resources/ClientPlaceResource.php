<?php

namespace Modules\Clients\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Clients\Models\ClientPlace;

/**
 * @mixin ClientPlace
 */
class ClientPlaceResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'address' => $this->address,
            // Cast to float on the model, and emitted as numbers rather
            // than the decimal strings MySQL hands back. A map consuming
            // "0.3136" as a string gets NaN and renders nothing, silently.
            'latitude' => $this->latitude,
            'longitude' => $this->longitude,
            'arrival_radius_m' => $this->arrival_radius_m,
            'notes' => $this->notes,
            'is_active' => $this->is_active,
            // Only when the caller asked for it. `routeStops` is loaded on
            // the delete path to name what is blocking a removal, and a
            // count is all any screen needs — the stop rows themselves
            // belong to the route that owns them.
            'route_count' => $this->whenLoaded(
                'routeStops',
                fn () => $this->routeStops->unique('client_route_id')->count(),
            ),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
