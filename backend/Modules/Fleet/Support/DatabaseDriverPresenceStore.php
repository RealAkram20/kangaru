<?php

namespace Modules\Fleet\Support;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Driver presence in `driver_presence` — one row per driver (ADR-0024 §2).
 *
 * The default, and not a stand-in: a few thousand drivers is a few thousand
 * rows that never leave the buffer pool, the write is a single upsert on the
 * primary key, and the dispatch read is one indexed scan. What it does not
 * do is take the write load off MySQL entirely, which is the one thing
 * `RedisDriverPresenceStore` is for.
 *
 * Raw query builder rather than Eloquent, matching
 * `DatabaseLivePositionStore`: this runs on every heartbeat from every
 * handset, and hydrating a model to write one row it then discards is work
 * for nothing.
 */
class DatabaseDriverPresenceStore implements DriverPresenceStore
{
    public function setDuty(int $driverId, bool $onDuty, ?int $vehicleId = null): void
    {
        $now = now()->toDateTimeString();

        DB::table('driver_presence')->upsert(
            [[
                'driver_id' => $driverId,
                'on_duty' => $onDuty,
                'vehicle_id' => $vehicleId,
                // Cleared on going off duty (see the interface): a driver
                // who has finished should not leave a point the matcher
                // could rank tomorrow, and where somebody was when they
                // signed off is usually where they live.
                'latitude' => null,
                'longitude' => null,
                'accuracy_metres' => null,
                'recorded_at' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]],
            ['driver_id'],
            ['on_duty', 'vehicle_id', 'latitude', 'longitude', 'accuracy_metres', 'recorded_at', 'updated_at'],
        );
    }

    /**
     * Hand-rolled `INSERT … ON DUPLICATE KEY UPDATE`, for the same reason
     * `DatabaseLivePositionStore` hand-rolls its own: the guard is the point
     * and Laravel's `upsert()` cannot express it.
     *
     * Two things are guarded, not one:
     *
     * 1. **Older pings never overwrite newer ones.** A handset replaying a
     *    backlog after a tunnel sends oldest-first.
     * 2. **A heartbeat does nothing at all to an off-duty driver.** The row
     *    is upserted, so a ping that raced a driver's own "go off duty"
     *    would otherwise write a position back onto the row `setDuty()` had
     *    just cleared — undoing the one thing that clearing was for, since
     *    where a driver was when they signed off is usually where they live.
     *
     * The second guard belongs in the SQL rather than as an early return
     * above it, and that is worth saying because the first version put it in
     * the controller instead. `DriverPresenceController` does refuse an
     * off-duty ping with 409, which made this whole statement look safe —
     * and made the *store* untested, because no request could reach it in
     * the state the guard exists for. Mutating the column list did not fail
     * a single test. `DriverPresenceStoreTest` now exercises the store
     * directly, and this clause is what it exercises.
     *
     * `VALUES(col)` rather than MySQL 8's `AS new` row alias, because the
     * database this runs against is MariaDB 10.4, which does not support the
     * alias form at all. The note on `DatabaseLivePositionStore::sql()`
     * records that being found the hard way.
     */
    public function heartbeat(DriverPresence $presence): void
    {
        $row = $presence->toRow();
        $now = now()->toDateTimeString();

        $guard = 'driver_presence.on_duty = 1 AND '
            .'(driver_presence.recorded_at IS NULL OR VALUES(recorded_at) > driver_presence.recorded_at)';

        $updates = [];

        foreach (['vehicle_id', 'latitude', 'longitude', 'accuracy_metres', 'recorded_at', 'updated_at'] as $column) {
            $updates[] = "{$column} = IF({$guard}, VALUES({$column}), driver_presence.{$column})";
        }

        DB::statement(
            'INSERT INTO driver_presence '
            .'(driver_id, on_duty, vehicle_id, latitude, longitude, accuracy_metres, recorded_at, created_at, updated_at) '
            .'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) '
            .'ON DUPLICATE KEY UPDATE '.implode(', ', $updates),
            [
                $row['driver_id'],
                // On insert only. The `ON DUPLICATE KEY UPDATE` list above
                // deliberately omits `on_duty`, so an existing row keeps
                // whatever `setDuty()` last wrote — see the docblock.
                $row['on_duty'],
                $row['vehicle_id'],
                $row['latitude'],
                $row['longitude'],
                $row['accuracy_metres'],
                $row['recorded_at'],
                $now,
                $now,
            ],
        );
    }

    public function get(int $driverId): ?DriverPresence
    {
        $row = DB::table('driver_presence')->where('driver_id', $driverId)->first();

        return $row === null ? null : DriverPresence::fromRow((array) $row);
    }

    public function dispatchable(array $driverIds = []): Collection
    {
        $cutoff = now()->subSeconds((int) config('dispatch.presence_ttl_seconds'));

        return DB::table('driver_presence')
            ->where('on_duty', true)
            ->when($driverIds !== [], fn ($q) => $q->whereIn('driver_id', $driverIds))
            // The staleness cut, pushed into SQL rather than filtered in
            // PHP — this is the hottest read in dispatch and it must not
            // load the whole roster to discard most of it.
            //
            // The `whereNull('latitude')` branch is the location-refused
            // driver: still dispatchable, just not rankable by distance.
            // Dropping them here would be a silent per-driver outage that
            // looks like a matcher playing favourites. `DriverPresence::
            // isDispatchable()` states the same rule for the Redis store,
            // which cannot push it into a query.
            ->where(fn ($q) => $q->whereNull('latitude')->orWhere('recorded_at', '>=', $cutoff))
            ->get()
            ->map(fn (object $row) => DriverPresence::fromRow((array) $row));
    }

    public function forget(int $driverId): void
    {
        DB::table('driver_presence')->where('driver_id', $driverId)->delete();
    }
}