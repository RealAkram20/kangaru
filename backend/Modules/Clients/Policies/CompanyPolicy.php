<?php

namespace Modules\Clients\Policies;

use App\Enums\UserRole;
use App\Models\User;
use Modules\Clients\Models\Company;

class CompanyPolicy
{
    /**
     * Any authenticated user may list/view companies — TenantScope already
     * restricts results to their own tenant's company.
     */
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, Company $company): bool
    {
        return true;
    }

    /**
     * Platform-level action: only Super Admin creates a company (for a
     * tenant that doesn't yet have one), bypassing tenant scope via
     * Company::allTenants()->create(...) since a Super Admin has no
     * tenant context to auto-fill tenant_id from.
     */
    public function create(User $user): bool
    {
        return $user->role === UserRole::SUPER_ADMIN;
    }

    public function update(User $user, Company $company): bool
    {
        return in_array($user->role, [UserRole::SUPER_ADMIN, UserRole::CORPORATE_ADMIN], true);
    }

    public function delete(User $user, Company $company): bool
    {
        return $user->role === UserRole::SUPER_ADMIN;
    }
}
