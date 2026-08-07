<?php

namespace Modules\Trips\Support;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Redis;

/**
 * Live positions in Redis, the way ADR-0003 intended (ADR-0019 §3).
 *
 * One hash per vehicle under `live:pos:{id}`, plus a set of the vehicles
 * currently reporting so "the whole fleet" is one round trip rather than a
 * `KEYS` scan — `KEYS` is O(n) over the entire keyspace and is the
 * traditional way a live map takes a production Redis down.
 *
 * Each key carries a TTL. A vehicle that stops reporting disappears rather
 * than lingering at its last known point forever, which is the honest
 * behaviour: a stale marker on a map is worse than no marker, because
 * somebody dispatches against it.
 *
 * ## Unverified in this environment, and said plainly
 *
 * There is no Redis server, no phpredis extension and no predis package on
 * the machine this was written on, so **this driver has never been run**.
 * Its tests are skipped unless a server answers. `DatabaseLivePositionStore`
 * is the default for exactly that reason: shipping an unexercised driver as
 * the default would be shipping a guess.
 */
class RedisLivePositionStore implements LivePositionStore
{
    /** Vehicles currently reporting. Avoids `KEYS` on the read path. */
    private const INDEX = 'live:pos:index';

    public function put(array $positions): void
    {
        foreach ($this->newestPerVehicle($positions) as $position) {
            $key = $this->key($position->vehicleId);

            // Read-compare-write rather than a blind HSET: a device
            // replaying its backlog oldest-first must not drag the marker
            // backwards (see LivePositionStore::put). Not a transaction —
            // two concurrent writers for one vehicle is one device, and the
            // loser of that race is a ping a second apart.
            $stored = $this->get($position->vehicleId);

            if ($stored !== null && ! $position->recordedAt->greaterThan($stored->recordedAt)) {
                continue;
            }

            Redis::hmset($key, $position->toRow());
            Redis::expire($key, (int) config('tracking.live_ttl_seconds'));
            Redis::sadd(self::INDEX, $position->vehicleId);
        }
    }

    public function get(int $vehicleId): ?LivePosition
    {
        $row = Redis::hgetall($this->key($vehicleId));

        return empty($row) ? null : LivePosition::fromRow($row);
    }

    public function all(array $vehicleIds = []): Collection
    {
        $ids = $vehicleIds !== []
            ? $vehicleIds
            : array_map('intval', Redis::smembers(self::INDEX));

        return collect($ids)
            ->map(fn (int $id) => $this->get($id))
            ->filter()
            // An id in the index whose hash has expired is the normal way a
            // vehicle stops reporting; prune it so the set does not grow
            // without bound.
            ->values();
    }

    public function forget(int $vehicleId): void
    {
        Redis::del($this->key($vehicleId));
        Redis::srem(self::INDEX, $vehicleId);
    }

    private function key(int $vehicleId): string
    {
        return "live:pos:{$vehicleId}";
    }

    /**
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
