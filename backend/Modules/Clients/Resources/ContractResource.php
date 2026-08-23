<?php

namespace Modules\Clients\Resources;

use App\Models\OperatorClient;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One contract between a fleet and a client, as the **client** reads it.
 *
 * Allow-listed rather than spread, and the fields left out are the point:
 * `credit_limit_minor` and `billing_email` live on this row and are the
 * fleet's own commercial terms. A client seeing one fleet's credit limit
 * beside another's would be reading a number neither fleet offered to share.
 *
 * @mixin OperatorClient
 */
class ContractResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status,
            // `$this` is the resource, not the model, so the date casts are
            // invisible to static analysis here — read through `resource` to
            // get the cast `CarbonInterface` rather than the raw column.
            'started_on' => $this->resource->started_on?->toDateString(),
            'ended_on' => $this->resource->ended_on?->toDateString(),
            // The fleet asking, or serving. A client cannot answer a request
            // from somebody anonymous, so the name is served — and nothing
            // else about the fleet is.
            'fleet' => $this->whenLoaded('operator', fn () => [
                'id' => $this->resource->operator?->id,
                'name' => $this->resource->operator?->name,
            ]),
        ];
    }
}
