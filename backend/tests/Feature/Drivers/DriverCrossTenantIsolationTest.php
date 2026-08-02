<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Drivers\Models\Driver;

/**
 * AGENTS.md-mandated and non-skippable — but **repointed** by ADR-0005,
 * not removed. See VehicleCrossTenantIsolationTest for the full reasoning;
 * a driver works for Shanitah, not for a client, so "another tenant's
 * driver" no longer names anything.
 *
 * What it proves now: the roster is deliberately shared, asserted so that
 * re-scoping drivers to a tenant fails loudly; and the confidential surface
 * — which trips a client can see — is covered by the vehicle file's final
 * case and by EmployeeTripVisibilityTest.
 */
function seedTwoTenantsWithDrivers(): array
{
    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    $driverA = Driver::factory()->create(['name' => 'Driver A']);
    $driverB = Driver::factory()->create(['name' => 'Driver B']);

    $userA = User::factory()->create([
        'tenant_id' => $tenantA->id,
        'role' => UserRole::FLEET_OWNER,
    ]);

    return compact('tenantA', 'tenantB', 'driverA', 'driverB', 'userA');
}

it('shows every tenant the whole driver roster', function () {
    ['driverA' => $driverA, 'driverB' => $driverB, 'userA' => $userA] = seedTwoTenantsWithDrivers();

    $ids = collect(
        $this->actingAs($userA, 'sanctum')->getJson('/api/v1/drivers')->assertOk()->json('data')
    )->pluck('id');

    // Both, deliberately (ADR-0005). A failure here means drivers have been
    // re-scoped to tenants, and dispatch can no longer reach most of them.
    expect($ids)->toContain($driverA->id);
    expect($ids)->toContain($driverB->id);
});

it('lets any tenant open any driver in the roster', function () {
    ['driverB' => $driverB, 'userA' => $userA] = seedTwoTenantsWithDrivers();

    $this->actingAs($userA, 'sanctum')
        ->getJson("/api/v1/drivers/{$driverB->id}")
        ->assertOk()
        ->assertJsonPath('data.id', $driverB->id);
});

it('no longer hides a driver at the model level', function () {
    ['tenantA' => $tenantA, 'driverB' => $driverB] = seedTwoTenantsWithDrivers();

    app(TenantContext::class)->set($tenantA->id);

    // Driver has no BelongsToTenant since ADR-0005. Asserted so that adding
    // it back is a failing test rather than a silent halving of the roster.
    expect(Driver::find($driverB->id))->not->toBeNull();
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
