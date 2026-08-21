<?php

namespace Modules\Vehicles\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Vehicles\Models\VehicleCategory;

/**
 * @mixin VehicleCategory
 */
class VehicleCategoryResource extends JsonResource
{
    /**
     * Allow-listed field by field, per `docs/screen-rules.md` §2 — never a
     * spread of the model.
     *
     * The last three are computed by `VehicleCategoryService::list()` and
     * attached as attributes; on a single-resource response (a create, an
     * edit) they are absent, and `whenHas` omits the keys rather than
     * emitting a zero. **A zero here would be a lie in the direction that
     * matters**: `unpriced_rate_cards: []` reads as "priced everywhere",
     * which is the one claim this screen exists to make honestly.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            // Immutable once created (ADR-0050 §2). Exposed because it is
            // what `vehicles.category` and every rate card rate actually
            // store, and an operator reconciling a report needs to see the
            // string their data holds.
            'key' => $this->key,
            'name' => $this->name,
            'description' => $this->description,
            'active' => $this->active,
            'position' => $this->position,

            'vehicles_count' => $this->whenHas('vehicles_count'),
            'rate_cards_total' => $this->whenHas('rate_cards_total'),
            'unpriced_rate_cards' => $this->whenHas('unpriced_rate_cards'),

            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
