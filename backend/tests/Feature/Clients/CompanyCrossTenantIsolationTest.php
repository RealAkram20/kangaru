<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Clients\Models\Company;

/**
 * AGENTS.md-mandated, non-skippable: proves ADR-0001 tenant isolation holds
 * for the first tenant-scoped resource. Every future tenant-scoped resource
 * should get an equivalent test.
 */
function seedTwoTenants(): array
{
    $tenantA = Tenant::create(['name' => 'Tenant A', 'slug' => 'tenant-a', 'status' => 'active']);
    $tenantB = Tenant::create(['name' => 'Tenant B', 'slug' => 'tenant-b', 'status' => 'active']);

    $companyA = Company::allTenants()->create([
        'tenant_id' => $tenantA->id,
        'legal_name' => 'Company A Ltd',
        'billing_email' => 'billing@company-a.test',
        'city' => 'Kampala',
        'country' => 'Uganda',
    ]);

    $companyB = Company::allTenants()->create([
        'tenant_id' => $tenantB->id,
        'legal_name' => 'Company B Ltd',
        'billing_email' => 'billing@company-b.test',
        'city' => 'Kampala',
        'country' => 'Uganda',
    ]);

    $userA = User::factory()->create([
        'tenant_id' => $tenantA->id,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    return compact('tenantA', 'tenantB', 'companyA', 'companyB', 'userA');
}

it('excludes another tenant\'s company from the index listing', function () {
    ['companyA' => $companyA, 'companyB' => $companyB, 'userA' => $userA] = seedTwoTenants();

    $response = $this->actingAs($userA, 'sanctum')->getJson('/api/v1/companies');

    $ids = collect($response->json('data'))->pluck('id');

    $response->assertOk();
    expect($ids)->toContain($companyA->id);
    expect($ids)->not->toContain($companyB->id);
});

it('returns 404, not 403, when fetching another tenant\'s company by id', function () {
    ['companyB' => $companyB, 'userA' => $userA] = seedTwoTenants();

    $response = $this->actingAs($userA, 'sanctum')->getJson("/api/v1/companies/{$companyB->id}");

    $response->assertStatus(404)
        ->assertJsonPath('code', 'NOT_FOUND');
});

it('hides another tenant\'s company at the model level under TenantContext', function () {
    ['tenantA' => $tenantA, 'companyB' => $companyB] = seedTwoTenants();

    app(TenantContext::class)->set($tenantA->id);

    expect(Company::find($companyB->id))->toBeNull();
});
