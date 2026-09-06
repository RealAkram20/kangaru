<?php

namespace Modules\Trips\Events;

use App\Models\User;
use Illuminate\Foundation\Events\Dispatchable;
use Modules\Trips\Models\Trip;

/**
 * A person cleared a held distance (ADR-0045 §2; Phase 2 of the plan).
 *
 * Raised by `DistanceClearanceService::clear()` after the clearance is
 * written. What listens is the same pair that listens to
 * `TripDistanceResolved` — settle the walk-in fare, credit the driver —
 * because a hold that is lifted is a resolution that may now bill. Raised as
 * its own event rather than re-raising `TripDistanceResolved`, because no
 * new evidence exists; a person overruled the old evidence, and a listener
 * that wanted to tell the two apart should be able to.
 */
class TripDistanceCleared
{
    use Dispatchable;

    public function __construct(
        public readonly Trip $trip,
        public readonly User $clearedBy,
    ) {}
}
