<?php

namespace Modules\Drivers\Policies;

use App\Enums\Permission;
use App\Models\User;
use Modules\Administration\Policies\UserPolicy;
use Modules\Drivers\Models\Driver;

/**
 * Permission-based since ADR-0004. The `managesFleet` role list that used
 * to live here is now the `drivers.manage` grant in RoleSeeder, and the
 * `return true` reads are `drivers.view` on every system role.
 */
class DriverPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::DRIVERS_VIEW);
    }

    public function view(User $user, Driver $driver): bool
    {
        return $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return $user->hasPermission(Permission::DRIVERS_MANAGE);
    }

    public function update(User $user, Driver $driver): bool
    {
        return $this->create($user);
    }

    public function delete(User $user, Driver $driver): bool
    {
        return $this->create($user);
    }

    /**
     * Attaching or removing the account a driver signs in with (ADR-0016).
     *
     * Deliberately the conjunction of two permissions rather than either
     * one. `drivers.manage` says which driver you may act on;
     * `staff.manage` — through `UserPolicy::create` — says you may bring a
     * login into existence at all. A Depot Manager holding only the first
     * would otherwise mint accounts from the fleet screen, which is
     * ADR-0004's escalation rule defeated by a side door.
     *
     * Which *role* that account lands in is a separate question again, and
     * `StoreDriverAccountRequest` asks `UserPolicy::assignRole` it.
     */
    public function manageAccount(User $user, Driver $driver): bool
    {
        return $this->create($user) && app(UserPolicy::class)->create($user);
    }
}
