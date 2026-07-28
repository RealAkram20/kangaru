<?php

namespace Modules\Clients\Services;

use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Modules\Clients\Models\Company;
use Modules\Clients\Requests\StoreCompanyRequest;
use Modules\Clients\Requests\UpdateCompanyRequest;

/**
 * Plain Eloquent CRUD — no repository. Simple single-model CRUD doesn't
 * earn a repository per ADR-0002.
 */
class CompanyService
{
    /**
     * Platform-level users (tenant_id null — Super Admin, Operations
     * Manager) have no TenantContext of their own, so the normal
     * TenantScope fails closed and returns nothing. Bypass it for them
     * specifically; everyone else stays correctly scoped to their tenant.
     */
    public function list(User $user): Collection
    {
        return $user->tenant_id === null
            ? Company::allTenants()->get()
            : Company::all();
    }

    /**
     * Platform-level create: bypasses tenant scope since the caller (Super
     * Admin) has no tenant context of their own to auto-fill tenant_id from.
     */
    public function create(StoreCompanyRequest $request): Company
    {
        return Company::allTenants()->create($request->validated());
    }

    public function update(Company $company, UpdateCompanyRequest $request): Company
    {
        $company->update($request->validated());

        return $company;
    }

    public function delete(Company $company): void
    {
        $company->delete();
    }
}
