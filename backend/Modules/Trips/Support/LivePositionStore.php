<?php

namespace Modules\Trips\Support;

use Illuminate\Support\Collection;

/**
 * Where every vehicle is right now (ADR-0019).
 *
 * An interface with two implementations because ADR-0003 says live tracking
 * reads "from Redis, never MySQL" and this platform does not have a Redis
 * server in every environment it runs in. The *requirement* underneath that
 * sentence is what matters: answer "where is the fleet" in milliseconds
 * without touching the 500M-row history table, at <15 s freshness.
 * `RedisLivePositionStore` meets it the way the ADR intended;
 * `DatabaseLivePositionStore` meets it with 2,000 hot rows, which is a
 * legitimate answer at this scale and the only one testable without a
 * server running.
 *
 * Callers depend on this, never on either driver, so switching is a config
 * change rather than a code change.
 */
interface LivePositionStore
{
    /**
     * Records the newest position for each vehicle in the batch.
     *
     * Idempotent and last-writer-wins by design: this is a snapshot, not a
     * log, and a replayed ping batch must not corrupt it. Older pings than
     * the one already stored are ignored — a device catching up after a
     * tunnel sends its backlog oldest-first, and letting that overwrite the
     * current position would make the map walk backwards.
     *
     * @param  array<int, LivePosition>  $positions
     */
    public function put(array $positions): void;

    /** Null when the vehicle has never reported, or its entry has expired. */
    public function get(int $vehicleId): ?LivePosition;

    /**
     * @param  array<int, int>  $vehicleIds  empty means every vehicle
     * @return Collection<int, LivePosition>
     */
    public function all(array $vehicleIds = []): Collection;

    /** Used by retention and by tests; not part of the read path. */
    public function forget(int $vehicleId): void;
}
