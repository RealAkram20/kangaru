<?php

namespace Modules\Fleet\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Fleet\Models\AvailabilityBlock;

/**
 * @mixin AvailabilityBlock
 */
class AvailabilityBlockResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'resource_type' => $this->resource_type,
            'resource_id' => $this->resource_id,
            'kind' => $this->kind,
            'status' => $this->status,
            'answered_at' => $this->answered_at,
            'answer_note' => $this->answer_note,
            'starts_at' => $this->starts_at,
            'ends_at' => $this->ends_at,
            'reason' => $this->reason,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
