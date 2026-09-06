<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\Http;
use Modules\Administration\Services\SettingsService;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Services\TripService;
use Modules\Trips\Services\TripStateMachine;
use Modules\Vehicles\Models\Vehicle;
use Tests\Support\GpsFixtures;

/**
 * Trips with the odometer switched off (ADR-0047).
 *
 * `distance_km` has always been `odometer_end - odometer_start`, and
 * `TripPricingEngine` prices from it. With `tracking.odometer_enabled` off
 * that subtraction has nothing on either side, so the GPS trace prices the
 * trip instead — bounded by what the road allows.
 *
 * **These tests are about money.** Every one of them pins a figure that
 * becomes an invoice line or a driver's earnings, so the assertions are on
 * the number rather than on "it did something".
 */
function tripWithOdometerOff(?float $gpsKm, ?float $routeKm = null): Trip
{
    app(SettingsService::class)->setGroup('tracking', [
        'odometer_enabled' => false,
        'trace_route_ceiling_percent' => 30,
        'variance_threshold_percent' => 10,
        'odometer_max_km_per_trip' => 2000,
    ]);

    if ($routeKm === null) {
        // Routing left off entirely: no road answer to bound against.
        app(SettingsService::class)->setGroup('maps', ['routing_enabled' => false]);
        Http::fake();
    } else {
        app(SettingsService::class)->setGroup('maps', [
            'routing_enabled' => true,
            'routing_provider' => 'osrm',
            'osrm_base_url' => 'https://osrm.test',
        ]);

        Http::fake(['osrm.test/*' => Http::response([
            'code' => 'Ok',
            'routes' => [[
                'distance' => $routeKm * 1000,
                'duration' => 600,
                'geometry' => 'a~l~Fjk~uOwHJy@P',
            ]],
        ])]);
    }

    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $actor = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DISPATCHER]);

    $trip = app(TripService::class)->create([
        'tenant_id' => $tenant->id,
        'vehicle_id' => Vehicle::factory()->create()->id,
        'driver_id' => Driver::factory()->create()->id,
        'origin' => 'Kampala',
        'destination' => 'Entebbe',
    ], $actor);

    $machine = app(TripStateMachine::class);

    foreach ([
        TripStatus::ACCEPTED,
        TripStatus::DRIVER_EN_ROUTE,
        TripStatus::DRIVER_ARRIVED,
        TripStatus::PASSENGER_ONBOARD,
    ] as $to) {
        $trip = $machine->transition($trip, $to, $actor);
    }

    // **No odometer_start in the payload.** That is the point: with the
    // switch off the driver never saw the field, so nothing sends one.
    $trip = $machine->transition($trip, TripStatus::TRIP_STARTED, $actor);

    if ($gpsKm !== null) {
        GpsFixtures::straightLine($tenant->id, $trip->id, 101, $gpsKm * 1000 / 100);
    }

    return $machine->transition($trip, TripStatus::TRIP_COMPLETED, $actor)->fresh();
}

it('starts a trip with no odometer reading, and still records when it started', function () {
    // The timestamp is the Bank's acceptance criterion #1 and has nothing to
    // do with the dial. An early draft guarded the whole capture method on
    // the switch and produced trips that had started with no record of when.
    $trip = tripWithOdometerOff(gpsKm: 12.0, routeKm: 11.0);

    expect($trip->started_at)->not->toBeNull();
    expect($trip->completed_at)->not->toBeNull();
    expect($trip->odometer_start)->toBeNull();
    expect($trip->odometer_end)->toBeNull();
});

it('prices the trip from the GPS trace when the road agrees', function () {
    // 12 km driven, 11 km of road: within the 30% margin, so the measurement
    // stands as measured.
    $trip = tripWithOdometerOff(gpsKm: 12.0, routeKm: 11.0);

    expect((float) $trip->distance_km)->toBe(12.0);
    expect((float) $trip->gps_distance_km)->toBe(12.0);
    expect($trip->distance_variance_flagged)->toBeFalse();
});

it('caps a trace that runs further than the road allows, and flags it', function () {
    // **The guard that makes a GPS-priced fare safe to bill.** 41 km of trace
    // against 12 km of road is not a detour, it is jitter or a spoofed
    // location — and once the trace prices the fare rather than merely
    // checking it, an unbounded trace is a handset that pays itself.
    //
    // Capped at 12 × 1.30 = 15.6, not refused: the passenger is at the kerb
    // and the driver did drive somewhere.
    $trip = tripWithOdometerOff(gpsKm: 41.0, routeKm: 12.0);

    expect((float) $trip->distance_km)->toBe(15.6);
    expect($trip->distance_variance_flagged)->toBeTrue();

    // The raw measurement survives the cap. It is the evidence a reviewer
    // needs to answer a disputed fare — "the trace said 41, the road allows
    // 15.6, we billed 15.6" is reviewable; "we billed 15.6" is not.
    expect((float) $trip->gps_distance_km)->toBe(41.0);
});

it('allows a real detour inside the margin without flagging it', function () {
    // A one-way system or a diversion genuinely runs longer than the route.
    // 14 km against 11 km of road is 27%, inside the 30% margin — billed in
    // full, unflagged. A flag that fires on ordinary driving is a flag
    // nobody reads.
    $trip = tripWithOdometerOff(gpsKm: 14.0, routeKm: 11.0);

    expect((float) $trip->distance_km)->toBe(14.0);
    expect($trip->distance_variance_flagged)->toBeFalse();
});

it('bills the trace unbounded and unflagged when routing is switched off', function () {
    // An operator who has not turned routing on has not asked for a second
    // opinion. Flagging every trip in that deployment would make the flag
    // mean nothing, so the trace stands — which ADR-0047 records as the cost
    // of leaving `maps.routing_enabled` off.
    $trip = tripWithOdometerOff(gpsKm: 41.0, routeKm: null);

    expect((float) $trip->distance_km)->toBe(41.0);
    expect($trip->distance_variance_flagged)->toBeFalse();

    Http::assertNothingSent();
});

it('leaves distance null rather than zero when there is no trace at all', function () {
    // **Null and zero are different claims.** Zero says the vehicle did not
    // move, which reads as a complete answer and invites nobody to look.
    // Null says the platform does not know, which reaches billing as
    // unpriced work somebody resolves.
    $trip = tripWithOdometerOff(gpsKm: null, routeKm: 11.0);

    expect($trip->distance_km)->toBeNull();
    expect($trip->gps_distance_km)->toBeNull();
    expect($trip->distance_variance_flagged)->toBeTrue();
});

it('writes why the trip was priced that way onto the timeline', function () {
    // A reviewer opening a flagged trip should not have to infer the reason
    // from three columns.
    $trip = tripWithOdometerOff(gpsKm: 41.0, routeKm: 12.0);

    $note = $trip->events()->where('to_status', TripStatus::TRIP_COMPLETED)->value('notes');

    expect($note)->toContain('41.00 km');
    expect($note)->toContain('flagged for review');
});

// -- The switch back on ----------------------------------------------------

it('still demands and uses the odometer when the switch is on', function () {
    // The default, and the Bank's acceptance criterion #4. Pinned here so a
    // change to the disabled path cannot quietly alter the enabled one.
    app(SettingsService::class)->setGroup('tracking', [
        'odometer_enabled' => true,
        'trace_route_ceiling_percent' => 30,
        'variance_threshold_percent' => 10,
        'odometer_max_km_per_trip' => 2000,
    ]);

    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);
    $actor = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DISPATCHER]);

    $trip = app(TripService::class)->create([
        'tenant_id' => $tenant->id,
        'vehicle_id' => Vehicle::factory()->create()->id,
        'driver_id' => Driver::factory()->create()->id,
        'origin' => 'Kampala',
        'destination' => 'Entebbe',
    ], $actor);

    $machine = app(TripStateMachine::class);

    foreach ([
        TripStatus::ACCEPTED,
        TripStatus::DRIVER_EN_ROUTE,
        TripStatus::DRIVER_ARRIVED,
        TripStatus::PASSENGER_ONBOARD,
    ] as $to) {
        $trip = $machine->transition($trip, $to, $actor);
    }

    $trip = $machine->transition($trip, TripStatus::TRIP_STARTED, $actor, ['odometer_start' => 10_000]);
    $trip = $machine->transition($trip, TripStatus::TRIP_COMPLETED, $actor, ['odometer_end' => 10_050]);

    expect((float) $trip->fresh()->distance_km)->toBe(50.0);
    expect($trip->fresh()->odometer_start)->toBe(10_000);
});
