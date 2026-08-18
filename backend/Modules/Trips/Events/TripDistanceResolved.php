<?php

namespace Modules\Trips\Events;

use Illuminate\Foundation\Events\Dispatchable;
use Modules\Trips\Models\DistanceEvidence;
use Modules\Trips\Models\Trip;

/**
 * A trip's distance has been resolved and its evidence written (ADR-0045).
 *
 * Raised by `DistanceResolutionService::resolve()`, after the transaction,
 * every time — including a second resolution when late pings arrived.
 *
 * **Nothing listens yet.** It exists now so that Phase 2 of
 * `docs/measured-distance-plan.md` — moving walk-in settlement from
 * `TripCompleted` to this event, so a fare is priced from a resolved figure
 * rather than at the kerb — is a listener registration and not a change to
 * this module. Same reasoning as `TripCompleted`: Billing depends on Trips,
 * and the state machine must not call Billing back.
 */
class TripDistanceResolved
{
    use Dispatchable;

    public function __construct(
        public readonly Trip $trip,
        public readonly DistanceEvidence $evidence,
    ) {}
}
