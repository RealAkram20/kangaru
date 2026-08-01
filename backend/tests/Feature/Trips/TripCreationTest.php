<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripEvent;
use Modules\Vehicles\Models\Vehicle;

function seedTripCreationFixture(): array
{
    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    $vehicleA = Vehicle::factory()->forTenant($tenantA)->van()->create();
    $driverA = Driver::factory()->forTenant($tenantA)->create();

    $inactiveVehicleA = Vehicle::factory()->forTenant($tenantA)->create(['status' => 'maintenance']);

    $vehicleB = Vehicle::factory()->forTenant($tenantB)->create();
    $driverB = Driver::factory()->forTenant($tenantB)->create();

    $dispatcherA = User::factory()->create(['tenant_id' => $tenantA->id, 'role' => UserRole::DISPATCHER]);

    return compact(
        'tenantA', 'tenantB', 'vehicleA', 'driverA', 'inactiveVehicleA', 'vehicleB', 'driverB', 'dispatcherA'
    );
}

it('creates a trip directly in Assigned status with one initial trip event', function () {
    ['vehicleA' => $vehicleA, 'driverA' => $driverA, 'dispatcherA' => $dispatcherA] = seedTripCreationFixture();

    $response = $this->actingAs($dispatcherA, 'sanctum')->postJson('/api/v1/trips', [
        'vehicle_id' => $vehicleA->id,
        'driver_id' => $driverA->id,
        'origin' => 'Kampala',
        'destination' => 'Entebbe',
    ]);

    $response->assertCreated()->assertJsonPath('data.status', TripStatus::ASSIGNED->value);

    $trip = Trip::find($response->json('data.id'));
    expect(TripEvent::where('trip_id', $trip->id)->count())->toBe(1);
    expect(TripEvent::where('trip_id', $trip->id)->first()->from_status)->toBeNull();
});

it('rejects a vehicle_id belonging to another tenant', function () {
    ['vehicleB' => $vehicleB, 'driverA' => $driverA, 'dispatcherA' => $dispatcherA] = seedTripCreationFixture();

    $this->actingAs($dispatcherA, 'sanctum')->postJson('/api/v1/trips', [
        'vehicle_id' => $vehicleB->id,
        'driver_id' => $driverA->id,
        'origin' => 'Kampala',
        'destination' => 'Entebbe',
    ])->assertStatus(422)->assertJsonPath('code', 'VALIDATION_FAILED');
});

it('rejects a driver_id belonging to another tenant', function () {
    ['vehicleA' => $vehicleA, 'driverB' => $driverB, 'dispatcherA' => $dispatcherA] = seedTripCreationFixture();

    $this->actingAs($dispatcherA, 'sanctum')->postJson('/api/v1/trips', [
        'vehicle_id' => $vehicleA->id,
        'driver_id' => $driverB->id,
        'origin' => 'Kampala',
        'destination' => 'Entebbe',
    ])->assertStatus(422)->assertJsonPath('code', 'VALIDATION_FAILED');
});

it('rejects a vehicle that is not active', function () {
    ['inactiveVehicleA' => $inactiveVehicleA, 'driverA' => $driverA, 'dispatcherA' => $dispatcherA] = seedTripCreationFixture();

    $this->actingAs($dispatcherA, 'sanctum')->postJson('/api/v1/trips', [
        'vehicle_id' => $inactiveVehicleA->id,
        'driver_id' => $driverA->id,
        'origin' => 'Kampala',
        'destination' => 'Entebbe',
    ])->assertStatus(422)->assertJsonPath('code', 'VALIDATION_FAILED');
});
