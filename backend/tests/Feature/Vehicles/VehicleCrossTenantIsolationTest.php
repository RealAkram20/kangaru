<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Vehicles\Models\Vehicle;

/**
 * AGENTS.md-mandated, non-skippable: proves ADR-0001 tenant isolation holds
 * for vehicles, mirroring CompanyCrossTenantIsolationTest.
 */
function seedTwoTenantsWithVehicles(): array
{
    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    $vehicleA = Vehicle::factory()->forTenant($tenantA)->van()->create();
    $vehicleB = Vehicle::factory()->forTenant($tenantB)->create();

    $userA = User::factory()->create([
        'tenant_id' => $tenantA->id,
        'role' => UserRole::FLEET_OWNER,
    ]);

    return compact('tenantA', 'tenantB', 'vehicleA', 'vehicleB', 'userA');
}

it('excludes another tenant\'s vehicle from the index listing', function () {
    ['vehicleA' => $vehicleA, 'vehicleB' => $vehicleB, 'userA' => $userA] = seedTwoTenantsWithVehicles();

    $response = $this->actingAs($userA, 'sanctum')->getJson('/api/v1/vehicles');

    $ids = collect($response->json('data'))->pluck('id');

    $response->assertOk();
    expect($ids)->toContain($vehicleA->id);
    expect($ids)->not->toContain($vehicleB->id);
});

it('returns 404, not 403, when fetching another tenant\'s vehicle by id', function () {
    ['vehicleB' => $vehicleB, 'userA' => $userA] = seedTwoTenantsWithVehicles();

    $response = $this->actingAs($userA, 'sanctum')->getJson("/api/v1/vehicles/{$vehicleB->id}");

    $response->assertStatus(404)
        ->assertJsonPath('code', 'NOT_FOUND');
});

it('hides another tenant\'s vehicle at the model level under TenantContext', function () {
    ['tenantA' => $tenantA, 'vehicleB' => $vehicleB] = seedTwoTenantsWithVehicles();

    app(TenantContext::class)->set($tenantA->id);

    expect(Vehicle::find($vehicleB->id))->toBeNull();
});

it('allows fetching and updating your own tenant\'s vehicle', function () {
    ['vehicleA' => $vehicleA, 'userA' => $userA] = seedTwoTenantsWithVehicles();

    $this->actingAs($userA, 'sanctum')
        ->getJson("/api/v1/vehicles/{$vehicleA->id}")
        ->assertOk()
        ->assertJsonPath('data.id', $vehicleA->id);

    $this->actingAs($userA, 'sanctum')
        ->patchJson("/api/v1/vehicles/{$vehicleA->id}", ['status' => 'maintenance'])
        ->assertOk()
        ->assertJsonPath('data.status', 'maintenance');
});
