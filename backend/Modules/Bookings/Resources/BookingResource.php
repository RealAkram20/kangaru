<?php

namespace Modules\Bookings\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Administration\Resources\UserResource;
use Modules\Bookings\Models\Booking;
use Modules\Bookings\Support\BookingDetails;
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
            // Which client this booking belongs to, by name.
            //
            // ADR-0006 gave Shanitah's own staff one cross-client queue,
            // and its own words are that such a queue "does not show which
            // client each row belongs to is worse than no cross-client
            // queue". `tenant_id` above has always been here and is not an
            // answer: a dispatcher cannot read "3".
            //
            // Loaded only when the reader is platform-level, so a client's
            // own listing does not pay for a join telling them their own
            // name. Absent, not null, when not loaded — `whenLoaded` omits
            // the key entirely, which is how a client can tell "not
            // applicable" from "no client".
            'client' => $this->whenLoaded('tenant', function () {
                // Read once into a local rather than dereferenced twice.
                // The relation types as nullable — `whenLoaded` itself
                // returns null for a loaded-but-null relation before this
                // closure ever runs, so the branch below is that same
                // answer written where the type system can see it.
                $client = $this->tenant;

                return $client === null ? null : ['id' => $client->id, 'name' => $client->name];
            }),
            'requested_by_user_id' => $this->requested_by_user_id,
            'requested_by' => new UserResource($this->whenLoaded('requestedBy')),
            // The colleague this was raised for, when a client raised it.
            // The name and number below stay authoritative — they are the
            // snapshot the driver was dispatched against — and this is what
            // lets a queue be read by employee rather than by spelling.
            'passenger_user_id' => $this->passenger_user_id,
            'passenger_name' => $this->passenger_name,
            'passenger_phone' => $this->passenger_phone,
            'passenger_count' => $this->passenger_count,
            // ADR-0051. Null means no preference was stated, which is not
            // the same as a preference that was overridden — the office and
            // a client's auditor both need to be able to tell those apart,
            // so this is never coerced to a default.
            'vehicle_category' => $this->vehicle_category,
            // ADR-0064: which of the three services this asks for.
            'service_type' => $this->service_type->value,
            // Allow-listed per service, never the column wholesale — the
            // OrderDetails lesson: a JSON column named `details` is exactly
            // where a personal number leaks looking innocent in review.
            // Null on a ride, whose absence of details is the fact itself.
            'details' => BookingDetails::for($this->resource),
            // Null on a self-drive rental, which has no route — the hire
            // period in `details` is that service's when-and-where.
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
