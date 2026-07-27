<?php

namespace Modules\Administration\Policies;

use App\Enums\UserRole;
use App\Models\User;

class AuditLogPolicy
{
    /**
     * "Tenant admins can query their own tenant's audit log" (AGENTS.md) —
     * not every employee role, only Corporate Admin and Super Admin.
     */
    public function viewAny(User $user): bool
    {
        return in_array($user->role, [UserRole::SUPER_ADMIN, UserRole::CORPORATE_ADMIN], true);
    }
}
