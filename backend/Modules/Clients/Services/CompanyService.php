<?php

namespace Modules\Clients\Services;

use App\Enums\AccessLevel;
use App\Models\OperatorClient;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use App\Support\Tenancy\TenantScope;
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
    /**
     * The clients this actor may read (ADR-0060, ADR-0062 §2).
     *
     * `forActor` drops the tenant scope for any platform-level account, which
     * answers *"reads across clients"* — and that was the whole question while
     * one fleet existed. It is now half of one, and `companies` has no
     * `operator_id` for `narrowToFleet` to filter on, so the other half has to
     * be asked through the join.
     *
     * Verified against the running database before it was written: a fleet's
     * Super Admin was reading **every** corporate client on the platform.
     * Invisible with one fleet; the cross-fleet leak ADR-0055 §6 exists to
     * prevent with two.
     *
     * - a **fleet** sees the clients it actually serves — an `active`
     *   contract, never a `requested` one, which is the rule ADR-0060 §4 turns
     *   on;
     * - **head office** sees the directory, which ADR-0062 §1 made Kangaru's;
     * - a **client** is already narrowed to itself by the tenant scope, and
     *   this leaves that alone.
     */
    public function list(User $user): Collection
    {
        // Head office reads the **directory** (ADR-0062 §1), and that has to be
        // said here because everything else in this codebase is built to
        // refuse it. `isPlatformLevel()` means *fleet* since ADR-0055, so a
        // Kangaru actor falls straight through `forActor` to `TenantScope`,
        // which fails closed with no client bound — the query is literally
        // `where 1 = 0`, which is §2 working exactly as designed.
        //
        // ADR-0062 is the amendment that makes this read legitimate, so the
        // scope is dropped **here, narrowly, and only for this level** rather
        // than by weakening `TenantScope` for everybody. The resource is
        // allow-listed (§2), so what a wider query returns is still a
        // directory and not a client's operations.
        if ($user->access_level === AccessLevel::KANGARU) {
            // `contracts.operator` eager-loaded because `CompanyResource`
            // reports who serves each client to this level and no other, and
            // the directory is one row per client on the platform — without
            // this it is two queries per row (AGENTS.md — prevent N+1).
            return Company::withoutGlobalScope(TenantScope::class)
                ->with('contracts.operator')
                ->get();
        }

        $query = Company::forActor($user);

        if ($user->access_level === AccessLevel::FLEET && $user->operator_id !== null) {
            $query->whereIn(
                'tenant_id',
                OperatorClient::query()->servedBy($user->operator_id)->select('tenant_id'),
            );
        }

        return $query->get();
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
