<?php

namespace Modules\Trips\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Modules\Trips\Models\Trip;

/**
 * One row of the distance review queue (ADR-0045 §2).
 *
 * Deliberately **not** `TripResource`. That resource serves a trip to a
 * driver's handset and to the trips board, and carries a settled fare, a
 * payment method, contact details and an estimate — none of which this screen
 * reads, several of which cost a query each, and one of which (the passenger's
 * phone) ADR-0024 §7 releases only to the driver on a live trip. A queue row
 * is: which trip, whose, who drove it, what the resolver said, and how long it
 * has been waiting.
 *
 * @mixin Trip
 */
class HeldTripResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'trip_id' => $this->id,
            'tenant_id' => $this->tenant_id,
            // The client's name, for a platform reader working across them.
            // Null for a walk-in, which belongs to nobody but the platform,
            // and absent for a client's own user, who has exactly one.
            'client' => $this->whenLoaded('tenant', fn () => $this->tenant?->name),
            'origin' => $this->origin,
            'destination' => $this->destination,
            'completed_at' => $this->completed_at?->toIso8601String(),
            'driver_name' => $this->driver?->name,
            'vehicle_registration' => $this->vehicle?->registration_number,
            'grade' => $this->distance_grade?->value,
            'grade_label' => $this->distance_grade?->label(),
            'billed_km' => $this->billed_distance_km === null ? null : (float) $this->billed_distance_km,
            'odometer_km' => $this->distance_km === null ? null : (float) $this->distance_km,
            'resolved_at' => $this->distance_resolved_at?->toIso8601String(),
            // Whole days since the resolution, for the two-business-day metric
            // PROJECT.md sets against this queue. Computed here rather than in
            // the client so the screen and any future alert agree.
            'waiting_days' => $this->distance_resolved_at === null
                ? null
                : (int) $this->distance_resolved_at->diffInDays(now()),
            // Whether anything is actually blocked behind it. A held walk-in
            // has an unsettled fare and an unpaid driver; a held corporate
            // trip has an invoice nobody can raise.
            'is_walk_in' => $this->isWalkIn(),
            'fare_settled' => $this->fare_minor !== null,
        ];
    }
}
