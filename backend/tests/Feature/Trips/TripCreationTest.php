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

    $vehicleA = Vehicle::factory()->van()->create();
    $driverA = Driver::factory()->create();

    $inactiveVehicleA = Vehicle::factory()->create(['status' => 'maintenance']);

    $vehicleB = Vehicle::factory()->create();
    $driverB = Driver::factory()->create();

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

it('accepts any vehicle and driver from the platform pool', function () {
    ['vehicleB' => $vehicleB, 'driverB' => $driverB, 'dispatcherA' => $dispatcherA] = seedTripCreationFixture();

    // These two cases asserted that a vehicle and a driver "belonging to
    // another tenant" were refused. Since ADR-0005 neither belongs to
    // anybody — Shanitah operates one fleet — so the refusal has gone, on
    // purpose. Asserted rather than deleted, because a dispatcher silently
    // losing access to most of the pool is exactly the regression this
    // change could cause.
    $this->actingAs($dispatcherA, 'sanctum')->postJson('/api/v1/trips', [
        'vehicle_id' => $vehicleB->id,
        'driver_id' => $driverB->id,
        'origin' => 'Kampala',
        'destination' => 'Entebbe',
    ])->assertStatus(201);
});

it('still rejects a vehicle or driver that does not exist', function () {
    ['vehicleA' => $vehicleA, 'driverA' => $driverA, 'dispatcherA' => $dispatcherA] = seedTripCreationFixture();

    // Tenancy is no longer a reason to refuse; not existing still is.
    $this->actingAs($dispatcherA, 'sanctum')->postJson('/api/v1/trips', [
        'vehicle_id' => 999_999,
        'driver_id' => $driverA->id,
        'origin' => 'Kampala',
        'destination' => 'Entebbe',
    ])->assertStatus(422)->assertJsonPath('code', 'VALIDATION_FAILED');

    $this->actingAs($dispatcherA, 'sanctum')->postJson('/api/v1/trips', [
        'vehicle_id' => $vehicleA->id,
        'driver_id' => 999_999,
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
