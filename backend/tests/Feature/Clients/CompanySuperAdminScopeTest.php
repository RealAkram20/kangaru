<?php

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Models\Operator;
use App\Models\OperatorClient;
use App\Models\User;

/**
 * Regression test for CompanyService::list(): platform-level users
 * (tenant_id null) have no TenantContext of their own, so the normal
 * TenantScope fails closed and previously returned zero companies for
 * them. Covers both platform-level roles specifically — a naive fix that
 * only special-cased SUPER_ADMIN would still miss OPERATIONS_MANAGER,
 * since CompanyPolicy::viewAny() allows any authenticated user through.
 */
/**
 * Who sees which companies.
 *
 * ## The regression this file was written for, which still stands
 *
 * A platform-level user has no `TenantContext` of their own, so `TenantScope`
 * fails closed and returned **zero** companies for them. Both roles are
 * covered specifically, because a fix that special-cased `SUPER_ADMIN` would
 * still have missed `OPERATIONS_MANAGER` — `CompanyPolicy::viewAny()` lets any
 * authenticated user through.
 *
 * ## What changed, and why these were rewritten rather than deleted
 *
 * "Across all tenants" was the right answer while Shanitah was the only fleet
 * and every client was theirs. Since ADR-0060 a client belongs to the fleets
 * holding a **contract** with it, and since ADR-0062 the whole directory is
 * head office's — so the same question has two answers depending on the
 * actor's level, and neither is "everything, always".
 *
 * The failure the file guards is unchanged: **nobody who should see companies
 * gets zero.** That is still what breaks first if `TenantScope` fails closed.
 */
function fleetActor(UserRole $role, ?int $operatorId = null): User
{
    return User::factory()->create([
        'tenant_id' => null,
        'operator_id' => $operatorId ?? Operator::SHANITAH,
        'access_level' => AccessLevel::FLEET,
        'role' => $role,
    ]);
}

function contractTo(int $operatorId, int $tenantId): void
{
    OperatorClient::query()->firstOrCreate(
        ['operator_id' => $operatorId, 'tenant_id' => $tenantId],
        ['status' => OperatorClient::ACTIVE],
    );
}

it('lets a fleet Super Admin see the clients it holds contracts with', function () {
    ['companyA' => $companyA, 'companyB' => $companyB] = seedTwoTenants();
    contractTo(Operator::SHANITAH, (int) $companyA->tenant_id);

    $ids = collect(
        $this->actingAs(fleetActor(UserRole::SUPER_ADMIN), 'sanctum')
            ->getJson('/api/v1/companies')->assertOk()->json('data')
    )->pluck('id');

    // Not zero — the original regression — and not everything either.
    expect($ids)->toContain($companyA->id)
        ->and($ids)->not->toContain($companyB->id);
});

it('lets a fleet Operations Manager see the same, and no more', function () {
    ['companyA' => $companyA, 'companyB' => $companyB] = seedTwoTenants();
    contractTo(Operator::SHANITAH, (int) $companyA->tenant_id);

    $ids = collect(
        $this->actingAs(fleetActor(UserRole::OPERATIONS_MANAGER), 'sanctum')
            ->getJson('/api/v1/companies')->assertOk()->json('data')
    )->pluck('id');

    expect($ids)->toContain($companyA->id)
        ->and($ids)->not->toContain($companyB->id);
});

/**
 * ADR-0062 §1. Head office reads the directory whoever serves them — and this
 * is the level `TenantScope` fails closed on hardest, because a Kangaru
 * account has no client to bind at all.
 */
it('lets head office see every client, contract or not', function () {
    ['companyA' => $companyA, 'companyB' => $companyB] = seedTwoTenants();

    $ids = collect(
        $this->actingAs(User::factory()->create([
            'tenant_id' => null,
            'operator_id' => null,
            'access_level' => AccessLevel::KANGARU,
            'role' => UserRole::SUPER_ADMIN,
        ]), 'sanctum')->getJson('/api/v1/companies')->assertOk()->json('data')
    )->pluck('id');

    expect($ids)->toContain($companyA->id, $companyB->id);
});
