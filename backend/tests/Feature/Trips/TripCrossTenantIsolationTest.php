<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripEvent;
use Modules\Vehicles\Models\Vehicle;

/**
 * AGENTS.md-mandated, non-skippable: proves ADR-0001 tenant isolation
 * holds for trips (and their trip_events timeline), mirroring
 * CompanyCrossTenantIsolationTest.
 */
function seedTwoTenantsWithTrips(): array
{
    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    $vehicleA = Vehicle::factory()->forTenant($tenantA)->van()->create();
    $driverA = Driver::factory()->forTenant($tenantA)->create();

    $vehicleB = Vehicle::factory()->forTenant($tenantB)->create();
    $driverB = Driver::factory()->forTenant($tenantB)->create();

    $tripA = Trip::factory()->forTenant($tenantA)->forVehicle($vehicleA)->forDriver($driverA)
        ->create(['origin' => 'Kampala', 'destination' => 'Entebbe']);
    TripEvent::create([
        'tenant_id' => $tenantA->id, 'trip_id' => $tripA->id, 'from_status' => null,
        'to_status' => TripStatus::ASSIGNED, 'user_id' => null, 'notes' => null,
    ]);

    $tripB = Trip::factory()->forTenant($tenantB)->forVehicle($vehicleB)->forDriver($driverB)
        ->create(['origin' => 'Jinja', 'destination' => 'Mbale']);
    TripEvent::create([
        'tenant_id' => $tenantB->id, 'trip_id' => $tripB->id, 'from_status' => null,
        'to_status' => TripStatus::ASSIGNED, 'user_id' => null, 'notes' => null,
    ]);

    $userA = User::factory()->create(['tenant_id' => $tenantA->id, 'role' => UserRole::OPERATIONS_MANAGER]);

    return compact('tenantA', 'tenantB', 'vehicleA', 'driverA', 'vehicleB', 'driverB', 'tripA', 'tripB', 'userA');
}

it('excludes another tenant\'s trip from the index listing', function () {
    ['tripA' => $tripA, 'tripB' => $tripB, 'userA' => $userA] = seedTwoTenantsWithTrips();

    $response = $this->actingAs($userA, 'sanctum')->getJson('/api/v1/trips');

    $ids = collect($response->json('data'))->pluck('id');

    $response->assertOk();
    expect($ids)->toContain($tripA->id);
    expect($ids)->not->toContain($tripB->id);
});

it('returns 404, not 403, when fetching another tenant\'s trip by id', function () {
    ['tripB' => $tripB, 'userA' => $userA] = seedTwoTenantsWithTrips();

    $response = $this->actingAs($userA, 'sanctum')->getJson("/api/v1/trips/{$tripB->id}");

    $response->assertStatus(404)->assertJsonPath('code', 'NOT_FOUND');
});

it('hides another tenant\'s trip at the model level under TenantContext', function () {
    ['tenantA' => $tenantA, 'tripB' => $tripB] = seedTwoTenantsWithTrips();

    app(TenantContext::class)->set($tenantA->id);

    expect(Trip::find($tripB->id))->toBeNull();
});

it('allows fetching your own tenant\'s trip', function () {
    ['tripA' => $tripA, 'userA' => $userA] = seedTwoTenantsWithTrips();

    $this->actingAs($userA, 'sanctum')
        ->getJson("/api/v1/trips/{$tripA->id}")
        ->assertOk()
        ->assertJsonPath('data.id', $tripA->id);
});

it('returns 404, not 403, when fetching another tenant\'s trip events', function () {
    ['tripB' => $tripB, 'userA' => $userA] = seedTwoTenantsWithTrips();

    $response = $this->actingAs($userA, 'sanctum')->getJson("/api/v1/trips/{$tripB->id}/events");

    $response->assertStatus(404)->assertJsonPath('code', 'NOT_FOUND');
});
