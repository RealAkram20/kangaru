<?php

namespace Modules\Dispatch\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Modules\Bookings\Enums\BookingStatus;
use Modules\Bookings\Models\Booking;
use Modules\Bookings\Services\InvalidBookingTransitionException;
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
    public function __construct(private readonly TripService $trips) {}

    /**
     * @throws InvalidBookingTransitionException the booking is already assigned, rejected or cancelled
     * @throws VehicleUnavailableException
     * @throws DriverUnavailableException
     */
    public function assign(Booking $booking, int $vehicleId, int $driverId, User $dispatcher): Trip
    {
        return DB::transaction(function () use ($booking, $vehicleId, $driverId, $dispatcher) {
            // Lock and re-read the booking before deciding. The status held
            // on the passed-in model was read outside this transaction and
            // may already be stale — this is the read that counts.
            /** @var Booking $locked */
            $locked = Booking::whereKey($booking->id)->lockForUpdate()->firstOrFail();

            if (! $locked->status->canTransitionTo(BookingStatus::ASSIGNED)) {
                throw new InvalidBookingTransitionException($locked->status, BookingStatus::ASSIGNED);
            }

            // TripService takes the pessimistic lock on the vehicle and
            // driver rows (TripAssignmentGuard) and throws if either is
            // already committed elsewhere, rolling this whole transaction
            // back — booking included.
            $trip = $this->trips->create([
                'booking_id' => $locked->id,
                'vehicle_id' => $vehicleId,
                'driver_id' => $driverId,
                'origin' => $locked->origin,
                'destination' => $locked->destination,
            ], $dispatcher);

            $locked->status = BookingStatus::ASSIGNED;
            $locked->save();

            return $trip;
        });
    }
}
