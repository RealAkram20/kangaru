<?php

namespace Modules\Fleet\Policies;

use App\Enums\AccessLevel;
use App\Enums\Permission;
use App\Models\Operator;
use App\Models\User;

/**
 * Who may read and run the register of fleet companies (ADR-0059).
 *
 * ## The level is the control, not the permission
 *
 * Every Super Admin holds `fleets.manage`, including **a fleet's own Super
 * Admin**, and that is not an oversight. `StoreRoleRequest` refuses to let
 * anybody grant a permission they do not hold themselves, so holding it out
 * of the Super Admin role would make it grantable by nobody and reachable
 * only by a seeder — ungrantable is not stricter, it is broken. `RoleSeeder`
 * argues this at length for `support.act-as`, which was excluded and reverted
 * within the hour.
 *
 * So what keeps this register to head office is `access_level === kangaru`,
 * checked here on every method. A fleet's Super Admin holds the permission
 * and cannot use it, exactly as they hold `support.act-as` and cannot act as
 * anybody.
 *
 * ## Why a fleet may not read the register at all, not even its own row
 *
 * A fleet reads *itself* through its own console — its name, its plan, its
 * bill — and none of that goes through here. What this register adds is
 * **every other fleet**, which is a competitor list: who else is on Kangaru,
 * how many drivers they run, when they joined. ADR-0055 §2's whole point is
 * that no account reads across fleets, and a register that answered "your own
 * row only" would be one forgotten `where` away from answering all of them.
 *
 * The narrow read a fleet does need is served by `/auth/me` and its own
 * console, not by narrowing this.
 */
class OperatorPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->isHeadOffice($user) && $user->hasPermission(Permission::FLEETS_VIEW);
    }

    public function view(User $user, Operator $operator): bool
    {
        return $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return $this->isHeadOffice($user) && $user->hasPermission(Permission::FLEETS_MANAGE);
    }

    public function update(User $user, Operator $operator): bool
    {
        return $this->create($user);
    }

    /**
     * Deleting a fleet is not offered, and the omission is the design.
     *
     * `operator_client` restricts on delete and six operational tables carry
     * `operator_id`; removing a row would either fail against its own history
     * or orphan it. A fleet that leaves the platform is **suspended**, which
     * keeps its trips explicable and its invoices reconcilable — the same
     * answer ADR-0060 §7 gives for a contract ending.
     */
    public function delete(User $user, Operator $operator): bool
    {
        return false;
    }

    /**
     * ADR-0055 §4. Read from the account's declared level, never worked out
     * from `tenant_id` and `operator_id` being null — that inference is the
     * one this whole column exists to prevent.
     */
    private function isHeadOffice(User $user): bool
    {
        return $user->access_level === AccessLevel::KANGARU;
    }
}
