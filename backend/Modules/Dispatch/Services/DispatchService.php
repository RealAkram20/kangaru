<?php

namespace Modules\Dispatch\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Modules\Bookings\Enums\BookingStatus;
use Modules\Bookings\Models\Booking;
use Modules\Bookings\Services\InvalidBookingTransitionException;
use Modules\Fleet\Services\AllocationLookup;
use Modules\Fleet\Services\Availability;
use Modules\Fleet\Services\AvailabilityService;
use Modules\Trips\Models\Trip;
use Modules\Trips\Services\DriverUnavailableException;
use Modules\Trips\Services\TripService;
use Modules\Trips\Services\VehicleUnavailableException;

/**
 * Manual/hybrid dispatch (PROJECT.md Phase 1 — automatic dispatch is
 * explicitly deferred): a dispatcher picks the vehicle and driver, and this
 * service turns an approved or pending Booking into an Assigned Trip.
 *
 * The whole hand-over is one transaction. Booking-status write and Trip
 * creation cannot be allowed to half-happen: a booking marked Assigned with
 * no trip would vanish from the dispatch queue with nobody driving it, and
 * a trip with its booking still pending would invite a second dispatcher to
 * assign it again.
 */
class DispatchService
{
    public function __construct(
        private readonly TripService $trips,
        private readonly AllocationLookup $allocations,
        private readonly AvailabilityService $availability,
    ) {}

    /**
     * @param  string|null  $overrideReason  why a contracted vehicle was not used (ADR-0009)
     *
     * @throws InvalidBookingTransitionException the booking is already assigned, rejected or cancelled
     * @throws BookingNotDispatchableException the service never takes a driver — a self-drive rental (ADR-0064)
     * @throws VehicleUnavailableException
     * @throws DriverUnavailableException
     * @throws AllocationExclusiveException the vehicle belongs exclusively to another client that day
     * @throws AllocationOverrideRequiredException a contracted vehicle was passed over without a reason
     */
    public function assign(
        Booking $booking,
        int $vehicleId,
        int $driverId,
        User $dispatcher,
        ?string $overrideReason = null,
    ): Trip {
        return DB::transaction(function () use ($booking, $vehicleId, $driverId, $dispatcher, $overrideReason) {
            // Lock and re-read the booking before deciding. The status held
            // on the passed-in model was read outside this transaction and
            // may already be stale — this is the read that counts.
            /** @var Booking $locked */
            $locked = Booking::whereKey($booking->id)->lockForUpdate()->firstOrFail();

            if (! $locked->status->canTransitionTo(BookingStatus::ASSIGNED)) {
                throw new InvalidBookingTransitionException($locked->status, BookingStatus::ASSIGNED);
            }

            // ADR-0064. The dispatch board is already filtered to services a
            // driver is sent to, but a dispatcher may post any booking id,
            // and a constraint that only exists in the list somebody was
            // shown is not a constraint — the same sentence the allocation
            // rules below live by. The walk-in queue learned this the hard
            // way: a five-day rental was offered to a driver, accepted in
            // under a second, and dispatched as "Pickup → As directed"
            // (OrderRequestServiceType's docblock records it).
            if (! $locked->service_type->dispatchesToDriver()) {
                throw new BookingNotDispatchableException($locked->service_type);
            }

            // ADR-0009. Checked here rather than only in the candidate
            // listing, because the listing is a convenience and this is the
            // rule: a dispatcher may post any vehicle id, and a constraint
            // that only exists in the list somebody was shown is not a
            // constraint.
            $overrideReason = $this->applyAllocationRules(
                $locked, $vehicleId, $driverId, $overrideReason, $dispatcher,
            );

            // ADR-0017, and here for exactly the reason the allocation rules
            // are here: the candidate listing is a convenience, this is the
            // rule. A dispatcher may post any pair of ids, so a driver on
            // approved leave has to be refused by the endpoint and not only
            // greyed out on a board somebody may not have been looking at.
            //
            // After the locks above, deliberately. The verdict reads `trips`
            // among other tables, and a plain SELECT taken before the locks
            // would fix this transaction's snapshot early — the precise
            // mistake the comment in applyAllocationRules() records having
            // already been made once here.
            $this->assertAvailable($locked, $vehicleId, $driverId);

            // TripService takes the pessimistic lock on the vehicle and
            // driver rows (TripAssignmentGuard) and throws if either is
            // already committed elsewhere, rolling this whole transaction
            // back — booking included.
            $trip = $this->trips->create([
                'booking_id' => $locked->id,
                'vehicle_id' => $vehicleId,
                'driver_id' => $driverId,
                'allocation_override_reason' => $overrideReason,
                'origin' => $locked->origin,
                'destination' => $locked->destination,
            ], $dispatcher);

            $locked->status = BookingStatus::ASSIGNED;
            $locked->save();

            return $trip;
        });
    }

    /**
     * Refuses a driver or vehicle that is not free for the booking's window
     * (ADR-0017).
     *
     * Reuses `VehicleUnavailableException` / `DriverUnavailableException`
     * rather than introducing a third pair. To every client the fact is the
     * same — this vehicle cannot take this job — and the *reason* travels in
     * the message, which is where a dispatcher reads it. Minting
     * `VEHICLE_ON_LEAVE` and `VEHICLE_IN_WORKSHOP` would ask every consumer,
     * including the Driver's Application, to learn a new code for each new
     * way of being busy.
     *
     * @throws VehicleUnavailableException
     * @throws DriverUnavailableException
     */
    private function assertAvailable(Booking $booking, int $vehicleId, int $driverId): void
    {
        [$from, $to] = $this->availability->windowFor($booking->scheduled_for);

        $vehicle = $this->availability->forVehicle($vehicleId, $from, $to);

        if (! $vehicle->free && $vehicle->code !== Availability::ON_TRIP) {
            // ON_TRIP is deliberately passed over here and left to
            // TripAssignmentGuard, which is the only thing holding the locks
            // that make that particular answer race-proof. Two checks of the
            // same fact, one of them unlocked, is how a guarantee gets
            // quietly downgraded to a probability.
            throw new VehicleUnavailableException($vehicleId, 0, $vehicle->note);
        }

        $driver = $this->availability->forDriver($driverId, $from, $to);

        if (! $driver->free && $driver->code !== Availability::ON_TRIP) {
            throw new DriverUnavailableException($driverId, 0, $driver->note);
        }
    }

    /**
     * Enforces ADR-0009 and returns the reason to record — null when nothing
     * was overridden.
     *
     * The date the contract is read against is the booking's scheduled day,
     * falling back to today for an immediate booking. A contract runs from a
     * day to a day, so the question "was this vehicle theirs" only has an
     * answer relative to when the trip happens.
     *
     * @throws AllocationExclusiveException
     * @throws AllocationOverrideRequiredException
     */
    private function applyAllocationRules(
        Booking $booking,
        int $vehicleId,
        int $driverId,
        ?string $overrideReason,
        User $dispatcher,
    ): ?string {
        $on = $booking->scheduled_for ?? now();

        // Take the resource locks BEFORE any plain SELECT below.
        //
        // Load-bearing, and the existing dispatch race test proved it rather
        // than the idea being theoretical. InnoDB's REPEATABLE READ
        // establishes a transaction's consistent-read snapshot at its
        // **first plain SELECT**. The allocation reads below are plain
        // SELECTs, and until these two lines existed they ran before
        // TripAssignmentGuard acquired its locks — so a losing dispatcher
        // fixed its snapshot early, and its later read of `trips` could not
        // see the winner's committed trip. Both assignments passed the
        // availability check and both won, on vehicle and on driver alike.
        //
        // Locking here restores the original order — lock first, then read —
        // so the loser blocks until the winner commits and only then takes
        // the snapshot it judges availability from. The guard re-locks the
        // same rows moments later, a no-op within one transaction, and the
        // vehicles-then-drivers order is the guard's own: two concurrent
        // assignments touching an overlapping pair must take their locks in
        // the same sequence or they deadlock against each other.
        DB::table('vehicles')->where('id', $vehicleId)->lockForUpdate()->first();
        DB::table('drivers')->where('id', $driverId)->lockForUpdate()->first();

        // Hard refusal first: exclusivity admits no override, so there is no
        // point asking for a reason for something that cannot happen.
        if ($this->allocations->exclusiveBlockFor($vehicleId, $booking->tenant_id, $on) !== null) {
            throw new AllocationExclusiveException($vehicleId);
        }

        $contracted = $this->allocations->vehiclesFor($booking->tenant_id, $on);

        // Nothing contracted for that day, or the chosen vehicle is one of
        // theirs: no override happened and no reason is owed. Requiring one
        // here would be noise on the ordinary case, which is how a required
        // field becomes a field everybody types "n/a" into.
        if ($contracted->isEmpty() || $contracted->contains($vehicleId)) {
            return null;
        }

        $reason = trim((string) $overrideReason);

        if ($reason === '') {
            throw new AllocationOverrideRequiredException;
        }

        // A business event in the sense AGENTS.md's Observability section
        // means, with the stable name ADR-0009 gives it. Logged in addition
        // to the column: the column explains one trip, this explains a
        // pattern across many.
        Log::info('vehicle.dispatched_off_allocation', [
            'booking_id' => $booking->id,
            'tenant_id' => $booking->tenant_id,
            'vehicle_id' => $vehicleId,
            'contracted_vehicle_ids' => $contracted->all(),
            'user_id' => $dispatcher->id,
            'reason' => $reason,
        ]);

        return $reason;
    }
}
