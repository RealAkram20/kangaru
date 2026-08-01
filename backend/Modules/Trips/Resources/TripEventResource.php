<?php

namespace Modules\Trips\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Administration\Resources\UserResource;
use Modules\Trips\Models\TripEvent;

/**
 * @mixin TripEvent
 */
class TripEventResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'trip_id' => $this->trip_id,
            'from_status' => $this->from_status?->value,
            'to_status' => $this->to_status->value,
            'user_id' => $this->user_id,
            'user' => new UserResource($this->whenLoaded('user')),
            'notes' => $this->notes,
            'created_at' => $this->created_at,
        ];
    }
}
