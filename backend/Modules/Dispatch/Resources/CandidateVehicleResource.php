<?php

namespace Modules\Dispatch\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Vehicles\Models\Vehicle;
use Modules\Vehicles\Resources\VehicleResource;

/**
 * A vehicle plus what this booking's contracts say about it (ADR-0009).
 *
 * Wraps `VehicleResource` rather than restating its fields, so the vehicle
 * half cannot drift from every other place a vehicle is serialised. The
 * allocation half sits beside it rather than inside it: an allocation is a
 * fact about a vehicle *for one client on one date*, and folding it into
 * `VehicleResource` would imply the fleet has an owner, which is the exact
 * confusion ADR-0005 removed.
 *
 * @property array{vehicle: Vehicle, allocated: bool, dispatchable: bool, requires_override_reason: bool, note: string|null} $resource
 */
class CandidateVehicleResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            ...(new VehicleResource($this->resource['vehicle']))->toArray($request),

            // Ranks first for this client on this date.
            'allocated' => $this->resource['allocated'],
            // False means dispatch will refuse it with 409, whatever is sent.
            'dispatchable' => $this->resource['dispatchable'],
            // True means POSTing this vehicle without a reason gets a 422
            // naming `allocation_override_reason` — so a form can ask for one
            // before the dispatcher is bounced.
            'requires_override_reason' => $this->resource['requires_override_reason'],
            // Short human sentence, or null when there is nothing to say.
            // Never names the other client.
            'note' => $this->resource['note'],
        ];
    }
}
