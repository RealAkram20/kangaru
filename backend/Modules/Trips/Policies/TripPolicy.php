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
     * Any authenticated user may list trips — TenantScope restricts
     * results to their own tenant, and TripService/TripController further
     * restrict a Driver to their own assigned trips.
     */
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, Trip $trip): bool
    {
        return $user->role !== UserRole::DRIVER || $trip->driver?->user_id === $user->id;
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

    public function transition(User $user, Trip $trip, TripStatus $to): bool
    {
        if (in_array($user->role, self::DISPATCH_ROLES, true)) {
            return true;
        }

        if ($user->role === UserRole::FINANCE) {
            return in_array($to, [TripStatus::DISPUTED, TripStatus::CLOSED, TripStatus::INVOICE_GENERATED], true);
        }

        if ($user->role === UserRole::DRIVER) {
            return in_array($to, self::DRIVER_JOURNEY_STATES, true) && $trip->driver?->user_id === $user->id;
        }

        return false;
    }
}
