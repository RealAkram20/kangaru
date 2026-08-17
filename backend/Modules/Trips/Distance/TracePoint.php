<?php

namespace Modules\Trips\Distance;

/**
 * One GPS ping as the resolver sees it (ADR-0045).
 *
 * A plain immutable value rather than the `TripLocation` model, so the
 * cleaner and the measurer can be exercised on a hand-built trace in a unit
 * test with no database and no tenant bound — and so a batch of ten thousand
 * upcountry pings is ten thousand small objects rather than ten thousand
 * Eloquent models carrying casts and event hooks nobody here needs.
 *
 * `recordedAt` is a Unix timestamp in seconds, from the **device's** clock —
 * the same clock `trip_locations.recorded_at` keeps. Every time comparison in
 * this namespace is between two of these, so the offset of that clock from the
 * server's cancels out; only its *rate* matters, and a handset's clock does not
 * gain minutes over a trip.
 */
final class TracePoint
{
    public function __construct(
        public readonly float $latitude,
        public readonly float $longitude,
        public readonly int $recordedAt,
        public readonly ?float $accuracyMetres = null,
        public readonly ?float $speedKph = null,
        public readonly bool $isMock = false,
    ) {}
}
