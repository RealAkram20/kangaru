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
    case PENDING = 'pending';
    case ARRIVED = 'arrived';
    case DONE = 'done';
    case SKIPPED = 'skipped';
}
