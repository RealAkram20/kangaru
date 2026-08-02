<?php

namespace Modules\Administration\Policies;

use App\Enums\Permission;
use App\Models\User;
use Modules\Administration\Models\Role;

/**
 * Who may curate the role catalogue (ADR-0004).
 *
 * `roles.manage` is seeded onto Super Admin alone, because roles are
 * platform-wide: a tenant that could compose permission sets could grant
 * itself abilities, and the escalation surface is deliberately one role
 * wide.
 *
 * Nothing here is tenant-scoped for the same reason — there is one
 * catalogue, and every tenant picks from it.
 */
class RolePolicy
{
    /**
     * Reading the catalogue is open to anyone who administers staff: the
     * role picker on the staff page needs names and descriptions, and a
     * role's permission list is not a secret from the person assigning it.
     */
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::ROLES_MANAGE)
            || $user->hasPermission(Permission::STAFF_VIEW);
    }

    public function view(User $user, Role $role): bool
    {
        return $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return $user->hasPermission(Permission::ROLES_MANAGE);
    }

    /**
     * A system role's permissions may be edited — that is the point of the
     * feature, and a client who wants Dispatchers to stop seeing rate cards
     * should not need a release. Its slug and name may not: `users.role`
     * values, seeders and every existing test refer to them by slug, and
     * renaming one would orphan every account holding it.
     */
    public function update(User $user, Role $role): bool
    {
        return $this->create($user);
    }

    /**
     * System roles are never deleted. A custom role may be, but only once
     * nobody holds it — checked in the controller, because it is a data
     * question rather than a permission one.
     */
    public function delete(User $user, Role $role): bool
    {
        return $this->create($user) && ! $role->is_system;
    }
}
