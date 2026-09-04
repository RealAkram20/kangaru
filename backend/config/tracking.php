<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Raw ping retention
    |--------------------------------------------------------------------------
    |
    | ADR-0003: "Retention: raw pings 12 months, then downsampled polylines
    | only." `trip_locations` is partitioned by month, so retention is a
    | DROP PARTITION rather than a DELETE — instant, and it never competes
    | with live traffic for row locks.
    |
    | The downsampled-polyline half of that sentence is not built; dropping a
    | partition today discards the route rather than compacting it. See
    | Modules/Trips/README.md.
    |
    */

    'retention_months' => (int) env('TRACKING_RETENTION_MONTHS', 12),

    /*
    |--------------------------------------------------------------------------
    | Partition headroom
    |--------------------------------------------------------------------------
    |
    | How many future months to keep carved out of the MAXVALUE catch-all.
    | The table always has a `p_future` partition, so ingestion never fails
    | because maintenance did not run — but rows landing there are not
    | separable for retention until it is reorganised, so the command keeps
    | a few months ahead.
    |
    */

    'partitions_ahead' => (int) env('TRACKING_PARTITIONS_AHEAD', 3),

    /*
    |--------------------------------------------------------------------------
    | Odometer / GPS variance
    |--------------------------------------------------------------------------
    |
    | SUPERSEDED by the `tracking` settings group (ADR-0035). The threshold
    | and the odometer ceiling are now operator policy, set in the console,
    | validated, cached and audited like every other setting — an env var
    | needed a deploy to change and appeared nowhere an office could see it.
    |
    | This entry is left as documentation of where the number used to live.
    | Nothing reads it: `TripStateMachine::reconcileAgainstGps()` asks
    | `SettingsService`, whose catalogue default is the same 10, so an
    | existing deployment behaves identically until somebody changes it.
    |
    | If TRACKING_VARIANCE_THRESHOLD_PERCENT is set in an environment, it is
    | now inert. Set the value in the console instead.
    |
    */

    'variance_threshold_percent' => (float) env('TRACKING_VARIANCE_THRESHOLD_PERCENT', 10),

    /*
    |--------------------------------------------------------------------------
    | Ingestion
    |--------------------------------------------------------------------------
    |
    | Upper bound on pings accepted in one request. At ADR-0003's one-ping-
    | per-10-seconds cadence this is over an hour of driving, which is ample
    | for a device catching up after a tunnel or an upcountry dead zone,
    | while still bounding the work a single request can queue.
    |
    */

    'max_pings_per_request' => (int) env('TRACKING_MAX_PINGS_PER_REQUEST', 500),

    /*
    |--------------------------------------------------------------------------
    | GPS noise floor
    |--------------------------------------------------------------------------
    |
    | Segments shorter than this are treated as the receiver wandering rather
    | than the vehicle moving. A parked vehicle still pings, and that jitter
    | otherwise sums into billed distance — on the very figure meant to catch
    | a wrong odometer reading.
    |
    */

    'min_segment_metres' => (float) env('TRACKING_MIN_SEGMENT_METRES', 5),

    /*
    |--------------------------------------------------------------------------
    | Live positions (ADR-0019)
    |--------------------------------------------------------------------------
    |
    | Where "where is the fleet right now" is answered from. `redis` is what
    | ADR-0003 specifies and what production should run; `database` is a
    | `live_positions` table of one row per vehicle, which meets the same
    | requirement at this scale and is the only driver testable without a
    | Redis server.
    |
    | The default is `database` deliberately: the Redis driver has never been
    | exercised in this repository's environment, and defaulting to an
    | unrun code path is shipping a guess.
    |
    */

    'live_positions_driver' => env('TRACKING_LIVE_POSITIONS_DRIVER', 'database'),

    /*
    | How long a Redis position entry survives without an update. Past this
    | a vehicle simply disappears from the map, which is the honest
    | behaviour — a stale marker is worse than none, because somebody
    | dispatches against it. Unused by the database driver, which keeps the
    | row and lets `stale` on the response say so.
    */

    'live_ttl_seconds' => (int) env('TRACKING_LIVE_TTL_SECONDS', 900),

    /*
    | Older than this and a position is reported `stale: true`. PROJECT.md
    | asks for "<15 s freshness" on the live map; this is deliberately
    | looser, because 15 s is the target for the ingestion pipeline and a
    | marker flashing stale every time a driver goes under a flyover would
    | train dispatchers to ignore the flag.
    */

    'live_stale_after_seconds' => (int) env('TRACKING_LIVE_STALE_AFTER_SECONDS', 60),

];
