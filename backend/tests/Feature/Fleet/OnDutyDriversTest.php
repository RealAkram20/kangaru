<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Carbon\CarbonImmutable;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Support\DriverPresence;
use Modules\Fleet\Support\DriverPresenceStore;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * `GET /driver-presence` — who is on duty and where, for the live map
 * (ADR-0024 §2, the office's read).
 *
 * What matters: the pool is named, not numbered; a driver the matcher
 * would hide (stale, or never reported) is *shown* here, labelled, because
 * the map's job is to get them phoned; a driver on a trip says so; and a
 * client's people are refused — the riders are Shanitah's.
 */
function presenceStore(): DriverPresenceStore
{
    return app(DriverPresenceStore::class);
}

function fleetDispatcher(): User
{
    return User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);
}

function onDutyAt(Driver $driver, ?Vehicle $vehicle, float $lat, float $lng, int $ageSeconds = 10): void
{
    presenceStore()->setDuty($driver->id, true, $vehicle?->id);
    presenceStore()->heartbeat(new DriverPresence(
        driverId: $driver->id,
        onDuty: true,
        vehicleId: $vehicle?->id,
        latitude: $lat,
        longitude: $lng,
        accuracyMetres: 12.0,
        recordedAt: CarbonImmutable::now()->subSeconds($ageSeconds),
    ));
}

it('requires a signed-in caller', function () {
    $this->getJson('/api/v1/driver-presence')->assertUnauthorized();
});

it('lists who is on duty, by name and plate, with where they are', function () {
    $driver = Driver::factory()->create(['name' => 'Grace Nakato']);
    $vehicle = Vehicle::factory()->create(['registration_number' => 'UBK 421H', 'make' => 'Bajaj', 'model' => 'Boxer', 'category' => 'boda']);
    onDutyAt($driver, $vehicle, 0.3476, 32.5825);

    $row = $this->actingAs(fleetDispatcher(), 'sanctum')
        ->getJson('/api/v1/driver-presence')->assertOk()->json('data.0');

    expect($row['driver'])->toBe(['id' => $driver->id, 'name' => 'Grace Nakato']);
    expect($row['vehicle'])->toBe(['id' => $vehicle->id, 'registration_number' => 'UBK 421H', 'make' => 'Bajaj', 'model' => 'Boxer', 'category' => 'boda']);
    expect($row['latitude'])->toBe(0.3476);
    expect($row['longitude'])->toBe(32.5825);
    expect($row['stale'])->toBeFalse();
    expect($row['age_seconds'])->toBeGreaterThanOrEqual(10);
    expect($row['trip'])->toBeNull();
});

it('allow-lists what it says about a driver and a vehicle', function () {
    onDutyAt(Driver::factory()->create(), Vehicle::factory()->create(), 0.3476, 32.5825);

    $row = $this->actingAs(fleetDispatcher(), 'sanctum')
        ->getJson('/api/v1/driver-presence')->assertOk()->json('data.0');

    // No phone, no licence number, no VIN. The fleet register serves
    // those, behind its own policy.
    expect(array_keys($row['driver']))->toBe(['id', 'name']);
    expect(array_keys($row['vehicle']))->toBe(['id', 'registration_number', 'make', 'model', 'category']);
});

it('leaves out a driver who has signed off', function () {
    $working = Driver::factory()->create();
    $home = Driver::factory()->create();
    onDutyAt($working, null, 0.3476, 32.5825);
    onDutyAt($home, null, 0.3500, 32.5900);
    presenceStore()->setDuty($home->id, false);

    $ids = collect($this->actingAs(fleetDispatcher(), 'sanctum')
        ->getJson('/api/v1/driver-presence')->assertOk()->json('data'))->pluck('driver_id');

    expect($ids)->toContain($working->id);
    expect($ids)->not->toContain($home->id);
});

it('shows a driver the matcher would hide, marked stale, so somebody phones them', function () {
    $driver = Driver::factory()->create();
    onDutyAt($driver, null, 0.3476, 32.5825, ageSeconds: (int) config('dispatch.presence_ttl_seconds') + 600);

    // The matcher's own view hides them...
    expect(presenceStore()->dispatchable()->pluck('driverId'))->not->toContain($driver->id);

    // ...and the map's shows them, greyed.
    $row = $this->actingAs(fleetDispatcher(), 'sanctum')
        ->getJson('/api/v1/driver-presence')->assertOk()->json('data.0');

    expect($row['driver_id'])->toBe($driver->id);
    expect($row['stale'])->toBeTrue();
});

it('lists a driver who is on duty but has never reported a position, with no coordinates', function () {
    $driver = Driver::factory()->create();
    presenceStore()->setDuty($driver->id, true);

    $row = $this->actingAs(fleetDispatcher(), 'sanctum')
        ->getJson('/api/v1/driver-presence')->assertOk()->json('data.0');

    // Null, not zero. A position the platform does not have is not a
    // position at the origin, and `stale` says why there is no marker.
    expect($row['latitude'])->toBeNull();
    expect($row['longitude'])->toBeNull();
    expect($row['age_seconds'])->toBeNull();
    expect($row['stale'])->toBeTrue();
});

it('falls back to the vehicle on the driver profile when the shift named none', function () {
    $vehicle = Vehicle::factory()->create(['registration_number' => 'UAX 900Q']);
    $driver = Driver::factory()->create(['vehicle_id' => $vehicle->id]);
    onDutyAt($driver, null, 0.3476, 32.5825);

    $row = $this->actingAs(fleetDispatcher(), 'sanctum')
        ->getJson('/api/v1/driver-presence')->assertOk()->json('data.0');

    expect($row['vehicle']['registration_number'])->toBe('UAX 900Q');
});

it('says which trip has a driver, so the map can tell waiting from working', function () {
    $tenant = Tenant::factory()->create();
    $driver = Driver::factory()->create();
    $vehicle = Vehicle::factory()->create();
    onDutyAt($driver, $vehicle, 0.3476, 32.5825);

    $trip = Trip::factory()
        ->forTenant($tenant)
        ->forVehicle($vehicle)
        ->forDriver($driver)
        ->create(['status' => 'passenger_onboard']);

    // A finished trip is not "having" them.
    Trip::factory()->forTenant($tenant)->forVehicle($vehicle)->forDriver($driver)
        ->create(['status' => 'trip_completed']);

    $row = $this->actingAs(fleetDispatcher(), 'sanctum')
        ->getJson('/api/v1/driver-presence')->assertOk()->json('data.0');

    expect($row['trip'])->toBe(['id' => $trip->id, 'status' => 'passenger_onboard']);
});

it('refuses a client\'s people — the riders are Shanitah\'s, not theirs', function () {
    $tenant = Tenant::factory()->create();
    onDutyAt(Driver::factory()->create(), null, 0.3476, 32.5825);

    foreach ([UserRole::CORPORATE_ADMIN, UserRole::CORPORATE_EMPLOYEE] as $role) {
        $user = User::factory()->create(['tenant_id' => $tenant->id, 'role' => $role]);

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/driver-presence')
            ->assertForbidden();
    }
});

it('says nobody is on duty rather than failing when the pool is empty', function () {
    $this->actingAs(fleetDispatcher(), 'sanctum')
        ->getJson('/api/v1/driver-presence')
        ->assertOk()
        ->assertJsonPath('message', 'Nobody is on duty.')
        ->assertJsonCount(0, 'data');
});
