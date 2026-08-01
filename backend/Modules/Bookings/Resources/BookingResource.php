<?php

namespace Modules\Bookings\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Administration\Resources\UserResource;
use Modules\Bookings\Models\Booking;
use Modules\Trips\Resources\TripResource;

/**
 * @mixin Booking
 */
class BookingResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'tenant_id' => $this->tenant_id,
            'requested_by_user_id' => $this->requested_by_user_id,
            'requested_by' => new UserResource($this->whenLoaded('requestedBy')),
            'passenger_name' => $this->passenger_name,
            'passenger_phone' => $this->passenger_phone,
            'passenger_count' => $this->passenger_count,
            'origin' => $this->origin,
            'destination' => $this->destination,
            'scheduled_for' => $this->scheduled_for,
            // Derived rather than stored: "immediate" is precisely the
            // absence of a scheduled time, and a second column could
            // contradict the first.
            'is_immediate' => $this->isImmediate(),
            'status' => $this->status->value,
            'approved_by_user_id' => $this->approved_by_user_id,
            'approved_by' => new UserResource($this->whenLoaded('approvedBy')),
            'approved_at' => $this->approved_at,
            'decision_reason' => $this->decision_reason,
            'notes' => $this->notes,
            'trip' => new TripResource($this->whenLoaded('trip')),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
