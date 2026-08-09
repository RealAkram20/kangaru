<?php

namespace Modules\Fleet\Support;

use Illuminate\Support\Collection;

/**
 * Who is on duty and where, right now (ADR-0024 §2).
 *
 * An interface with two implementations for the same reason
 * `LivePositionStore` has two: ADR-0003 wants live state in Redis, and this
 * platform does not have a Redis server in every environment it runs in.
 * The requirement underneath is what matters — answer "who is waiting for
 * work near this pickup" in milliseconds, on every dispatch — and at a
 * couple of thousand drivers a single indexed table meets it.
 *
 * Callers depend on this, never on either implementation, so switching is a
 * config change rather than a code change.
 */
interface DriverPresenceStore
{
    /**
     * Records a driver going on or off duty.
     *
     * Separate from `heartbeat()` because they are different acts with
     * different frequencies: this happens twice a shift and is a decision,
     * that happens every minute and is telemetry. Folding them into one
     * `put()` would mean the app had to resend a position it may not have
     * in order to change a boolean it does have.
     *
     * Going **off** duty clears the position. A driver who has finished for
     * the day should not leave a point on the map that the matcher might
     * rank tomorrow morning, and "off duty at these coordinates" is a fact
     * about somebody's home address that this platform has no reason to keep.
     */
    public function setDuty(int $driverId, bool $onDuty, ?int $vehicleId = null): void;

    /**
     * Records where an on-duty driver is.
     *
     * Last-writer-wins by timestamp, like `LivePositionStore::put` and for
     * the same reason: a handset catching up after a tunnel sends its
     * backlog oldest-first, and letting that overwrite the current position
     * would walk the driver backwards through a route they already drove.
     */
    public function heartbeat(DriverPresence $presence): void;

    /** Null when this driver has never reported. */
    public function get(int $driverId): ?DriverPresence;

    /**
     * Every driver the matcher may currently offer work to.
     *
     * Filtering happens here rather than in the caller so that the database
     * store can push it into the query — a dispatch that loaded every
     * driver's row to discard most of them in PHP would be the N+1-shaped
     * waste on the hottest read in the system.
     *
     * @param  array<int, int>  $driverIds  empty means every driver
     * @return Collection<int, DriverPresence>
     */
    public function dispatchable(array $driverIds = []): Collection;

    /** Used by tests and by a driver's account being revoked. */
    public function forget(int $driverId): void;
}