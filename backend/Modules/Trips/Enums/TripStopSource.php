<?php

namespace Modules\Trips\Enums;

/**
 * Who put a row on the run (ADR-0045 §4).
 *
 * `PLANNED` is the copy-on-booking path from a client route; the other three
 * are mid-flight additions, and only `ADDED_BY_DRIVER` counts toward
 * `trips.unplanned_stop_count` — the flag §4 is explicit about: recorded and
 * shown, never billed and never hidden.
 *
 * ## What this no longer answers on its own
 *
 * Since extensions joined this table, "who" and "what kind" are two
 * questions. `TripStopKind` answers the second, and §4's never-billed
 * promise now covers `KIND = stop` rather than every row — the amendment is
 * recorded in ADR-0045 itself.
 *
 * The counter above is the reason they had to separate. All three
 * `ADDED_BY_*` sources can carry an extension, and an extension is billed;
 * folding it in here would have put billed distance inside a counter whose
 * entire meaning is "a note, not a charge". `TripStopService` therefore
 * increments on this source **and** a `stop` kind, never on source alone.
 */
enum TripStopSource: string
{
    case PLANNED = 'planned';
    case ADDED_BY_DRIVER = 'added_by_driver';
    case ADDED_BY_DISPATCH = 'added_by_dispatch';
    case ADDED_BY_CLIENT = 'added_by_client';
}
