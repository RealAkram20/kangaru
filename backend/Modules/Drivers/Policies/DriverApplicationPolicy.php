<?php

namespace Modules\Drivers\Policies;

use App\Enums\Permission;
use App\Models\User;
use Modules\Administration\Policies\UserPolicy;
use Modules\Drivers\Models\DriverApplication;

/**
 * Who may read the applications queue, and who may decide one (ADR-0027).
 *
 * The two are deliberately different permissions. Reading the queue is
 * `drivers.view`, which every system role holds — a dispatcher who is asked
 * "did Musa ever apply?" should be able to answer.
 *
 * Deciding is the conjunction ADR-0016 already requires to attach a login,
 * because approving *is* attaching a login: it creates a `users` row and
 * points a driver profile at it. Anything less here would make this endpoint
 * a side door around `DriverPolicy::manageAccount`, which is the exact
 * failure ADR-0016 §2 was written to prevent.
 */
class DriverApplicationPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::DRIVERS_VIEW);
    }

    public function view(User $user, DriverApplication $application): bool
    {
        return $this->viewAny($user);
    }

    /**
     * Approving or rejecting.
     *
     * Rejection is gated as tightly as approval on purpose, even though it
     * mints nothing. Turning away the fleet's applicants is not a lesser act
     * than admitting them — it is the same queue, and somebody who may not
     * hire may not silently un-hire either.
     */
    public function decide(User $user): bool
    {
        return $user->hasPermission(Permission::DRIVERS_MANAGE)
            && app(UserPolicy::class)->create($user);
    }
}
