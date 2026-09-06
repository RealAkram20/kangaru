<?php

namespace Modules\Trips\Services;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Modules\Trips\Support\LivePosition;
use Modules\Trips\Support\LivePositionStore;

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
    public function __construct(private readonly LivePositionStore $livePositions) {}

    /**
     * Each ping carries `latitude`, `longitude` and `recorded_at`, and
     * optionally `speed_kph`, `heading_degrees`, `accuracy_metres` and
     * `is_mock`.
     *
     * Typed loosely rather than as an array shape because the payload
     * arrives from StoreTripLocationsRequest by way of a serialised queue
     * job — the shape is guaranteed by validation, and PHPStan cannot see
     * through the round trip.
     *
     * @param  array<int, array<string, mixed>>  $pings
     * @return int the number of pings written
     */
    public function record(?int $tenantId, int $tripId, array $pings): int
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
            // Absent is false, not null: the column is NOT NULL DEFAULT 0
            // and "the device did not say so" is the same fact either way.
            'is_mock' => (bool) ($ping['is_mock'] ?? false),
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

        // ADR-0019. The history is written first and the snapshot second,
        // deliberately: the route is evidence and must survive even if the
        // live store is unreachable, whereas a missed snapshot costs one
        // map refresh. If the order were reversed a Redis outage would take
        // billing distance with it.
        $this->updateLivePosition($tenantId, $tripId, $pings);

        return count($rows);
    }

    /**
     * Records the newest ping in the batch as the vehicle's current
     * position (ADR-0019).
     *
     * Failures are logged and swallowed. The alternative is a live-map
     * dependency that can fail a ping batch and, through the job's retry,
     * duplicate a stretch of route into the table billing reads from. A map
     * one refresh out of date is a smaller problem than a billing dispute.
     *
     * @param  array<int, array<string, mixed>>  $pings
     */
    private function updateLivePosition(?int $tenantId, int $tripId, array $pings): void
    {
        try {
            $trip = DB::table('trips')->where('id', $tripId)->first(['vehicle_id', 'driver_id']);

            if ($trip === null) {
                return;
            }

            $latest = null;

            foreach ($pings as $ping) {
                $at = Carbon::parse($ping['recorded_at']);

                if ($latest === null || $at->greaterThan(Carbon::parse($latest['recorded_at']))) {
                    $latest = $ping;
                }
            }

            if ($latest === null) {
                return;
            }

            $this->livePositions->put([new LivePosition(
                vehicleId: (int) $trip->vehicle_id,
                tenantId: $tenantId,
                tripId: $tripId,
                driverId: $trip->driver_id === null ? null : (int) $trip->driver_id,
                latitude: (float) $latest['latitude'],
                longitude: (float) $latest['longitude'],
                speedKph: isset($latest['speed_kph']) ? (float) $latest['speed_kph'] : null,
                headingDegrees: isset($latest['heading_degrees']) ? (int) $latest['heading_degrees'] : null,
                recordedAt: Carbon::parse($latest['recorded_at']),
            )]);
        } catch (\Throwable $e) {
            Log::warning('live_position.update_failed', [
                'trip_id' => $tripId,
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
