<?php

namespace Modules\Drivers\Policies;

use App\Enums\Permission;
use App\Models\User;
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
}
