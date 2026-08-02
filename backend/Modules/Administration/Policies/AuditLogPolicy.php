<?php

namespace Modules\Administration\Policies;

use App\Enums\Permission;
use App\Models\User;

/**
 * Permission-based since ADR-0004.
 *
 * AGENTS.md: "Tenant admins can query their own tenant's audit log." The
 * tenant half is TenantScope's job; this is the "admins" half, and it is
 * now a grant rather than a role list — so a custom "Auditor" role can read
 * the log without also gaining the ability to edit staff.
 */
class AuditLogPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::AUDIT_VIEW);
    }
}
