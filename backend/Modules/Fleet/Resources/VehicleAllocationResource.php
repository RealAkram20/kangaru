<?php

namespace Modules\Fleet\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Fleet\Models\VehicleAllocation;
use Modules\Vehicles\Resources\VehicleResource;

/**
 * @mixin VehicleAllocation
 */
class VehicleAllocationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'tenant_id' => $this->tenant_id,
            // Named, not just numbered — the same reason BookingResource
            // carries it: this listing spans every client for platform
            // staff, and ADR-0006's own words are that a cross-client list
            // which does not say whose row it is, is worse than none.
            // Absent rather than null when the reader is a client, so they
            // can tell "not applicable" from "no client".
            'client' => $this->whenLoaded('tenant', function () {
                $client = $this->tenant;

                return $client === null ? null : ['id' => $client->id, 'name' => $client->name];
            }),

            'vehicle_id' => $this->vehicle_id,
            'vehicle' => new VehicleResource($this->whenLoaded('vehicle')),

            'starts_on' => $this->starts_on->toDateString(),
            'ends_on' => $this->ends_on?->toDateString(),

            // The substance of ADR-0009. Always present and always a real
            // boolean: a client reading their own contract needs to know
            // whether they bought a dedicated vehicle or a preferred one,
            // and "absent" would read as the former to an optimist.
            'exclusive' => $this->exclusive,

            // Whether this contract covers today, answered by the server so
            // a screen never has to compare dates itself and get the
            // boundary days wrong — which is precisely the off-by-one
            // `scopeInForceOn`'s tests exist to pin.
            'in_force' => $this->starts_on->startOfDay()->lessThanOrEqualTo(now()->startOfDay())
                && ($this->ends_on === null || $this->ends_on->startOfDay()->greaterThanOrEqualTo(now()->startOfDay())),

            'notes' => $this->notes,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
