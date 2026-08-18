<?php

namespace Modules\Trips\Distance;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Modules\Trips\Events\TripDistanceCleared;
use Modules\Trips\Models\Trip;

/**
 * A person overrules a held distance (ADR-0045 §2; Phase 2 of the plan).
 *
 * The one write the review queue makes. It does not change the figure — the
 * trip bills on `billed_distance_km` as the resolver left it — it lifts the
 * hold, and records who, when and why on the trip. `Trip` is `Auditable`,
 * so the clearance lands in the audit log with its diff like every other
 * money act; the evidence row it overrules is untouched and still says C.
 *
 * Idempotent: clearing a trip already cleared returns it unchanged and
 * raises nothing — a double-click must not re-settle a fare.
 *
 * @throws DistanceNotHeldException the trip is not held, so there is nothing to clear
 */
class DistanceClearanceService
{
    public function clear(Trip $trip, User $by, string $reason): Trip
    {
        if ($trip->distance_cleared_at !== null) {
            return $trip;
        }

        // C is held under every policy; U is held under a trace-priced one.
        // Both are a person's to clear; anything else has nothing to clear.
        if (! in_array($trip->distance_grade, [DistanceGrade::HELD, DistanceGrade::UNVERIFIED], true)) {
            throw new DistanceNotHeldException($trip);
        }

        DB::transaction(function () use ($trip, $by, $reason) {
            $trip->forceFill([
                'distance_cleared_at' => now(),
                'distance_cleared_by_user_id' => $by->id,
                'distance_cleared_reason' => $reason,
            ])->save();
        });

        TripDistanceCleared::dispatch($trip, $by);

        return $trip;
    }
}
