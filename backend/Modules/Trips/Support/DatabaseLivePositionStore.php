<?php

namespace Modules\Trips\Support;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Live positions in `live_positions` — one row per vehicle (ADR-0019 §3).
 *
 * The default. Not a stand-in for Redis so much as the honest answer at this
 * platform's scale: 2,000 vehicles is 2,000 rows that never leave the buffer
 * pool, and the write is a single upsert on the primary key. What it does
 * *not* do is take load off MySQL entirely, which is the one thing
 * `RedisLivePositionStore` is for at 200 writes/second.
 *
 * Deliberately raw query-builder, not Eloquent: this runs inside the
 * ingestion job for every batch, and hydrating a model per vehicle to write
 * one row it then discards is work for nothing.
 */
class DatabaseLivePositionStore implements LivePositionStore
{
    /** Everything the guarded upsert overwrites, `recorded_at` included. */
    private const COLUMNS = [
        'vehicle_id', 'tenant_id', 'trip_id', 'driver_id',
        'latitude', 'longitude', 'speed_kph', 'heading_degrees', 'recorded_at',
    ];

    public function put(array $positions): void
    {
        $newest = $this->newestPerVehicle($positions);

        if ($newest === []) {
            return;
        }

        DB::statement($this->sql(count($newest)), $this->bindings($newest));
    }

    public function get(int $vehicleId): ?LivePosition
    {
        $row = DB::table('live_positions')->where('vehicle_id', $vehicleId)->first();

        return $row === null ? null : LivePosition::fromRow((array) $row);
    }

    public function all(array $vehicleIds = []): Collection
    {
        return DB::table('live_positions')
            ->when($vehicleIds !== [], fn ($q) => $q->whereIn('vehicle_id', $vehicleIds))
            ->orderByDesc('recorded_at')
            ->get()
            ->map(fn (object $row) => LivePosition::fromRow((array) $row));
    }

    public function forget(int $vehicleId): void
    {
        DB::table('live_positions')->where('vehicle_id', $vehicleId)->delete();
    }

    /**
     * Hand-rolled `INSERT … ON DUPLICATE KEY UPDATE`, because the guard is
     * the point and Laravel's `upsert()` cannot express it.
     *
     * Every column is written **only if the incoming ping is newer than the
     * stored one**. Without that, a device catching up after a tunnel —
     * which sends its backlog oldest-first — drags every marker back
     * through the route it already drove. An unguarded upsert followed by a
     * repair cannot fix this: once the overwrite lands, the newer position
     * it replaced is gone.
     *
     * Written with `VALUES(col)` rather than MySQL 8's `AS new` row alias,
     * and that is not a style choice. AGENTS.md names MySQL 8, but the
     * database this runs against is **MariaDB 10.4**, which does not
     * support the alias form at all — the first version of this statement
     * failed with a syntax error on `AS new`. `VALUES()` is deprecated in
     * MySQL 8.0.20 and still functional there, so it is the one spelling
     * that works on both.
     */
    private function sql(int $rowCount): string
    {
        $columns = implode(', ', self::COLUMNS);
        $placeholders = '('.implode(', ', array_fill(0, count(self::COLUMNS) + 2, '?')).')';
        $values = implode(', ', array_fill(0, $rowCount, $placeholders));

        $guard = 'VALUES(recorded_at) > live_positions.recorded_at';
        $updates = [];

        foreach (self::COLUMNS as $column) {
            if ($column === 'vehicle_id') {
                continue;
            }

            $updates[] = "{$column} = IF({$guard}, VALUES({$column}), live_positions.{$column})";
        }

        $updates[] = "updated_at = IF({$guard}, VALUES(updated_at), live_positions.updated_at)";

        return "INSERT INTO live_positions ({$columns}, created_at, updated_at) VALUES {$values} ".
            'ON DUPLICATE KEY UPDATE '.implode(', ', $updates);
    }

    /**
     * @param  array<int, LivePosition>  $positions
     * @return array<int, mixed>
     */
    private function bindings(array $positions): array
    {
        $now = now()->toDateTimeString();
        $bindings = [];

        foreach ($positions as $position) {
            $row = $position->toRow();

            foreach (self::COLUMNS as $column) {
                $bindings[] = $row[$column];
            }

            $bindings[] = $now;
            $bindings[] = $now;
        }

        return $bindings;
    }

    /**
     * A batch can hold several pings for one vehicle; only the newest can
     * legitimately stand, and sending all of them would make the result
     * depend on insertion order inside the statement.
     *
     * @param  array<int, LivePosition>  $positions
     * @return array<int, LivePosition>
     */
    private function newestPerVehicle(array $positions): array
    {
        $newest = [];

        foreach ($positions as $position) {
            $current = $newest[$position->vehicleId] ?? null;

            if ($current === null || $position->recordedAt->greaterThan($current->recordedAt)) {
                $newest[$position->vehicleId] = $position;
            }
        }

        return array_values($newest);
    }
}
