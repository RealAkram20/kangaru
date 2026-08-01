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
    | PROJECT.md: "Odometer distance is automatically reconciled against
    | GPS-calculated distance; variances beyond a configurable threshold are
    | flagged for review." This is that threshold, as a percentage of the
    | odometer distance.
    |
    | 10% is deliberately loose for a first pass: GPS traces are noisy, and a
    | flag nobody trusts is a flag nobody reviews. PROJECT.md's success metric
    | is that flagged trips are reviewed within 2 business days, which only
    | works if the flag is rare.
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

];
