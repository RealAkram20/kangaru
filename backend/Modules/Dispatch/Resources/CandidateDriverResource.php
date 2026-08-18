<?php

namespace Modules\Dispatch\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Resources\DriverResource;

/**
 * A driver plus whether they can take this booking (ADR-0017).
 *
 * Wraps `DriverResource` rather than restating its fields, exactly as
 * `CandidateVehicleResource` wraps the vehicle one, so the driver half
 * cannot drift from every other place a driver is serialised.
 *
 * @property array{driver: Driver, dispatchable: bool, note: string|null} $resource
 */
class CandidateDriverResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            ...(new DriverResource($this->resource['driver']))->toArray($request),

            // False means dispatch will refuse them with 409, whatever is
            // sent — the list is a preview of the rule, not the rule.
            'dispatchable' => $this->resource['dispatchable'],
            // Short sentence, or null when there is nothing to say. Never
            // names the kind of absence: a shared board is not the place to
            // announce that a colleague is off sick.
            'note' => $this->resource['note'],
        ];
    }
}
