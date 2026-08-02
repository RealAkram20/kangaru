<?php

namespace Modules\Clients\Policies;

use App\Enums\Permission;
use App\Models\User;
use Modules\Clients\Models\Company;

/**
 * Permission-based since ADR-0004.
 *
 * Creating a company stays a platform-level act: `companies.create` is
 * seeded only on Super Admin, because a Super Admin has no tenant context
 * to auto-fill `tenant_id` from and the controller reaches for
 * `Company::allTenants()->create(...)` accordingly.
 */
class CompanyPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission(Permission::COMPANIES_VIEW);
    }

    public function view(User $user, Company $company): bool
    {
        return $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return $user->hasPermission(Permission::COMPANIES_CREATE);
    }

    public function update(User $user, Company $company): bool
    {
        return $user->hasPermission(Permission::COMPANIES_UPDATE);
    }

    public function delete(User $user, Company $company): bool
    {
        return $user->hasPermission(Permission::COMPANIES_DELETE);
    }
}
