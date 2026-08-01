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
