<?php

namespace Modules\Trips\Services;

use Illuminate\Support\Facades\DB;

/**
 * Measures how far a trip actually travelled, from its GPS trace.
 *
 * ADR-0003: "MySQL holds historical routes for replay and billing distance
 * verification." This is the verification half — the figure the driver's
 * odometer reading is checked against.
 *
 * Haversine over consecutive points. It treats the Earth as a sphere, which
 * is wrong by about 0.5% at worst; a road route is a chain of short hops
 * where that error is far smaller than GPS's own, and the number it produces
 * is a cross-check on an odometer, not a replacement for one.
 */
class RouteDistanceCalculator
{
    /** Mean Earth radius in metres (IUGG). */
    private const EARTH_RADIUS_METRES = 6_371_008.8;

    /**
     * Total route distance in kilometres, or null when the trip has fewer
     * than two points.
     *
     * Null and zero are different answers and must stay different: null is
     * "there is no GPS evidence for this trip", zero is "the vehicle did not
     * move". Reconciliation flags a variance on the second and declines to
     * judge on the first.
     */
    public function kilometresFor(int $tripId): ?float
    {
        $metres = 0.0;
        $previous = null;
        $points = 0;

        foreach ($this->points($tripId) as $point) {
            $points++;

            if ($previous !== null) {
                $segment = $this->metresBetween(
                    (float) $previous->latitude,
                    (float) $previous->longitude,
                    (float) $point->latitude,
                    (float) $point->longitude,
                );

                // A stationary vehicle still emits pings, and consumer GPS
                // wanders by several metres while it does. Over a 20-minute
                // wait at one ping per 10 seconds that jitter sums to a few
                // hundred metres of distance the vehicle never travelled —
                // billed distance, on a figure meant to catch odometer
                // fraud. Segments below the noise floor are dropped.
                if ($segment >= $this->minimumSegmentMetres()) {
                    $metres += $segment;
                }
            }

            $previous = $point;
        }

        if ($points < 2) {
            return null;
        }

        return round($metres / 1000, 2);
    }

    /**
     * Where the trace starts and where it ends (ADR-0047 §2).
     *
     * Two `[latitude, longitude]` pairs, or null when the trip has fewer than
     * two points. `TripDistanceResolver` routes between them to bound a
     * GPS-priced fare.
     *
     * **The trace's own endpoints, not the order request's pickup and
     * drop-off**, and the difference matters. A corporate trip frequently has
     * no drop-off pin at all — `order_requests` carries a pickup and the
     * destination is prose — so a bound built from the order would simply be
     * unavailable for the trips this platform mostly carries. The trace
     * always has two ends, and they describe the journey that was actually
     * driven rather than the one that was booked.
     *
     * Read with two small ordered queries rather than by draining the cursor
     * in `kilometresFor`: a long upcountry trip is tens of thousands of rows
     * and this needs exactly two of them.
     *
     * @return array{0: array{float, float}, 1: array{float, float}}|null
     */
    public function endpointsFor(int $tripId): ?array
    {
        $first = $this->edge($tripId, 'asc');
        $last = $this->edge($tripId, 'desc');

        // The same row at both ends means a single ping. That is not a
        // journey to bound, and `kilometresFor` returns null for it too.
        if ($first === null || $last === null || $first->id === $last->id) {
            return null;
        }

        return [
            [(float) $first->latitude, (float) $first->longitude],
            [(float) $last->latitude, (float) $last->longitude],
        ];
    }

    private function edge(int $tripId, string $direction): ?\stdClass
    {
        return DB::table('trip_locations')
            ->select('latitude', 'longitude', 'id')
            ->where('trip_id', $tripId)
            // Ordered exactly as `points()` orders, `id` tie-break included,
            // so the endpoints are the same rows the distance was measured
            // between. Two orderings over one table is how a bound ends up
            // being computed against a different journey than the trace.
            ->orderBy('recorded_at', $direction)
            ->orderBy('id', $direction)
            ->first();
    }

    /**
     * Streams the trip's points in recorded order.
     *
     * A query-builder cursor rather than an Eloquent get(): a long upcountry
     * trip is tens of thousands of rows, and this only ever needs four
     * columns of each.
     *
     * The query is deliberately tenant-scope-free (ADR-0001's raw-query
     * exception) — it is keyed on a `trip_id` the caller has already
     * resolved through a tenant-scoped Trip, and adding `tenant_id` would
     * change nothing except which index is chosen.
     *
     * @return \Generator<int, \stdClass>
     */
    private function points(int $tripId): \Generator
    {
        yield from DB::table('trip_locations')
            ->select('latitude', 'longitude', 'recorded_at', 'id')
            ->where('trip_id', $tripId)
            // `id` breaks ties: DATETIME has second resolution, so pings
            // from the same second would otherwise come back in an
            // arbitrary order and zig-zag the route.
            ->orderBy('recorded_at')
            ->orderBy('id')
            ->cursor();
    }

    private function minimumSegmentMetres(): float
    {
        return (float) config('tracking.min_segment_metres', 5);
    }

    /**
     * Great-circle distance between two points, in metres.
     */
    public function metresBetween(float $fromLat, float $fromLng, float $toLat, float $toLng): float
    {
        $latFrom = deg2rad($fromLat);
        $latTo = deg2rad($toLat);
        $deltaLat = deg2rad($toLat - $fromLat);
        $deltaLng = deg2rad($toLng - $fromLng);

        $a = sin($deltaLat / 2) ** 2
            + cos($latFrom) * cos($latTo) * sin($deltaLng / 2) ** 2;

        return 2 * self::EARTH_RADIUS_METRES * asin(min(1.0, sqrt($a)));
    }
}
