<?php

namespace Modules\Bookings\Policies;

use App\Enums\UserRole;
use App\Models\User;
use Modules\Bookings\Models\Booking;

class BookingPolicy
{
    /**
     * Roles that run the transport desk — they see and act on every booking
     * in the tenant. Corporate Admin is included: they manage their
     * company's bookings (PROJECT.md User Roles).
     */
    private const DESK_ROLES = [
        UserRole::SUPER_ADMIN,
        UserRole::OPERATIONS_MANAGER,
        UserRole::DISPATCHER,
        UserRole::CORPORATE_ADMIN,
        UserRole::BRANCH_MANAGER,
        UserRole::DEPOT_MANAGER,
    ];

    /**
     * Roles that may approve or reject. Dispatchers deliberately excluded:
     * approving your own workload is not a control, and PROJECT.md lists
     * approval as a Corporate Admin / management step.
     */
    private const APPROVER_ROLES = [
        UserRole::SUPER_ADMIN,
        UserRole::OPERATIONS_MANAGER,
        UserRole::CORPORATE_ADMIN,
        UserRole::BRANCH_MANAGER,
    ];

    /**
     * Anyone authenticated may list — TenantScope restricts to their tenant
     * and BookingController further narrows a Corporate Employee to their
     * own requests.
     */
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, Booking $booking): bool
    {
        if (in_array($user->role, self::DESK_ROLES, true)) {
            return true;
        }

        return $booking->requested_by_user_id === $user->id;
    }

    /**
     * Corporate Employees request transport — that is the whole point of
     * the role — so creation is open to every role except Driver, who has
     * no business raising bookings.
     */
    public function create(User $user): bool
    {
        return $user->role !== UserRole::DRIVER;
    }

    public function approve(User $user, Booking $booking): bool
    {
        return in_array($user->role, self::APPROVER_ROLES, true);
    }

    public function reject(User $user, Booking $booking): bool
    {
        return $this->approve($user, $booking);
    }

    /**
     * Requesters may withdraw their own booking; the desk may cancel any.
     */
    public function cancel(User $user, Booking $booking): bool
    {
        if (in_array($user->role, self::DESK_ROLES, true)) {
            return true;
        }

        return $booking->requested_by_user_id === $user->id;
    }

    /**
     * Assigning a vehicle and driver is dispatching, so this mirrors
     * TripPolicy::create rather than the desk roles above — a Corporate
     * Admin may raise and approve bookings but never dispatch the fleet.
     */
    public function dispatch(User $user, Booking $booking): bool
    {
        return in_array($user->role, [
            UserRole::SUPER_ADMIN,
            UserRole::OPERATIONS_MANAGER,
            UserRole::DISPATCHER,
            UserRole::FLEET_OWNER,
            UserRole::BRANCH_MANAGER,
            UserRole::DEPOT_MANAGER,
        ], true);
    }
}
