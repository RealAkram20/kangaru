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
            // ADR-0013 §5: the desk sees who the account holder is — "3rd
            // order from this customer" beats re-recognising a phone
            // number. Null for the anonymous walk-in, which stays the
            // default. Name and id only: the queue links to nothing more,
            // and the customer's email is not the dispatcher's to browse.
            'customer' => $this->whenLoaded('customer', function () {
                $customer = $this->customer;

                return $customer === null ? null : ['id' => $customer->id, 'name' => $customer->name];
            }),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
