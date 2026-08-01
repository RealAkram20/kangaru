<?php

namespace Modules\Trips\Services;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Modules\Trips\Enums\TripStatus;

/**
 * Enforces AGENTS.md's "Concurrency (Dispatch)" rule: assigning a driver or
 * vehicle takes a pessimistic lock (`SELECT ... FOR UPDATE`) on the vehicle
 * and driver rows inside a transaction, so two dispatchers can never both
 * succeed in assigning the same vehicle to overlapping trips.
 *
 * Every path that puts a vehicle and driver onto a trip must come through
 * here — ad-hoc trip creation (Modules\Trips\Services\TripService), booking
 * dispatch (Modules\Dispatch), and reassignment out of Rejected
 * (TripStateMachine). A second, unguarded assignment path would silently
 * void the guarantee, so there is exactly one.
 *
 * It lives in Modules\Trips rather than Modules\Dispatch because the
 * invariant it checks is a question about the `trips` table; putting it in
 * Dispatch would make Trips depend on Dispatch, which already depends on
 * Trips.
 *
 * MUST be called inside a transaction — `lockForUpdate()` outside one is
 * released immediately and buys nothing.
 */
class TripAssignmentGuard
{
    /**
     * @param  int|null  $ignoreTripId  the trip being reassigned, which must not
     *                                  count as its own conflict
     *
     * @throws VehicleUnavailableException
     * @throws DriverUnavailableException
     */
    public function assertAvailable(int $vehicleId, int $driverId, ?int $ignoreTripId = null): void
    {
        if (DB::transactionLevel() === 0) {
            throw new \LogicException(
                'TripAssignmentGuard must run inside a transaction; lockForUpdate outside one is a no-op.'
            );
        }

        $this->lockResourceRows($vehicleId, $driverId);

        $conflicts = $this->occupyingTrips($vehicleId, $driverId, $ignoreTripId);

        foreach ($conflicts as $conflict) {
            if ((int) $conflict->vehicle_id === $vehicleId) {
                throw new VehicleUnavailableException($vehicleId, (int) $conflict->id);
            }
        }

        foreach ($conflicts as $conflict) {
            if ((int) $conflict->driver_id === $driverId) {
                throw new DriverUnavailableException($driverId, (int) $conflict->id);
            }
        }
    }

    /**
     * Locks the vehicle and driver rows themselves, not the trips. Two
     * dispatchers racing on the same vehicle both find zero conflicting
     * trips, so locking only what already exists would let both through —
     * the vehicle/driver rows are the contended resource and are always
     * present, which is what makes them the correct thing to serialise on.
     *
     * Ordered by table then id so two concurrent assignments touching an
     * overlapping pair always take their locks in the same sequence and
     * cannot deadlock against each other.
     */
    private function lockResourceRows(int $vehicleId, int $driverId): void
    {
        // Raw, tenant-scope-free queries: this is a lock acquisition, not a
        // data read, and its result is discarded. Cross-tenant ids can never
        // reach here — the FormRequest layer already proved both ids belong
        // to the caller's tenant (ADR-0001 raw-query exception).
        DB::table('vehicles')->where('id', $vehicleId)->lockForUpdate()->first();
        DB::table('drivers')->where('id', $driverId)->lockForUpdate()->first();
    }

    /**
     * @return Collection<int, \stdClass>
     */
    private function occupyingTrips(int $vehicleId, int $driverId, ?int $ignoreTripId)
    {
        return DB::table('trips')
            ->select('id', 'vehicle_id', 'driver_id')
            ->whereNull('deleted_at')
            ->whereIn('status', TripStatus::occupyingValues())
            ->where(fn ($query) => $query->where('vehicle_id', $vehicleId)->orWhere('driver_id', $driverId))
            ->when($ignoreTripId !== null, fn ($query) => $query->where('id', '!=', $ignoreTripId))
            ->orderBy('id')
            ->get();
    }
}
