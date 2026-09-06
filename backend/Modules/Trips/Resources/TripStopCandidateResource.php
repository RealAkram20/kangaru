<?php

namespace Modules\Trips\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Clients\Models\ClientPlace;

/**
 * A saved place offered to the driver's add-a-drop-off search (ADR-0045 §10).
 *
 * Deliberately thinner than `ClientPlaceResource`: four fields a search row
 * renders and nothing else. `notes` ("guard has the key"), `arrival_radius_m`
 * and the audit fields are the office's and the route builder's — a search
 * result on a handset in a cradle needs a name, an address and a pin, and
 * every extra field on this payload widens what §10's bounded release hands
 * to a phone.
 *
 * @mixin ClientPlace
 */
class TripStopCandidateResource extends JsonResource
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
            'latitude' => $this->latitude,
            'longitude' => $this->longitude,
        ];
    }
}
