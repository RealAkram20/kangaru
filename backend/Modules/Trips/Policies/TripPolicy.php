<?php

namespace Modules\Trips\Policies;

use App\Enums\UserRole;
use App\Models\User;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;

class TripPolicy
{
    private const DISPATCH_ROLES = [
        UserRole::SUPER_ADMIN,
        UserRole::OPERATIONS_MANAGER,
        UserRole::DISPATCHER,
        UserRole::FLEET_OWNER,
        UserRole::BRANCH_MANAGER,
        UserRole::DEPOT_MANAGER,
    ];

    /**
     * States a driver may move their own trip through. Rejected is
     * included (a driver declining an assignment); the terminal/finance
     * states (No Show, Invoice Generated, Disputed, Closed, Cancelled)
     * are deliberately excluded.
     */
    private const DRIVER_JOURNEY_STATES = [
        TripStatus::ACCEPTED,
        TripStatus::REJECTED,
        TripStatus::DRIVER_EN_ROUTE,
        TripStatus::DRIVER_ARRIVED,
        TripStatus::PASSENGER_ONBOARD,
        TripStatus::TRIP_STARTED,
        TripStatus::WAITING,
        TripStatus::TRIP_RESUMED,
        TripStatus::TRIP_COMPLETED,
    ];

    /**
     * Any authenticated user may list trips — TenantScope restricts results
     * to their own tenant, and TripController further narrows a Driver to
     * the trips they are assigned and a Corporate Employee to the trips
     * arising from their own bookings.
     */
    public function viewAny(User $user): bool
    {
        return true;
    }

    /**
     * Two roles see only their own trips, for different reasons.
     *
     * A **Driver** may see the trips assigned to them: they are doing the
     * work, and another driver's run is none of their business.
     *
     * A **Corporate Employee** may see the trips their own bookings
     * produced. They already only see their own bookings
     * (BookingController), and a trip that a booking they cannot read
     * produced should be no more visible than the booking was. Until this
     * existed, an employee could list every trip in the tenant — origin,
     * destination, driver, vehicle and timings for every colleague. For a
     * bank whose staff movements are sensitive that is a privacy failure,
     * not a cosmetic one, and it was found by logging in as one.
     *
     * A trip with no booking (raised directly through POST /trips) is
     * therefore invisible to an employee: `?->` yields null, which never
     * equals a user id. That is the right default — nothing connects such a
     * trip to them.
     */
    public function view(User $user, Trip $trip): bool
    {
        return match ($user->role) {
            UserRole::DRIVER => $trip->driver?->user_id === $user->id,
            UserRole::CORPORATE_EMPLOYEE => $trip->booking?->requested_by_user_id === $user->id,
            default => true,
        };
    }

    /**
     * Creating a trip is dispatching — assigning a vehicle+driver — so
     * Dispatcher is included here, unlike VehiclePolicy/DriverPolicy's
     * fleet-management role set.
     */
    public function create(User $user): bool
    {
        return in_array($user->role, self::DISPATCH_ROLES, true);
    }

    /**
     * Who may post GPS pings for a trip.
     *
     * The driver on the trip, because in Phase 1 their phone is the device
     * (PROJECT.md: drivers use a mobile-responsive web flow), plus the
     * dispatch roles so a tracker fitted to the vehicle can report through
     * an operator account.
     *
     * Not Finance and not a Corporate Admin: the route is evidence for the
     * distance a client is billed, and the party being billed must not be
     * able to write it.
     */
    public function recordLocations(User $user, Trip $trip): bool
    {
        if (in_array($user->role, self::DISPATCH_ROLES, true)) {
            return true;
        }

        return $user->role === UserRole::DRIVER && $trip->driver?->user_id === $user->id;
    }

    public function transition(User $user, Trip $trip, TripStatus $to): bool
    {
        if (in_array($user->role, self::DISPATCH_ROLES, true)) {
            return true;
        }

        // Invoice Generated is deliberately absent: no role reaches it
        // through this endpoint. Modules\Billing\Services\InvoiceService
        // applies it inside the transaction that issues the invoice, and
        // TransitionTripRequest rejects it at the door — see the comment
        // there. Authorization for that act is InvoicePolicy::create.
        if ($user->role === UserRole::FINANCE) {
            return in_array($to, [TripStatus::DISPUTED, TripStatus::CLOSED], true);
        }

        if ($user->role === UserRole::DRIVER) {
            return in_array($to, self::DRIVER_JOURNEY_STATES, true) && $trip->driver?->user_id === $user->id;
        }

        return false;
    }
}
