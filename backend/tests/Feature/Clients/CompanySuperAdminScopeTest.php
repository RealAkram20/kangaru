<?php

use App\Enums\UserRole;
use App\Models\User;

/**
 * Regression test for CompanyService::list(): platform-level users
 * (tenant_id null) have no TenantContext of their own, so the normal
 * TenantScope fails closed and previously returned zero companies for
 * them. Covers both platform-level roles specifically — a naive fix that
 * only special-cased SUPER_ADMIN would still miss OPERATIONS_MANAGER,
 * since CompanyPolicy::viewAny() allows any authenticated user through.
 */
it('lets a Super Admin see companies across all tenants', function () {
    ['companyA' => $companyA, 'companyB' => $companyB] = seedTwoTenants();

    $superAdmin = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    $response = $this->actingAs($superAdmin, 'sanctum')->getJson('/api/v1/companies');

    $ids = collect($response->json('data'))->pluck('id');
    $response->assertOk();
    expect($ids)->toContain($companyA->id, $companyB->id);
});

it('lets an Operations Manager see companies across all tenants', function () {
    ['companyA' => $companyA, 'companyB' => $companyB] = seedTwoTenants();

    $opsManager = User::factory()->create(['tenant_id' => null, 'role' => UserRole::OPERATIONS_MANAGER]);

    $response = $this->actingAs($opsManager, 'sanctum')->getJson('/api/v1/companies');

    $ids = collect($response->json('data'))->pluck('id');
    $response->assertOk();
    expect($ids)->toContain($companyA->id, $companyB->id);
});
