<?php

namespace Modules\Customers\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Bookings\Models\OrderRequest;

/**
 * An order request as its own customer sees it — deliberately narrower
 * than the staff OrderRequestResource. "Walk-ins only see what they need
 * to see" is enforced by what this resource omits:
 *
 * - `dispatcher_notes` — the desk's working notes about the caller are
 *   the desk's, in the same way a support ticket's internal notes are
 *   not the requester's.
 * - `handled_by` — which staff member has the request is an internal
 *   assignment, and naming staff to the public is a directory leak.
 * - `allowed_transitions` — the transition graph drives the staff queue
 *   UI; a customer moves nothing.
 *
 * @mixin OrderRequest
 */
class CustomerOrderRequestResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'reference' => $this->reference,
            'service_type' => $this->service_type->value,
            'status' => $this->status->value,
            'pickup_location' => $this->pickup_location,
            'dropoff_location' => $this->dropoff_location,
            'scheduled_for' => $this->scheduled_for,
            'details' => $this->details,
            'notes' => $this->notes,
            'created_at' => $this->created_at,
        ];
    }
}
