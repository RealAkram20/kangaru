<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Administration\Services\SettingsService;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Services\TripService;
use Modules\Trips\Services\TripStateMachine;
use Modules\Vehicles\Models\Vehicle;
use Tests\Support\GpsFixtures;

/**
 * PROJECT.md: "Odometer distance is automatically reconciled against
 * GPS-calculated distance; variances beyond a configurable threshold are
 * flagged for review."
 *
 * The flag is the point of the whole GPS pipeline for the anchor client: it
 * is what turns a driver-entered number into a checkable one. These tests
 * pin down when it fires and — just as importantly — when it does not,
 * because a flag that fires on every trip is a flag nobody reviews, and
 * PROJECT.md's success metric depends on them being reviewed within two
 * business days.
 */

/**
 * Drives a trip to Trip Completed with a given odometer span, optionally
 * laying a GPS trace of a known length first.
 *
 * @return array{trip: Trip, tenant: Tenant, actor: User}
 */
function completedTripWithRoute(int $odometerKm, ?float $gpsKm): array
{
    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $actor = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DISPATCHER]);
    $vehicle = Vehicle::factory()->create();
    $driver = Driver::factory()->create();

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

    if ($gpsKm !== null) {
        // 101 points spaced so the straight line is exactly $gpsKm.
        GpsFixtures::straightLine($tenant->id, $trip->id, 101, $gpsKm * 1000 / 100);
    }

    $trip = $machine->transition($trip, TripStatus::TRIP_COMPLETED, $actor, [
        'odometer_end' => 10_000 + $odometerKm,
    ]);

    return ['trip' => $trip->fresh(), 'tenant' => $tenant, 'actor' => $actor];
}

it('records the GPS distance and leaves the trip unflagged when the readings agree', function () {
    // 50 km on the odometer, 49 km on GPS — 2% apart, inside the 10%
    // threshold. GPS routinely reads a little short: it samples a curve as
    // a chain of straight lines.
    ['trip' => $trip] = completedTripWithRoute(odometerKm: 50, gpsKm: 49.0);

    expect((float) $trip->distance_km)->toBe(50.0);
    expect((float) $trip->gps_distance_km)->toBe(49.0);
    expect($trip->distance_variance_flagged)->toBeFalse();
});

it('flags a trip whose odometer reading disagrees with the route', function () {
    // 50 km claimed, 20 km driven — 60% apart. This is the case the Bank
    // cares about: a reading that cannot be reconciled with where the
    // vehicle actually went.
    ['trip' => $trip] = completedTripWithRoute(odometerKm: 50, gpsKm: 20.0);

    expect((float) $trip->gps_distance_km)->toBe(20.0);
    expect($trip->distance_variance_flagged)->toBeTrue();
});

it('does not flag a trip that has no GPS trace at all', function () {
    // No device fitted, or no signal for the whole journey. That is not the
    // driver disagreeing with the evidence — there is no evidence. Flagging
    // it would flag every trip taken before trackers were installed and
    // bury the real ones.
    ['trip' => $trip] = completedTripWithRoute(odometerKm: 50, gpsKm: null);

    expect($trip->gps_distance_km)->toBeNull();
    expect($trip->distance_variance_flagged)->toBeFalse();
});

it('respects the threshold the office has set', function () {
    // 50 km vs 44 km is 12% — over the default 10%, under a configured 20%.
    //
    // **Settings, not `config()`** (ADR-0035). The threshold behind
    // PROJECT.md's "flagged trips reviewed within two business days" metric
    // used to live in `config/tracking.php` behind an env var, which meant a
    // deploy to change it, no sight of it in the console, and no audit trail.
    // Setting `tracking.variance_threshold_percent` via `config()` now changes
    // nothing at all, and this test fails if the state machine goes back to
    // reading it.
    app(SettingsService::class)->setGroup('tracking', ['variance_threshold_percent' => 20]);

    ['trip' => $loose] = completedTripWithRoute(odometerKm: 50, gpsKm: 44.0);
    expect($loose->distance_variance_flagged)->toBeFalse();

    app(SettingsService::class)->setGroup('tracking', ['variance_threshold_percent' => 5]);

    ['trip' => $strict] = completedTripWithRoute(odometerKm: 50, gpsKm: 44.0);
    expect($strict->distance_variance_flagged)->toBeTrue();
});

it('flags a zero odometer span that the GPS contradicts', function () {
    // Opening and closing readings identical, but the vehicle demonstrably
    // moved. A percentage is undefined against zero, so this case is
    // decided on its own terms rather than by dividing by zero.
    ['trip' => $trip] = completedTripWithRoute(odometerKm: 0, gpsKm: 12.0);

    expect((float) $trip->distance_km)->toBe(0.0);
    expect((float) $trip->gps_distance_km)->toBe(12.0);
    expect($trip->distance_variance_flagged)->toBeTrue();
});

it('surfaces the reconciliation on the trip resource', function () {
    ['trip' => $trip, 'actor' => $actor] = completedTripWithRoute(odometerKm: 50, gpsKm: 20.0);

    $this->actingAs($actor, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->assertJsonPath('data.distance_variance_flagged', true)
        ->assertJsonPath('data.gps_distance_km', '20.00');
});
