<?php

namespace Modules\Administration\Policies;

use App\Enums\Permission;
use App\Models\User;
use Modules\Administration\Models\Role;

/**
 * Who may administer accounts, and which roles they may hand out.
 *
 * Permission-based since ADR-0004: `staff.view` and `staff.manage` replace
 * the two-role constant, so a custom "HR" role can onboard staff without
 * also gaining the audit log.
 *
 * ## The escalation rule
 *
 * **Nobody may grant a permission they do not themselves hold.**
 *
 * This generalises the old special case — only a Super Admin may appoint a
 * Super Admin — and closes the hole that special case did not cover. Once
 * roles are data, a Corporate Admin could otherwise define or pick a custom
 * role carrying `roles.manage`, assign it to an account they control, and
 * reach platform administration through a side door without ever touching
 * the Super Admin slug.
 *
 * ## Acting on yourself
 *
 * You may not change your own role or suspend your own account. Suspending
 * yourself locks the tenant's last administrator out with no way back in;
 * changing your own role is self-promotion with extra steps.
 */
class UserPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::STAFF_VIEW);
    }

    /**
     * A tenant administrator sees their own tenant's staff; a platform one
     * sees anyone.
     *
     * The tenant check lives here as well as in the controller's query.
     * `User` deliberately has no BelongsToTenant — login must find an
     * account before any tenant is known — so nothing scopes these reads
     * automatically, and a single forgotten `where` would leak names,
     * emails and roles across tenants.
     */
    public function view(User $user, User $subject): bool
    {
        if (! $this->viewAny($user)) {
            return false;
        }

        return $this->sharesTenant($user, $subject);
    }

    public function create(User $user): bool
    {
        return $user->hasPermission(Permission::STAFF_MANAGE);
    }

    public function update(User $user, User $subject): bool
    {
        return $this->create($user) && $this->sharesTenant($user, $subject);
    }

    /**
     * Suspension and reactivation, which are the same permission: a role
     * that can take access away must be able to give it back, or a mistake
     * needs a database console to undo.
     */
    public function suspend(User $user, User $subject): bool
    {
        return $this->update($user, $subject) && $user->id !== $subject->id;
    }

    /**
     * Whether `$user` may put someone into `$role` — the subset rule above.
     *
     * Called for both creation and role changes, so it cannot be satisfied
     * by creating a user in a safe role and promoting them a second later.
     *
     * A slug with no matching row grants nothing and is refused rather than
     * treated as empty: assigning a role that does not exist would leave an
     * account holding no permissions for reasons nobody could see.
     */
    public function assignRole(User $user, ?Role $role): bool
    {
        if (! $this->create($user) || $role === null) {
            return false;
        }

        return $user->holdsAll($role->permissions ?? []);
    }

    /**
     * A user with no tenant is platform-level and administers everyone.
     * Everyone else is confined to their own tenant, and a null on either
     * side never matches — so a tenant administrator can never reach a
     * platform account.
     */
    private function sharesTenant(User $user, User $subject): bool
    {
        if ($user->isPlatformLevel()) {
            return true;
        }

        return $user->tenant_id === $subject->tenant_id;
    }
}
