<?php

namespace Modules\Trips\Enums;

/**
 * Who put a stop on the run (ADR-0045 §4).
 *
 * `PLANNED` is the copy-on-booking path from a client route; the other three
 * are mid-flight additions, and only `ADDED_BY_DRIVER` counts toward
 * `trips.unplanned_stop_count` — the flag §4 is explicit about: recorded and
 * shown, never billed and never hidden.
 */
enum TripStopSource: string
{
    case PLANNED = 'planned';
    case ADDED_BY_DRIVER = 'added_by_driver';
    case ADDED_BY_DISPATCH = 'added_by_dispatch';
    case ADDED_BY_CLIENT = 'added_by_client';
}
