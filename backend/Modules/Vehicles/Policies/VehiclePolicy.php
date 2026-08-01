<?php

namespace Modules\Vehicles\Policies;

use App\Enums\UserRole;
use App\Models\User;
use Modules\Vehicles\Models\Vehicle;

class VehiclePolicy
{
    /**
     * Any authenticated user may list/view vehicles — TenantScope already
     * restricts results to their own tenant's fleet, and dispatchers need
     * to see it to assign trips.
     */
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, Vehicle $vehicle): bool
    {
        return true;
    }

    public function create(User $user): bool
    {
        return $this->managesFleet($user);
    }

    public function update(User $user, Vehicle $vehicle): bool
    {
        return $this->managesFleet($user);
    }

    public function delete(User $user, Vehicle $vehicle): bool
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
