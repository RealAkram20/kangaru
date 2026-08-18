<?php

namespace Modules\Trips\Distance;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * A trip's pings as `TracePoint`s, in recorded order (ADR-0045).
 *
 * The query is deliberately tenant-scope-free, for the reason
 * `RouteDistanceCalculator::points()` gives (ADR-0001's raw-query exception):
 * it is keyed on a `trip_id` the caller has already resolved, and it runs in
 * a queued job with no tenant bound — where `TenantScope` would fail closed
 * and return nothing for every trip, walk-in or not.
 *
 * A cursor rather than a `get()`: an upcountry trip is tens of thousands of
 * rows and this needs six columns of each, once.
 */
class TraceLoader
{
    /**
     * @return array<int, TracePoint>
     */
    public function pointsFor(int $tripId): array
    {
        $points = [];

        $rows = DB::table('trip_locations')
            ->select('latitude', 'longitude', 'recorded_at', 'accuracy_metres', 'speed_kph', 'is_mock', 'id')
            ->where('trip_id', $tripId)
            // `id` breaks ties: DATETIME has second resolution, so pings from
            // the same second would otherwise come back in an arbitrary
            // order and zig-zag the route.
            ->orderBy('recorded_at')
            ->orderBy('id')
            ->cursor();

        foreach ($rows as $row) {
            $points[] = new TracePoint(
                latitude: (float) $row->latitude,
                longitude: (float) $row->longitude,
                recordedAt: Carbon::parse($row->recorded_at)->getTimestamp(),
                accuracyMetres: $row->accuracy_metres === null ? null : (float) $row->accuracy_metres,
                speedKph: $row->speed_kph === null ? null : (float) $row->speed_kph,
                isMock: (bool) $row->is_mock,
            );
        }

        return $points;
    }
}
