<?php

namespace Modules\Drivers\Policies;

use App\Enums\UserRole;
use App\Models\User;
use Modules\Drivers\Models\Driver;

class DriverPolicy
{
    /**
     * Any authenticated user may list/view drivers — TenantScope already
     * restricts results to their own tenant, and dispatchers need to see
     * drivers to assign trips.
     */
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, Driver $driver): bool
    {
        return true;
    }

    public function create(User $user): bool
    {
        return $this->managesFleet($user);
    }

    public function update(User $user, Driver $driver): bool
    {
        return $this->managesFleet($user);
    }

    public function delete(User $user, Driver $driver): bool
    {
        return $this->managesFleet($user);
    }

    private function managesFleet(User $user): bool
    {
        return in_array($user->role, [
            UserRole::SUPER_ADMIN,
            UserRole::OPERATIONS_MANAGER,
            UserRole::FLEET_OWNER,
            UserRole::BRANCH_MANAGER,
            UserRole::DEPOT_MANAGER,
        ], true);
    }
}
