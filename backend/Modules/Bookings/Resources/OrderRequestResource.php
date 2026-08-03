<?php

namespace Modules\Bookings\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Bookings\Models\OrderRequest;

/**
 * The dispatcher-queue shape. The public endpoint never returns this — a
 * visitor gets only their reference — so every field here is for staff.
 *
 * @mixin OrderRequest
 */
class OrderRequestResource extends JsonResource
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
            // Same rule as TripResource: served so the UI never carries its
            // own copy of the transition graph.
            'allowed_transitions' => array_map(
                fn ($status) => $status->value,
                $this->status->allowedTransitions(),
            ),
            'contact_name' => $this->contact_name,
            'contact_phone' => $this->contact_phone,
            'contact_email' => $this->contact_email,
            'pickup_location' => $this->pickup_location,
            'dropoff_location' => $this->dropoff_location,
            'scheduled_for' => $this->scheduled_for,
            'details' => $this->details,
            'notes' => $this->notes,
            'dispatcher_notes' => $this->dispatcher_notes,
            'handled_by' => $this->whenLoaded('handledBy', function () {
                $handler = $this->handledBy;

                return $handler === null ? null : ['id' => $handler->id, 'name' => $handler->name];
            }),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
