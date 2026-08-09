<?php

namespace Modules\Fleet\Support;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Redis;

/**
 * Driver presence in Redis, the way ADR-0003 intended (ADR-0024 §2).
 *
 * One hash per driver under `duty:{id}`, plus a set of the drivers currently
 * on duty so "who can take this job" is one round trip rather than a `KEYS`
 * scan — `KEYS` is O(n) over the whole keyspace and is the traditional way a
 * dispatch loop takes a production Redis down.
 *
 * ## Unverified in this environment, and said plainly
 *
 * There is no Redis server, no phpredis extension and no predis package on
 * the machine this was written on, so **this driver has never been run** —
 * the same disclosure `RedisLivePositionStore` carries, and the same reason
 * the database store is the default. Shipping an unexercised driver as the
 * default would be shipping a guess.
 *
 * ## Why the hash has no TTL, unlike live positions
 *
 * A vehicle that stops reporting should vanish from the map, so those keys
 * expire. A driver who stops reporting has **not** gone off duty — they have
 * gone into a basement — and expiring the key would lose `on_duty`, so they
 * would come back from lunch signed out without having signed out. Staleness
 * is decided on `recorded_at` by `DriverPresence::isDispatchable()`, which
 * takes them out of the pool without forgetting them; `setDuty(false)` is
 * the only thing that ends a shift.
 */
class RedisDriverPresenceStore implements DriverPresenceStore
{
    /** Drivers currently on duty. Avoids `KEYS` on the dispatch path. */
    private const INDEX = 'duty:index';

    public function setDuty(int $driverId, bool $onDuty, ?int $vehicleId = null): void
    {
        if (! $onDuty) {
            // Off duty clears the position with the row, rather than
            // leaving a point the matcher might rank tomorrow morning —
            // and "off duty at these coordinates" is usually somebody's
            // home address.
            $this->forget($driverId);

            return;
        }

        $existing = $this->get($driverId);

        Redis::hmset($this->key($driverId), array_map(
            // Redis stores strings; a null field would come back as the
            // literal "" and `DriverPresence::fromRow` already treats that
            // as absent. Mapping here keeps the two stores agreeing on what
            // "no value" looks like.
            fn (mixed $value) => $value === null ? '' : (is_bool($value) ? (int) $value : $value),
            [
                'driver_id' => $driverId,
                'on_duty' => true,
                'vehicle_id' => $vehicleId,
                // A driver going on duty again keeps whatever position they
                // last reported, so the very first ranking after they sign
                // in is not blind. It is stale-checked like any other.
                'latitude' => $existing?->latitude,
                'longitude' => $existing?->longitude,
                'accuracy_metres' => $existing?->accuracyMetres,
                'recorded_at' => $existing?->recordedAt?->toDateTimeString(),
            ],
        ));

        Redis::sadd(self::INDEX, $driverId);
    }

    public function heartbeat(DriverPresence $presence): void
    {
        $stored = $this->get($presence->driverId);

        // A heartbeat from a driver who is not on duty is dropped, not
        // stored. The app stops sending them at sign-off, so one arriving
        // is a request that raced the sign-off — and honouring it would put
        // somebody who has put their phone in a drawer back into the pool.
        if ($stored === null || ! $stored->onDuty) {
            return;
        }

        // Read-compare-write rather than a blind HSET: a handset replaying
        // its backlog oldest-first must not drag the driver backwards
        // through a route they already drove. Not a transaction — two
        // concurrent writers for one driver is one device, and the loser of
        // that race is a ping a second apart.
        if ($stored->recordedAt !== null
            && $presence->recordedAt !== null
            && ! $presence->recordedAt->greaterThan($stored->recordedAt)) {
            return;
        }

        Redis::hmset($this->key($presence->driverId), [
            'latitude' => $presence->latitude ?? '',
            'longitude' => $presence->longitude ?? '',
            'accuracy_metres' => $presence->accuracyMetres ?? '',
            'recorded_at' => $presence->recordedAt?->toDateTimeString() ?? '',
            // A driver may swap vehicles mid-shift without signing out.
            'vehicle_id' => $presence->vehicleId ?? $stored->vehicleId ?? '',
        ]);
    }

    public function get(int $driverId): ?DriverPresence
    {
        $row = Redis::hgetall($this->key($driverId));

        return empty($row) ? null : DriverPresence::fromRow($row);
    }

    public function dispatchable(array $driverIds = []): Collection
    {
        $ids = $driverIds !== []
            ? $driverIds
            : array_map('intval', Redis::smembers(self::INDEX));

        return collect($ids)
            ->map(fn (int $id) => $this->get($id))
            ->filter()
            // The same rule `DatabaseDriverPresenceStore` pushes into SQL,
            // applied in PHP here because Redis cannot express it. Both
            // stores must agree, so both defer to the one place it is
            // written down.
            ->filter(fn (DriverPresence $presence) => $presence->isDispatchable())
            ->values();
    }

    public function forget(int $driverId): void
    {
        Redis::del($this->key($driverId));
        Redis::srem(self::INDEX, $driverId);
    }

    private function key(int $driverId): string
    {
        return "duty:{$driverId}";
    }
}