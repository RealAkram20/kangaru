<?php

namespace Modules\Trips\Enums;

/**
 * Whether a row on a run is a pause or a change of destination.
 *
 * ## The distinction, and why it earns a column
 *
 * A **stop** is somewhere the vehicle paused on the way to a destination
 * nobody changed — ADR-0045's whole subject, and "recorded and shown, never
 * billed and never hidden".
 *
 * An **extension** is the passenger going further than the drop-off they
 * agreed to. It is not a pause on the way to anywhere; it *moves the end of
 * the journey*, and the fare is recomputed over the longer distance. That is
 * the opposite of §4's posture, which is why the two cannot share a meaning
 * even though the owner chose to have them share a table.
 *
 * Everything that reads `trip_stops` for billing, routing or completion asks
 * this question first. `TripStopSource` still answers a different one — who
 * put the row there — and the two are deliberately orthogonal: a dispatcher
 * can add either, and a driver can add either.
 */
enum TripStopKind: string
{
    case STOP = 'stop';

    case EXTENSION = 'extension';
}
