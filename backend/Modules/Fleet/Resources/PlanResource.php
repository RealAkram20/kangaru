<?php

namespace Modules\Fleet\Resources;

use App\Models\Plan;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A plan, as the catalogue serves it (ADR-0058).
 *
 * A limit of `null` travels as null and means **unlimited** — not nought, and
 * not a large number. The console has to render that as a word rather than a
 * figure, so flattening it here would push the decision onto every reader.
 *
 * @mixin Plan
 */
class PlanResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'slug' => $this->slug,
            'name' => $this->name,
            'description' => $this->description,
            'is_default' => (bool) $this->is_default,
            // Minor units and an ISO 4217 code, per AGENTS.md. Nought is a
            // real price on Free, not an absence (ADR-0058 §1).
            'price_minor' => (int) $this->price_minor,
            'currency' => $this->currency,
            'period' => $this->period,
            'driver_limit' => $this->resource->driver_limit,
            'vehicle_limit' => $this->resource->vehicle_limit,
            'staff_limit' => $this->resource->staff_limit,
            'fleets_count' => $this->whenCounted('operators'),
        ];
    }
}
