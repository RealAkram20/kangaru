<?php

namespace Modules\Clients\Services;

use App\Models\User;
use App\Support\Tenancy\TenantContext;
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
     * TenantScope fails closed and returns nothing. `forActor()` is the one
     * named way past it (ADR-0006); everyone else stays correctly scoped to
     * their tenant, which is what that scope does for them.
     */
    public function list(User $user): Collection
    {
        return Company::forActor($user)->get();
    }

    /**
     * Onboarding a client company. Only a platform-level account reaches
     * this — a Corporate Admin holds `companies.update`, not
     * `companies.create` — and the new row's tenant comes from the request,
     * because the actor has none to inherit.
     *
     * Bound rather than mass-assigned past the scope, per ADR-0006's rule
     * that a write by platform staff runs with the subject's tenant bound.
     * `tenant_id` is a required, `exists:tenants,id` field on the request, so
     * the value is real by the time it gets here.
     */
    public function create(StoreCompanyRequest $request): Company
    {
        $attributes = $request->validated();

        return app(TenantContext::class)->for(
            (int) $attributes['tenant_id'],
            fn () => Company::create($attributes),
        );
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
