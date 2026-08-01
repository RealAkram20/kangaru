<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Carbon;
use Modules\Bookings\Models\Booking;
use Modules\Dispatch\Services\DispatchService;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Services\TripStateMachine;
use Modules\Vehicles\Models\Vehicle;

/**
 * Builds a real completed trip by walking the state machine, so the report
 * is tested against data the product can actually produce. A Trip row
 * written straight to a completed status would have odometer and timestamp
 * values no transition ever set, and would prove nothing about the report.
 */
function completedTrip(Tenant $tenant, User $actor, array $overrides = []): Trip
{
    // DispatchService and TripStateMachine re-read their rows through
    // TenantScope, which fails closed. Calling them directly skips the
    // IdentifyTenant middleware that would normally bind the tenant, so it
    // is bound by hand — exactly as DemoFleetSeeder does.
    app(TenantContext::class)->set($tenant->id);

    $vehicle = Vehicle::factory()->forTenant($tenant)->create();
    $driver = Driver::factory()->forTenant($tenant)->create();
    $booking = Booking::factory()->forTenant($tenant)->create([
        'origin' => $overrides['origin'] ?? 'Kampala',
        'destination' => $overrides['destination'] ?? 'Entebbe',
    ]);

    $trip = app(DispatchService::class)->assign($booking, $vehicle->id, $driver->id, $actor);
    $machine = app(TripStateMachine::class);

    foreach ([TripStatus::ACCEPTED, TripStatus::DRIVER_EN_ROUTE, TripStatus::DRIVER_ARRIVED,
        TripStatus::PASSENGER_ONBOARD] as $step) {
        $machine->transition($trip, $step, $actor);
    }

    Carbon::setTestNow($overrides['started_at'] ?? now());
    $machine->transition($trip, TripStatus::TRIP_STARTED, $actor, [
        'odometer_start' => $overrides['odometer_start'] ?? 10_000,
    ]);

    Carbon::setTestNow(
        ($overrides['started_at'] ?? now())->copy()->addMinutes($overrides['minutes'] ?? 90)
    );
    $machine->transition($trip, TripStatus::TRIP_COMPLETED, $actor, [
        'odometer_end' => $overrides['odometer_end'] ?? 10_042,
    ]);

    Carbon::setTestNow();

    return $trip->refresh();
}

function seedReportFixture(): array
{
    $tenant = Tenant::factory()->create();
    $manager = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::OPERATIONS_MANAGER]);

    app(TenantContext::class)->set($tenant->id);

    return compact('tenant', 'manager');
}

/** Walks a dispatched trip to Trip Started without completing it. */
function startedTrip(Tenant $tenant, User $actor): Trip
{
    app(TenantContext::class)->set($tenant->id);

    $vehicle = Vehicle::factory()->forTenant($tenant)->create();
    $driver = Driver::factory()->forTenant($tenant)->create();
    $booking = Booking::factory()->forTenant($tenant)->create();

    $trip = app(DispatchService::class)->assign($booking, $vehicle->id, $driver->id, $actor);
    $machine = app(TripStateMachine::class);

    foreach ([TripStatus::ACCEPTED, TripStatus::DRIVER_EN_ROUTE, TripStatus::DRIVER_ARRIVED,
        TripStatus::PASSENGER_ONBOARD, TripStatus::TRIP_STARTED] as $step) {
        $machine->transition($trip, $step, $actor, ['odometer_start' => 500]);
    }

    return $trip->refresh();
}

it('reports all six of the Bank\'s required data points on every row', function () {
    ['tenant' => $tenant, 'manager' => $manager] = seedReportFixture();

    $trip = completedTrip($tenant, $manager, [
        'started_at' => now()->subHours(3),
        'minutes' => 95,
        'odometer_start' => 42_180,
        'odometer_end' => 42_222,
        'origin' => 'Kampala',
        'destination' => 'Entebbe Airport',
    ]);

    $row = $this->actingAs($manager, 'sanctum')
        ->getJson('/api/v1/reports/trips')
        ->assertOk()
        ->json('data.0');

    expect($row['trip_id'])->toBe($trip->id);
    expect($row['commenced_at'])->not->toBeNull();          // 1
    expect($row['completed_at'])->not->toBeNull();          // 1
    expect($row['vehicle_registration'])->not->toBeNull();  // 2
    expect($row['origin'])->toBe('Kampala');                // 3
    expect($row['destination'])->toBe('Entebbe Airport');   // 3
    expect($row['odometer_start'])->toBe(42_180);           // 4
    expect($row['odometer_end'])->toBe(42_222);             // 4
    expect((float) $row['distance_km'])->toBe(42.0);        // 5
    expect($row['duration_minutes'])->toBe(95);             // 6
    expect($row['is_complete'])->toBeTrue();
});

it('summarises distance, duration and completeness over the whole filtered set', function () {
    ['tenant' => $tenant, 'manager' => $manager] = seedReportFixture();

    completedTrip($tenant, $manager, ['started_at' => now()->subHours(5), 'minutes' => 60, 'odometer_start' => 100, 'odometer_end' => 130]);
    completedTrip($tenant, $manager, ['started_at' => now()->subHours(4), 'minutes' => 30, 'odometer_start' => 200, 'odometer_end' => 220]);

    $summary = $this->actingAs($manager, 'sanctum')
        ->getJson('/api/v1/reports/trips')
        ->assertOk()
        ->json('meta.summary');

    expect($summary['trips'])->toBe(2);
    expect($summary['trips_completed'])->toBe(2);
    // Cast before comparing: JSON has one number type, so a whole-numbered
    // 50.0 decodes as int. The value is what matters, not PHP's type.
    expect((float) $summary['distance_km'])->toBe(50.0);
    expect($summary['duration_minutes'])->toBe(90);
    expect($summary['records_incomplete'])->toBe(0);
    expect((float) $summary['completeness_percent'])->toBe(100.0);
});

it('leaves completeness null when nothing has completed, rather than reporting a pass', function () {
    ['tenant' => $tenant, 'manager' => $manager] = seedReportFixture();

    // Started but never completed — it has a commencement time so it
    // appears, but it cannot satisfy the six criteria.
    startedTrip($tenant, $manager);

    $response = $this->actingAs($manager, 'sanctum')->getJson('/api/v1/reports/trips')->assertOk();

    expect($response->json('meta.summary.trips'))->toBe(1);
    expect($response->json('meta.summary.trips_completed'))->toBe(0);
    expect($response->json('meta.summary.completeness_percent'))->toBeNull();
    expect($response->json('data.0.is_complete'))->toBeFalse();
});

it('excludes trips that never commenced', function () {
    ['tenant' => $tenant, 'manager' => $manager] = seedReportFixture();

    $vehicle = Vehicle::factory()->forTenant($tenant)->create();
    $driver = Driver::factory()->forTenant($tenant)->create();
    $booking = Booking::factory()->forTenant($tenant)->create();
    $trip = app(DispatchService::class)->assign($booking, $vehicle->id, $driver->id, $manager);

    app(TripStateMachine::class)->transition($trip, TripStatus::CANCELLED, $manager, ['notes' => 'Called off.']);
    // Cancelled before Trip Started, so started_at was never set.

    $response = $this->actingAs($manager, 'sanctum')->getJson('/api/v1/reports/trips')->assertOk();

    // A cancelled-before-start trip has no date of commencement, the first
    // required column, so it must not appear as a blank row.
    expect($response->json('data'))->toBeEmpty();
    expect($response->json('meta.summary.trips'))->toBe(0);
});

it('filters by date range inclusively of the closing day', function () {
    ['tenant' => $tenant, 'manager' => $manager] = seedReportFixture();

    completedTrip($tenant, $manager, ['started_at' => now()->subDays(10)->setTime(9, 0)]);
    $inRange = completedTrip($tenant, $manager, ['started_at' => now()->subDays(3)->setTime(16, 30)]);

    $day = now()->subDays(3)->toDateString();

    $data = $this->actingAs($manager, 'sanctum')
        ->getJson("/api/v1/reports/trips?from={$day}&to={$day}")
        ->assertOk()
        ->json('data');

    // A 16:30 trip must survive a `to` of that same bare date.
    expect(collect($data)->pluck('trip_id'))->toContain($inRange->id);
    expect($data)->toHaveCount(1);
});

it('rejects a range whose end falls before its start', function () {
    ['manager' => $manager] = seedReportFixture();

    $this->actingAs($manager, 'sanctum')
        ->getJson('/api/v1/reports/trips?from=2026-08-01&to=2026-07-01')
        ->assertStatus(422)
        ->assertJsonPath('code', 'VALIDATION_FAILED');
});

it('rejects an unknown report filter with a 422', function () {
    ['manager' => $manager] = seedReportFixture();

    $this->actingAs($manager, 'sanctum')
        ->getJson('/api/v1/reports/trips?bogus=1')
        ->assertStatus(422)
        ->assertJsonPath('code', 'VALIDATION_FAILED');
});

// File output moved to the queued exporter — see ReportExportTest.

it('forbids a driver from reading the fleet-wide report', function () {
    ['tenant' => $tenant] = seedReportFixture();

    $driverUser = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DRIVER]);

    $this->actingAs($driverUser, 'sanctum')
        ->getJson('/api/v1/reports/trips')
        ->assertStatus(403)
        ->assertJsonPath('code', 'FORBIDDEN');
});

it('forbids a corporate employee from reading the fleet-wide report', function () {
    ['tenant' => $tenant] = seedReportFixture();

    $employee = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_EMPLOYEE]);

    $this->actingAs($employee, 'sanctum')
        ->getJson('/api/v1/reports/trips')
        ->assertStatus(403);
});
