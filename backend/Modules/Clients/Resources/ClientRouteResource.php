<?php

namespace Modules\Clients\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Clients\Models\ClientRoute;

/**
 * @mixin ClientRoute
 */
class ClientRouteResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'reference' => $this->reference,
            'notes' => $this->notes,
            'is_active' => $this->is_active,
            'stop_count' => $this->whenLoaded('stops', fn () => $this->stops->count()),
            'stops' => ClientRouteStopResource::collection($this->whenLoaded('stops')),

            // **Allow-listed to a name, deliberately** (`docs/screen-rules.md`
            // §2). These are `User` rows carrying an email, a phone, a role,
            // a capability set and an MFA state, and a route needs none of
            // it — the question this answers is "who rides this", and a name
            // answers it. Spreading the model would put a colleague's
            // contact details into a payload about geography, which is the
            // shape of leak that looks harmless in review.
            'members' => $this->whenLoaded('members', fn () => $this->members
                ->map(fn ($member) => [
                    'id' => $member->id,
                    'name' => $member->name,
                ])
                ->values()),

            // Distance and duration are absent on purpose. They are the
            // routing provider's to state (ADR-0031 §6) and are asked for
            // per-draw by the builder, never stored on this row: a saved
            // number would be a measurement of a circuit as it was drawn
            // last March, rendered beside a circuit as it is today.
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
