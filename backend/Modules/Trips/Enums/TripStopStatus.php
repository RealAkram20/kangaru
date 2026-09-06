<?php

namespace Modules\Trips\Enums;

/**
 * Where one stop on a run stands (ADR-0045 §2, §6).
 *
 * Not a second lifecycle: the trip's own state machine is untouched, and
 * these move only as side effects of the transitions §2 reuses — a `waiting`
 * carrying a `stop_id` marks the arrival, the `trip_resumed` (or the closing
 * `trip_completed`) marks the departure. `SKIPPED` is §6's first-class case:
 * the ATM was serviced this morning, the road was closed — the row stays,
 * with a reason, and the run is not incomplete for containing one.
 */
enum TripStopStatus: string
{
    /**
     * Asked for, not yet agreed — an extension a passenger requested and the
     * driver has not accepted.
     *
     * The one state that is not evidence of something that happened, and it
     * exists for one reason: an extension changes where the driver is going
     * and what they are owed, so a passenger cannot simply impose one from
     * the back seat. Only `EXTENSION` rows are ever created in this state;
     * every ordinary stop still begins at `PENDING`.
     *
     * A proposal is not part of the journey. `RouteReference` does not route
     * through it, the fare does not count it, and completion does not wait
     * for it — until the driver accepts and it becomes `PENDING` like any
     * other leg. Declining sends it to `SKIPPED` with a reason, which is
     * §6's existing answer for "this was on the run and did not happen".
     */
    case PROPOSED = 'proposed';

    case PENDING = 'pending';
    case ARRIVED = 'arrived';
    case DONE = 'done';
    case SKIPPED = 'skipped';
}
