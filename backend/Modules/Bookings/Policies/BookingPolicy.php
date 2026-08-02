<?php

namespace Modules\Bookings\Policies;

use App\Enums\Permission;
use App\Models\User;
use Modules\Bookings\Models\Booking;

/**
 * Permission-based since ADR-0004.
 *
 * The role sets that used to live here — DESK_ROLES and APPROVER_ROLES —
 * are now seeded grants. Two of them needed an `.all` / own split rather
 * than a plain permission, because they were never really about ability:
 *
 * - `bookings.view.all` — without it you see the bookings you raised.
 *   That is what "a Corporate Employee sees their own" meant when it was a
 *   role comparison in BookingController.
 * - `bookings.cancel.any` — without it you may still withdraw your own
 *   request, because it is yours.
 *
 * Approval stays separate from the desk: a Dispatcher may see and cancel
 * anything but not approve it, since "approving your own workload is not a
 * control". That distinction survives as two permissions instead of two
 * constants.
 */
class BookingPolicy
{
    public function viewAny(User $user): bool
    {
        // Everyone may list; the controller narrows anyone without
        // `bookings.view.all` to their own.
        return true;
    }

    public function view(User $user, Booking $booking): bool
    {
        if ($user->hasPermission(Permission::BOOKINGS_VIEW_ALL)) {
            return true;
        }

        return $booking->requested_by_user_id === $user->id;
    }

    public function create(User $user): bool
    {
        return $user->hasPermission(Permission::BOOKINGS_CREATE);
    }

    public function approve(User $user, Booking $booking): bool
    {
        return $user->hasPermission(Permission::BOOKINGS_APPROVE);
    }

    public function reject(User $user, Booking $booking): bool
    {
        return $this->approve($user, $booking);
    }

    /** Requesters may withdraw their own booking; the desk may cancel any. */
    public function cancel(User $user, Booking $booking): bool
    {
        if ($user->hasPermission(Permission::BOOKINGS_CANCEL_ANY)) {
            return true;
        }

        return $booking->requested_by_user_id === $user->id;
    }

    /**
     * Assigning a vehicle and driver is dispatching, which is why this is
     * its own permission and not implied by the desk: a Corporate Admin may
     * raise and approve bookings but never dispatch the fleet.
     */
    public function dispatch(User $user, Booking $booking): bool
    {
        return $user->hasPermission(Permission::BOOKINGS_DISPATCH);
    }
}
