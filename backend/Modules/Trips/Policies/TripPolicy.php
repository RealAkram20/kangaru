<?php

namespace Modules\Trips\Policies;

use App\Enums\Permission;
use App\Models\User;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;

/**
 * Permission-based since ADR-0004.
 *
 * This policy needed the most care, because most of what it expressed was
 * never "may you", it was "is it yours". Ownership survives as `.all` /
 * `.own` permission pairs:
 *
 * - `trips.view.all` — without it you see the trips assigned to you (as a
 *   driver) or arising from your own bookings (as a requester). That is the
 *   privacy narrowing added for Corporate Employees, now expressed as the
 *   absence of a grant rather than a role name.
 * - `trips.transition.any` vs `trips.transition.own` — a dispatcher moves
 *   any trip; a driver moves the one they are on, and only through the
 *   states of a journey.
 * - `trips.transition.finance` — Disputed and Closed, the finance end of
 *   the lifecycle.
 *
 * The ownership checks themselves are unchanged. A permission decides which
 * question to ask; it never answers "is this your trip".
 */
class TripPolicy
{
    /**
     * States a driver may move their own trip through. Rejected is included
     * (a driver declining an assignment); the terminal/finance states (No
     * Show, Invoice Generated, Disputed, Closed, Cancelled) are excluded.
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
     * Any authenticated user may list — TenantScope restricts results to
     * their tenant and TripController narrows anyone without
     * `trips.view.all` to their own.
     */
    public function viewAny(User $user): bool
    {
        return true;
    }

    /**
     * Without `trips.view.all`, you may see a trip that is yours: assigned
     * to you as its driver, or produced by a booking you raised.
     *
     * Both are checked rather than one or the other, because a custom role
     * could hold neither transition permission and still legitimately be
     * either party. A trip with no booking stays invisible to a requester —
     * `?->` yields null, which never equals a user id — and that is right:
     * nothing connects it to them.
     */
    public function view(User $user, Trip $trip): bool
    {
        if ($user->hasPermission(Permission::TRIPS_VIEW_ALL)) {
            return true;
        }

        return $trip->driver?->user_id === $user->id
            || $trip->booking?->requested_by_user_id === $user->id;
    }

    /** Creating a trip is dispatching — assigning a vehicle and driver. */
    public function create(User $user): bool
    {
        return $user->hasPermission(Permission::TRIPS_CREATE);
    }

    /**
     * Who may post GPS pings for a trip.
     *
     * The driver on the trip, because in Phase 1 their phone is the device
     * (PROJECT.md: drivers use a mobile-responsive web flow), plus dispatch
     * roles so a tracker fitted to the vehicle can report through an
     * operator account.
     *
     * Not Finance and not a Corporate Admin: the route is evidence for the
     * distance a client is billed, and the party being billed must not be
     * able to write it. That is now a grant they do not hold.
     */
    public function recordLocations(User $user, Trip $trip): bool
    {
        if (! $user->hasPermission(Permission::TRIPS_LOCATIONS_RECORD)) {
            return false;
        }

        // Holding the permission is not enough for someone who only has it
        // as a driver: it has to be their trip. Anyone who can move any
        // trip can also report against any trip.
        if ($user->hasPermission(Permission::TRIPS_TRANSITION_ANY)) {
            return true;
        }

        return $trip->driver?->user_id === $user->id;
    }

    public function transition(User $user, Trip $trip, TripStatus $to): bool
    {
        if ($user->hasPermission(Permission::TRIPS_TRANSITION_ANY)) {
            return true;
        }

        // Invoice Generated is deliberately absent everywhere: no role
        // reaches it through this endpoint. Modules\Billing\Services\
        // InvoiceService applies it inside the transaction that issues the
        // invoice, and TransitionTripRequest rejects it at the door.
        // Authorization for that act is InvoicePolicy::create.
        if ($user->hasPermission(Permission::TRIPS_TRANSITION_FINANCE)
            && in_array($to, [TripStatus::DISPUTED, TripStatus::CLOSED], true)) {
            return true;
        }

        if ($user->hasPermission(Permission::TRIPS_TRANSITION_OWN)) {
            return in_array($to, self::DRIVER_JOURNEY_STATES, true)
                && $trip->driver?->user_id === $user->id;
        }

        return false;
    }
}
