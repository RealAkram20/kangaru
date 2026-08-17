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

    /**
     * Reading where a driver's money is sent (ADR-0042 §4).
     *
     * **`DRIVERS_MANAGE`, not `DRIVERS_VIEW`, and the difference is the whole
     * point.** `view()` above governs seeing a driver's name in a list, which a
     * dispatcher needs; this governs seeing their full bank account number,
     * which a dispatcher does not. Reusing `view()` would have handed every
     * role that can open the drivers page a payout destination in clear.
     *
     * **Noted as a refinement, exactly as ADR-0032 §5 noted it for settlement
     * confirmation:** reading somebody's bank account is arguably a Finance
     * act rather than a Fleet one, and when that role separates this method
     * and `DriverSettlementRequestPolicy` are the same seam to cut.
     */
    public function viewPayoutAccount(User $user, Driver $driver): bool
    {
        return $user->hasPermission(Permission::DRIVERS_MANAGE);
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
