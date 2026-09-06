<?php

namespace Modules\Drivers\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Drivers\Models\DriverWalkInContract;

/**
 * One walk-in contract, as the office reads it.
 *
 * Allow-listed. The driver is named because both queues are worked by a person
 * deciding about a person — but nothing of the driver's wallet, documents or
 * trips travels here: this is a decision about whether they may take walk-in
 * work, not a review of them.
 *
 * @mixin DriverWalkInContract
 */
class WalkInContractResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status,
            'fleet_answered_at' => $this->resource->fleet_answered_at?->toIso8601String(),
            'kangaru_answered_at' => $this->resource->kangaru_answered_at?->toIso8601String(),
            'refused_reason' => $this->refused_reason,
            'driver' => $this->whenLoaded('driver', fn () => [
                'id' => $this->resource->driver?->id,
                'name' => $this->resource->driver?->name,
                // Whether consent was waived, and why. Without it the office
                // sees a contract with no fleet and cannot tell a
                // driver-partner from a data error (ADR-0048 §7).
                'owns_vehicle' => (bool) $this->resource->driver?->owns_vehicle,
            ]),
            'fleet' => $this->whenLoaded('operator', fn () => $this->resource->operator === null ? null : [
                'id' => $this->resource->operator->id,
                'name' => $this->resource->operator->name,
            ]),
        ];
    }
}
