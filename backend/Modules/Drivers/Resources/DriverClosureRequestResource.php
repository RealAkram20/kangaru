<?php

namespace Modules\Drivers\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Drivers\Models\DriverClosureRequest;

/**
 * A closure request, for the driver who raised it and for the office queue
 * (ADR-0043).
 *
 * **One resource for both readers, unlike the payout account's two.** There is
 * nothing here the driver may not see: it is their own request, their own
 * reason, and the office's answer — which is the whole point of the return
 * path. The payout account needed two because the office reads a bank number
 * the driver's handset must not.
 *
 * The reviewer is served as a **name, never an id or an email**. A driver
 * learning which clerk closed their account gains nothing and the office
 * gains a name to be argued with.
 *
 * @mixin DriverClosureRequest
 */
class DriverClosureRequestResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status->value,
            'status_label' => $this->status->label(),
            'reason' => $this->reason,
            'decline_reason' => $this->decline_reason,
            'requested_at' => $this->created_at?->toIso8601String(),
            'reviewed_at' => $this->reviewed_at?->toIso8601String(),
            'closed_at' => $this->closed_at?->toIso8601String(),
            /*
             * Only where the relation was loaded — the office queue eager-loads
             * it, and the driver's own read has no use for their own name.
             *
             * The null branch is unreachable in practice — `driver_id` is a
             * constrained, non-nullable key and this closure only runs when the
             * relation was eager-loaded — but the relation is nullable to the
             * type system, and a fallback is cheaper than a resource that can
             * throw while rendering an office queue.
             */
            'driver_name' => $this->whenLoaded(
                'driver',
                fn (): string => $this->driver === null ? 'Unknown driver' : $this->driver->name,
            ),
        ];
    }
}
