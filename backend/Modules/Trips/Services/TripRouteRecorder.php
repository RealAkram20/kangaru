<?php

namespace Modules\Trips\Services;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Writes a batch of GPS pings for one trip.
 *
 * ADR-0003 puts a batch-inserting worker between the API and MySQL rather
 * than writing each ping on the request path — at target scale that is ~200
 * small inserts a second competing with bookings, dispatch and billing for
 * the primary database.
 *
 * Deliberately the query builder, not Eloquent: 500 pings should be one
 * INSERT, not 500 model saves each firing events. TripLocation's
 * append-only guards cover the path where somebody loads a ping and edits
 * it; this path never produces a model at all.
 */
class TripRouteRecorder
{
    /**
     * Each ping carries `latitude`, `longitude` and `recorded_at`, and
     * optionally `speed_kph`, `heading_degrees` and `accuracy_metres`.
     *
     * Typed loosely rather than as an array shape because the payload
     * arrives from StoreTripLocationsRequest by way of a serialised queue
     * job — the shape is guaranteed by validation, and PHPStan cannot see
     * through the round trip.
     *
     * @param  array<int, array<string, mixed>>  $pings
     * @return int the number of pings written
     */
    public function record(int $tenantId, int $tripId, array $pings): int
    {
        if ($pings === []) {
            return 0;
        }

        $now = Carbon::now();

        $rows = array_map(fn (array $ping) => [
            'tenant_id' => $tenantId,
            'trip_id' => $tripId,
            'latitude' => $ping['latitude'],
            'longitude' => $ping['longitude'],
            'speed_kph' => $ping['speed_kph'] ?? null,
            'heading_degrees' => $ping['heading_degrees'] ?? null,
            'accuracy_metres' => $ping['accuracy_metres'] ?? null,
            // The device's clock, not the server's: a ping captured in a
            // dead zone and synced an hour later belongs to the month it
            // was recorded in, which is the month its trip is billed in and
            // the partition it must land in.
            'recorded_at' => Carbon::parse($ping['recorded_at'])->toDateTimeString(),
            'created_at' => $now,
        ], array_values($pings));

        // Chunked so one oversized replay from a device that was offline all
        // day cannot build a single statement past max_allowed_packet.
        foreach (array_chunk($rows, 200) as $chunk) {
            DB::table('trip_locations')->insert($chunk);
        }

        return count($rows);
    }
}
