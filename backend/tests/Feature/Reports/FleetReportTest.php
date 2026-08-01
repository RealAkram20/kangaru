<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\Storage;
use Modules\Drivers\Models\Driver;
use Modules\Reports\Models\ReportExport;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Services\TripService;
use Modules\Trips\Services\TripStateMachine;
use Modules\Vehicles\Models\Vehicle;

/**
 * The driver and vehicle reports (PROJECT.md Phase 1: "trip, driver,
 * vehicle, financial").
 *
 * Both are the same aggregate over trips grouped differently, so they are
 * tested together — and the totals are asserted against trips built by
 * walking the real state machine, so a figure here is the sum of journeys
 * that could actually have happened.
 */

/**
 * Drives a trip to Trip Completed on the given vehicle and driver.
 */
function fleetTrip(Tenant $tenant, User $actor, Vehicle $vehicle, Driver $driver, int $km): Trip
{
    $trip = app(TripService::class)->create([
        'tenant_id' => $tenant->id,
        'vehicle_id' => $vehicle->id,
        'driver_id' => $driver->id,
        'origin' => 'Kampala',
        'destination' => 'Entebbe',
    ], $actor);

    $machine = app(TripStateMachine::class);

    foreach ([TripStatus::ACCEPTED, TripStatus::DRIVER_EN_ROUTE, TripStatus::DRIVER_ARRIVED, TripStatus::PASSENGER_ONBOARD] as $to) {
        $trip = $machine->transition($trip, $to, $actor);
    }

    $trip = $machine->transition($trip, TripStatus::TRIP_STARTED, $actor, ['odometer_start' => 10_000]);

    return $machine->transition($trip, TripStatus::TRIP_COMPLETED, $actor, ['odometer_end' => 10_000 + $km]);
}

/**
 * @return array<string, mixed>
 */
function fleetFixture(): array
{
    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $manager = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::OPERATIONS_MANAGER]);

    $ada = Driver::factory()->forTenant($tenant)->create(['name' => 'Ada Nakato']);
    $ben = Driver::factory()->forTenant($tenant)->create(['name' => 'Ben Okello']);

    $van = Vehicle::factory()->forTenant($tenant)->van()->create(['registration_number' => 'UAA 111A']);
    $car = Vehicle::factory()->forTenant($tenant)->create(['registration_number' => 'UBB 222B']);

    // Ada: two trips, 40 + 60 = 100 km, both on the van.
    fleetTrip($tenant, $manager, $van, $ada, 40);
    fleetTrip($tenant, $manager, $van, $ada, 60);
    // Ben: one trip, 25 km, on the car.
    fleetTrip($tenant, $manager, $car, $ben, 25);

    return compact('tenant', 'manager', 'ada', 'ben', 'van', 'car');
}

it('totals distance and trips per driver, busiest first', function () {
    ['manager' => $manager] = fleetFixture();

    $response = $this->actingAs($manager, 'sanctum')->getJson('/api/v1/reports/drivers')->assertOk();

    expect($response->json('data'))->toHaveCount(2);

    // Ordered by distance, so the row that matters most is the one you read
    // first. Ada: 100 km over 2 trips; Ben: 25 km over 1.
    expect($response->json('data.0.0'))->toBe('Ada Nakato');
    expect($response->json('data.0.3'))->toBe(2);
    expect((float) $response->json('data.0.5'))->toBe(100.0);
    expect((float) $response->json('data.0.8'))->toBe(50.0);

    expect($response->json('data.1.0'))->toBe('Ben Okello');
    expect((float) $response->json('data.1.5'))->toBe(25.0);

    // Headers travel with the data so no client keeps its own column list.
    expect($response->json('meta.headers.0'))->toBe('Driver');
    expect($response->json('meta.summary.trips'))->toBe(3);
    expect((float) $response->json('meta.summary.distance_km'))->toBe(125.0);
    expect($response->json('meta.summary.entities_active'))->toBe(2);
});

it('totals the same journeys per vehicle', function () {
    ['manager' => $manager] = fleetFixture();

    $response = $this->actingAs($manager, 'sanctum')->getJson('/api/v1/reports/vehicles')->assertOk();

    expect($response->json('data'))->toHaveCount(2);
    expect($response->json('data.0.0'))->toBe('UAA 111A');
    expect($response->json('data.0.1'))->toBe('van');
    expect((float) $response->json('data.0.5'))->toBe(100.0);

    expect($response->json('meta.headers.0'))->toBe('Vehicle registration');

    // The same three trips, grouped differently — the totals must agree
    // whichever way you cut them, or one of the two reports is wrong.
    expect($response->json('meta.summary.trips'))->toBe(3);
    expect((float) $response->json('meta.summary.distance_km'))->toBe(125.0);
});

it('counts only trips that actually commenced', function () {
    ['tenant' => $tenant, 'manager' => $manager, 'ada' => $ada] = fleetFixture();

    // Assigned and then cancelled: a booking nobody drove. Counting it
    // against Ada would make an abandoned job look like work she did.
    $spare = Vehicle::factory()->forTenant($tenant)->create();
    $trip = app(TripService::class)->create([
        'tenant_id' => $tenant->id,
        'vehicle_id' => $spare->id,
        'driver_id' => $ada->id,
        'origin' => 'Kampala',
        'destination' => 'Jinja',
    ], $manager);
    app(TripStateMachine::class)->transition($trip, TripStatus::CANCELLED, $manager, ['notes' => 'Client cancelled.']);

    $response = $this->actingAs($manager, 'sanctum')->getJson('/api/v1/reports/drivers')->assertOk();

    expect($response->json('meta.summary.trips'))->toBe(3);
    expect($response->json('data.0.3'))->toBe(2);
});

it('filters by date range', function () {
    ['manager' => $manager] = fleetFixture();

    $this->actingAs($manager, 'sanctum')
        ->getJson('/api/v1/reports/drivers?from=2030-01-01')
        ->assertOk()
        ->assertJsonCount(0, 'data')
        ->assertJsonPath('meta.summary.trips', 0)
        ->assertJsonPath('meta.summary.entities_active', 0);
});

it('rejects a filter the aggregate cannot honour', function () {
    ['manager' => $manager] = fleetFixture();

    // `vehicle_id` is a trip-report filter. Accepting it here and quietly
    // ignoring it would report every driver while claiming to report one
    // vehicle's.
    $this->actingAs($manager, 'sanctum')
        ->getJson('/api/v1/reports/drivers?vehicle_id=1')
        ->assertStatus(422)
        ->assertJsonValidationErrors('vehicle_id');
});

it('forbids roles that should not see the whole fleet', function () {
    ['tenant' => $tenant] = fleetFixture();

    $driverUser = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DRIVER]);
    $employee = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_EMPLOYEE]);

    foreach ([$driverUser, $employee] as $user) {
        $this->actingAs($user, 'sanctum')->getJson('/api/v1/reports/drivers')->assertForbidden();
        $this->actingAs($user, 'sanctum')->getJson('/api/v1/reports/vehicles')->assertForbidden();
    }
});

it('never totals another tenant\'s fleet into this one', function () {
    ['manager' => $managerA] = fleetFixture();
    fleetFixture();

    // A leak in an aggregate does not look like a stray row — it looks like
    // a bigger number, which is invisible unless the total is asserted
    // directly. ADR-0001 calls this the worst bug the platform can have.
    $this->actingAs($managerA, 'sanctum')
        ->getJson('/api/v1/reports/drivers')
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('meta.summary.trips', 3)
        ->assertJsonPath('meta.summary.distance_km', fn ($v) => (float) $v === 125.0);
});

it('exports a driver report in every format', function () {
    Storage::fake('local');
    ['manager' => $manager] = fleetFixture();

    foreach (['csv', 'xlsx', 'pdf'] as $format) {
        $this->actingAs($manager, 'sanctum')
            ->postJson('/api/v1/reports/exports', ['report' => 'drivers', 'format' => $format])
            ->assertStatus(202);

        $export = ReportExport::latest('id')->firstOrFail();

        expect($export->report->value)->toBe('drivers');
        // Two drivers, so two rows — the export and the screen agree
        // because both come from the same ReportSource.
        expect($export->row_count)->toBe(2);
        expect($export->path)->toContain('kangaruride-drivers-report-');
        Storage::assertExists($export->path);
    }
});

it('exports a vehicle report that is a real workbook, not a renamed CSV', function () {
    Storage::fake('local');
    ['manager' => $manager] = fleetFixture();

    $this->actingAs($manager, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['report' => 'vehicles', 'format' => 'xlsx'])
        ->assertStatus(202);

    $export = ReportExport::latest('id')->firstOrFail();

    // PK is the zip magic every xlsx starts with; a renamed CSV would not.
    expect(substr(Storage::get($export->path), 0, 2))->toBe('PK');
    expect($export->path)->toContain('kangaruride-vehicles-report-');
});

it('still exports the trip report unchanged', function () {
    Storage::fake('local');
    ['manager' => $manager] = fleetFixture();

    // The report type defaults to trips, so a client written before there
    // was more than one report keeps working (AGENTS.md: additive only).
    $this->actingAs($manager, 'sanctum')
        ->postJson('/api/v1/reports/exports', ['format' => 'csv'])
        ->assertStatus(202);

    $export = ReportExport::latest('id')->firstOrFail();

    expect($export->report->value)->toBe('trips');
    expect($export->row_count)->toBe(3);
    expect($export->path)->toContain('kangaruride-trips-report-');
});
