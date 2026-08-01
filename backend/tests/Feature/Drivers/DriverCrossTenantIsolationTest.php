<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Drivers\Models\Driver;

/**
 * AGENTS.md-mandated, non-skippable: proves ADR-0001 tenant isolation holds
 * for drivers, mirroring CompanyCrossTenantIsolationTest.
 */
function seedTwoTenantsWithDrivers(): array
{
    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    $driverA = Driver::factory()->forTenant($tenantA)->create(['name' => 'Driver A']);
    $driverB = Driver::factory()->forTenant($tenantB)->create(['name' => 'Driver B']);

    $userA = User::factory()->create([
        'tenant_id' => $tenantA->id,
        'role' => UserRole::FLEET_OWNER,
    ]);

    return compact('tenantA', 'tenantB', 'driverA', 'driverB', 'userA');
}

it('excludes another tenant\'s driver from the index listing', function () {
    ['driverA' => $driverA, 'driverB' => $driverB, 'userA' => $userA] = seedTwoTenantsWithDrivers();

    $response = $this->actingAs($userA, 'sanctum')->getJson('/api/v1/drivers');

    $ids = collect($response->json('data'))->pluck('id');

    $response->assertOk();
    expect($ids)->toContain($driverA->id);
    expect($ids)->not->toContain($driverB->id);
});

it('returns 404, not 403, when fetching another tenant\'s driver by id', function () {
    ['driverB' => $driverB, 'userA' => $userA] = seedTwoTenantsWithDrivers();

    $response = $this->actingAs($userA, 'sanctum')->getJson("/api/v1/drivers/{$driverB->id}");

    $response->assertStatus(404)
        ->assertJsonPath('code', 'NOT_FOUND');
});

it('hides another tenant\'s driver at the model level under TenantContext', function () {
    ['tenantA' => $tenantA, 'driverB' => $driverB] = seedTwoTenantsWithDrivers();

    app(TenantContext::class)->set($tenantA->id);

    expect(Driver::find($driverB->id))->toBeNull();
});

it('allows fetching and updating your own tenant\'s driver', function () {
    ['driverA' => $driverA, 'userA' => $userA] = seedTwoTenantsWithDrivers();

    $this->actingAs($userA, 'sanctum')
        ->getJson("/api/v1/drivers/{$driverA->id}")
        ->assertOk()
        ->assertJsonPath('data.id', $driverA->id);

    $this->actingAs($userA, 'sanctum')
        ->patchJson("/api/v1/drivers/{$driverA->id}", ['status' => 'suspended'])
        ->assertOk()
        ->assertJsonPath('data.status', 'suspended');
});
