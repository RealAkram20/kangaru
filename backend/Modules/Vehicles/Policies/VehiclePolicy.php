<?php

namespace Modules\Vehicles\Policies;

use App\Enums\Permission;
use App\Models\User;
use Modules\Vehicles\Models\Vehicle;

/**
 * Permission-based since ADR-0004. The role sets that used to live here are
 * now the seeded grants in `RoleSeeder` — including the fact that everyone
 * may read the fleet, which was `return true` and is preserved as
 * `vehicles.view` on every system role.
 */
class VehiclePolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::VEHICLES_VIEW);
    }

    public function view(User $user, Vehicle $vehicle): bool
    {
        return $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return $user->hasPermission(Permission::VEHICLES_MANAGE);
    }

    public function update(User $user, Vehicle $vehicle): bool
    {
        return $this->create($user);
    }

    public function delete(User $user, Vehicle $vehicle): bool
    {
        return $this->create($user);
    }
}
