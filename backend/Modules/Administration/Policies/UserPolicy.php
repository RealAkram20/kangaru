<?php

namespace Modules\Administration\Policies;

use App\Enums\UserRole;
use App\Models\User;

/**
 * Who may administer accounts.
 *
 * Two roles, and no others. PROJECT.md gives Corporate Admin "manages
 * company users and bookings" and Super Admin the platform. Operations
 * Manager is deliberately excluded despite managing operations broadly:
 * creating accounts and assigning roles is an identity act, and the set of
 * people who can grant access should be as small as the product allows.
 *
 * ## The escalation boundary
 *
 * Only a Super Admin may create, or promote anyone to, Super Admin. That is
 * the one rule that makes the rest safe — without it a Corporate Admin can
 * mint a platform owner and leave their tenant entirely, which is a
 * privilege escalation dressed up as a staff edit.
 *
 * ## Acting on yourself
 *
 * You may not change your own role or suspend your own account. Suspending
 * yourself locks the tenant's last administrator out with no way back in;
 * changing your own role is self-promotion with extra steps. Editing your
 * own name is fine and is not this policy's business.
 */
class UserPolicy
{
    private const ADMINISTRATORS = [
        UserRole::SUPER_ADMIN,
        UserRole::CORPORATE_ADMIN,
    ];

    public function viewAny(User $user): bool
    {
        return in_array($user->role, self::ADMINISTRATORS, true);
    }

    /**
     * A Corporate Admin sees their own tenant's staff; a Super Admin sees
     * anyone.
     *
     * The tenant check lives here as well as in the controller's query.
     * `User` deliberately has no BelongsToTenant — login must find an
     * account before any tenant is known — so nothing scopes these reads
     * automatically, and a single forgotten `where` would be a
     * cross-tenant leak of names, emails and roles.
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
        return $this->viewAny($user);
    }

    public function update(User $user, User $subject): bool
    {
        return $this->view($user, $subject);
    }

    /**
     * Suspension and reactivation, which are the same permission: a role
     * that can take access away must be able to give it back, or a mistake
     * needs a database console to undo.
     */
    public function suspend(User $user, User $subject): bool
    {
        if (! $this->update($user, $subject)) {
            return false;
        }

        // Locking yourself out is never intended, and for the last
        // administrator in a tenant it is unrecoverable without a console.
        return $user->id !== $subject->id;
    }

    /**
     * Whether `$user` may put someone into `$role`.
     *
     * Called for both creation and role changes, so the escalation rule
     * cannot be satisfied by creating a user in a safe role and promoting
     * them a second later.
     */
    public function assignRole(User $user, UserRole $role): bool
    {
        if (! $this->viewAny($user)) {
            return false;
        }

        return $role !== UserRole::SUPER_ADMIN || $user->role === UserRole::SUPER_ADMIN;
    }

    /**
     * A Super Admin is platform-level and has no tenant of their own, so
     * "shares a tenant" is meaningless for them — they administer everyone.
     * Everyone else is confined to the tenant they belong to, and a null
     * tenant on either side never matches, so a Corporate Admin can never
     * reach a platform account.
     */
    private function sharesTenant(User $user, User $subject): bool
    {
        if ($user->role === UserRole::SUPER_ADMIN) {
            return true;
        }

        return $user->tenant_id !== null && $user->tenant_id === $subject->tenant_id;
    }
}
