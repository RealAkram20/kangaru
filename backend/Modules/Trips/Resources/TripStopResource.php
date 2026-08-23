<?php

namespace Modules\Trips\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Trips\Models\TripStop;

/**
 * One stop on a run, as evidence (ADR-0045).
 *
 * Coordinates follow `TripResource::place`'s rule — both or neither, never a
 * half-position a client defaults into the Atlantic. `client_place_id`
 * travels for report grouping only; the label is the stop's own, frozen at
 * creation, and stays right when the register's place is later renamed.
 *
 * @mixin TripStop
 */
class TripStopResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $located = $this->latitude !== null && $this->longitude !== null;

        return [
            'id' => $this->id,
            'sequence' => $this->sequence,
            'label' => $this->label,
            'latitude' => $located ? $this->latitude : null,
            'longitude' => $located ? $this->longitude : null,
            'source' => $this->source->value,
            'status' => $this->status->value,
            'arrived_at' => $this->arrived_at?->toIso8601String(),
            'departed_at' => $this->departed_at?->toIso8601String(),
            'skip_reason' => $this->skip_reason,
            'client_place_id' => $this->client_place_id,
        ];
    }
}
