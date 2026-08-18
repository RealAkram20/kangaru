<?php

use App\Enums\UserRole;
use App\Exceptions\TripEventImmutableException;
use App\Models\Customer;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Modules\Administration\Services\SettingsService;
use Modules\Bookings\Models\OrderRequest;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Distance\DistanceGrade;
use Modules\Trips\Distance\DistancePolicy;
use Modules\Trips\Distance\DistanceResolutionService;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Events\TripDistanceResolved;
use Modules\Trips\Jobs\RecordTripLocations;
use Modules\Trips\Jobs\ResolveTripDistance;
use Modules\Trips\Models\DistanceEvidence;
use Modules\Trips\Models\Trip;
use Modules\Trips\Services\TripService;
use Modules\Trips\Services\TripStateMachine;
use Modules\Vehicles\Models\Vehicle;
use Tests\Support\GpsFixtures;

/**
 * The measured-distance pipeline end to end (ADR-0045; Phase 1 of
 * `docs/measured-distance-plan.md`): a trip completes, its trace is
 * measured after the grace period, an evidence row is written and the trip
 * carries the figure and the grade — and **no fare changes**, because
 * nothing prices from the figure yet.
 *
 * OSRM is faked wherever it is on. The fixture is `GpsFixtures::
 * straightLine` — 201 pings 250 m apart, ten seconds apart, 50 km exactly at
 * 90 km/h — so the fake engine can answer arithmetic: a matched chunk of n
 * pings is (n − 1) × 250 m and the reference route is 50 km. (500 m per ten
 * seconds would be 180 km/h, and the cleaner would rightly drop every ping
 * as a teleport.)
 */

/**
 * Drives a corporate trip to Trip Completed with a given odometer span,
 * optionally laying a 50 km GPS trace first.
 *
 * @return array{trip: Trip, tenant: Tenant, actor: User}
 */
function measuredTrip(int $odometerKm, bool $withTrace = true): array
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

    if ($withTrace) {
        GpsFixtures::straightLine($tenant->id, $trip->id, 201, 250);
    }

    $trip = $machine->transition($trip, TripStatus::TRIP_COMPLETED, $actor, [
        'odometer_end' => 10_000 + $odometerKm,
    ]);

    return ['trip' => $trip->fresh(), 'tenant' => $tenant, 'actor' => $actor];
}

/**
 * The fixture's pings, posted the way a device posts them — through the
 * ingestion job — so the late-ping scheduling runs. `GpsFixtures` writes
 * through the recorder directly and would not.
 */
function postFixturePings(?int $tenantId, int $tripId): void
{
    $pings = [];
    $metresPerDegree = deg2rad(1) * 6_371_008.8 * cos(deg2rad(GpsFixtures::START_LAT));

    for ($i = 0; $i < 201; $i++) {
        $pings[] = [
            'latitude' => number_format(GpsFixtures::START_LAT, 7, '.', ''),
            'longitude' => number_format(GpsFixtures::START_LNG + $i * 250 / $metresPerDegree, 7, '.', ''),
            'recorded_at' => now()->subHour()->addSeconds($i * 10)->toDateTimeString(),
        ];
    }

    dispatch(new RecordTripLocations($tenantId, $tripId, $pings));
}

/**
 * OSRM answering the 50 km fixture: a matched chunk of n pings is
 * (n − 1) × 250 m; a route between any two points is 50 km.
 */
function fakeOsrmForFixture(): void
{
    app(SettingsService::class)->setGroup('maps', ['osrm_base_url' => 'https://osrm.test']);
    app(SettingsService::class)->setGroup('tracking', ['trace_matching_enabled' => true]);

    Http::fake(['osrm.test/*' => function ($request) {
        $url = urldecode($request->url());

        if (str_contains($url, '/route/v1/')) {
            return Http::response(['code' => 'Ok', 'routes' => [['distance' => 50_000.0, 'duration' => 3000.0]]]);
        }

        $path = explode('?', substr($url, strpos($url, '/match/v1/driving/') + 18))[0];
        $n = count(explode(';', $path));

        return Http::response([
            'code' => 'Ok',
            'matchings' => [['distance' => ($n - 1) * 250.0, 'geometry' => 'chunk'.$n, 'confidence' => 0.95]],
            'tracepoints' => array_map(fn (int $i) => ['matchings_index' => 0, 'waypoint_index' => $i, 'location' => [32.58, 0.31]], range(0, $n - 1)),
        ]);
    }]);
}

it('resolves a completed trip after completion and writes the evidence, without touching the fare', function () {
    Event::fake([TripDistanceResolved::class]);

    ['trip' => $trip] = measuredTrip(odometerKm: 50);

    $evidence = $trip->latestDistanceEvidence();

    expect($evidence)->not->toBeNull()
        ->and($evidence->trip_id)->toBe($trip->id)
        ->and($evidence->tenant_id)->toBe($trip->tenant_id)
        ->and($evidence->policy)->toBe(DistancePolicy::GPS_PRIMARY)
        // Matching is off by default, so the engine was haversine and the
        // whole trace counts as inferred; with no engine there is no
        // reference route either, so the odometer stands unchecked: C.
        ->and($evidence->provider)->toBe('haversine')
        ->and((float) $evidence->gps_km)->toBe(50.0)
        ->and((float) $evidence->haversine_km)->toBe(50.0)
        ->and((float) $evidence->inferred_share_percent)->toBe(100.0)
        ->and($evidence->route_km)->toBeNull()
        ->and((float) $evidence->odometer_km)->toBe(50.0)
        ->and($evidence->grade)->toBe(DistanceGrade::HELD)
        ->and((float) $evidence->billed_km)->toBe(50.0)
        ->and($evidence->pings_total)->toBe(201)
        ->and($evidence->pings_kept)->toBe(201)
        // Canonicalising: MySQL 8 stores JSON objects with keys reordered
        // (MariaDB, locally, keeps insertion order), and the order of a
        // tally is not a fact about the trace.
        ->and($evidence->dropped)->toEqualCanonicalizing(['mock' => 0, 'accuracy' => 0, 'duplicate' => 0, 'teleport' => 0, 'jitter' => 0])
        ->and($evidence->thresholds['traceMatchingEnabled'])->toBeFalse()
        ->and($evidence->thresholds['corridorCeilingPercent'])->toBe(125)
        ->and($evidence->reason)->toContain('stands unchecked');

    // The trip carries the answer…
    expect((float) $trip->billed_distance_km)->toBe(50.0)
        ->and($trip->distance_grade)->toBe(DistanceGrade::HELD)
        ->and($trip->distance_resolved_at)->not->toBeNull()
        // …and everything that was there before means what it meant.
        ->and((float) $trip->distance_km)->toBe(50.0)
        ->and((float) $trip->gps_distance_km)->toBe(50.0)
        ->and($trip->distance_variance_flagged)->toBeFalse()
        ->and($trip->fare_minor)->toBeNull();

    Event::assertDispatched(TripDistanceResolved::class, fn ($e) => $e->trip->id === $trip->id && $e->evidence->id === $evidence->id);
});

it('grades a matched trace that the road agrees with as GPS-verified when the engine is on', function () {
    fakeOsrmForFixture();

    // An inflated reading well inside ADR-0035's 2,000 km ceiling — the
    // case that ceiling cannot catch and only evidence can.
    ['trip' => $trip] = measuredTrip(odometerKm: 1_900);

    $evidence = $trip->latestDistanceEvidence();

    expect($evidence->provider)->toBe('osrm')
        ->and((float) $evidence->matched_km)->toBe(50.0)
        ->and((float) $evidence->inferred_km)->toBe(0.0)
        ->and((float) $evidence->gps_km)->toBe(50.0)
        ->and((float) $evidence->route_km)->toBe(50.0)
        // A corporate booking has no drop-off pin, so the reference ran
        // between the trace's own ends.
        ->and($evidence->reference_source)->toBe('trace')
        ->and((float) $evidence->coverage_percent)->toBe(100.0)
        ->and((float) $evidence->inferred_share_percent)->toBe(0.0)
        ->and($evidence->grade)->toBe(DistanceGrade::VERIFIED)
        // The trace wins; the mistyped odometer moves nothing.
        ->and((float) $evidence->billed_km)->toBe(50.0)
        // 201 pings in chunks of 100 sharing a boundary: [0..99], [99..198], [198..200].
        ->and(json_decode((string) $evidence->matched_polyline, true))->toBe(['chunk100', 'chunk100', 'chunk3'])
        ->and($evidence->thresholds['traceMatchingEnabled'])->toBeTrue();

    expect((float) $trip->billed_distance_km)->toBe(50.0)
        ->and($trip->distance_grade)->toBe(DistanceGrade::VERIFIED)
        // The old watchdog still fires on the same trip; the two columns
        // answer different questions.
        ->and($trip->distance_variance_flagged)->toBeTrue()
        ->and($trip->fare_minor)->toBeNull();
});

it('takes the reference route from the order pins on a walk-in trip', function () {
    fakeOsrmForFixture();

    $customer = Customer::factory()->create();
    $driverUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $driverUser->id]);
    $trip = Trip::factory()
        ->forCustomer($customer)
        ->forVehicle(Vehicle::factory()->create(['category' => 'sedan', 'status' => 'active']))
        ->forDriver($driver)
        // Started 2,000 s ago — the fixture's own span — so the trace covers
        // the whole trip.
        ->create(['status' => TripStatus::TRIP_STARTED, 'odometer_start' => 100, 'started_at' => now()->subSeconds(2000)]);
    OrderRequest::factory()->create([
        'customer_id' => $customer->id,
        'trip_id' => $trip->id,
        'scheduled_for' => null,
        'pickup_latitude' => 0.3346,
        'pickup_longitude' => 32.5906,
        'dropoff_latitude' => 0.3268,
        'dropoff_longitude' => 32.6011,
    ]);
    GpsFixtures::straightLine(null, $trip->id, 201, 250);

    app(TripStateMachine::class)->transition($trip, TripStatus::TRIP_COMPLETED, $driverUser, ['odometer_end' => 150]);

    $evidence = $trip->fresh()->latestDistanceEvidence();

    expect($evidence)->not->toBeNull()
        ->and($evidence->tenant_id)->toBeNull()
        ->and($evidence->reference_source)->toBe('pins')
        ->and($evidence->grade)->toBe(DistanceGrade::VERIFIED);

    Http::assertSent(fn ($request) => str_contains(urldecode($request->url()), '/route/v1/driving/32.5906,0.3346;32.6011,0.3268'));
});

it('re-resolves when pings arrive after the trip completed, appending a second row', function () {
    ['trip' => $trip, 'tenant' => $tenant] = measuredTrip(odometerKm: 60, withTrace: false);

    $first = $trip->latestDistanceEvidence();
    expect($first->gps_km)->toBeNull()
        ->and($first->pings_total)->toBe(0)
        ->and(DistanceEvidence::query()->forTrip($trip)->count())->toBe(1);

    // The device drains its outbox an hour later.
    postFixturePings($tenant->id, $trip->id);

    $trip = $trip->fresh();
    $second = $trip->latestDistanceEvidence();

    expect(DistanceEvidence::query()->forTrip($trip)->count())->toBe(2)
        ->and($second->id)->not->toBe($first->id)
        ->and((float) $second->gps_km)->toBe(50.0)
        ->and($second->pings_total)->toBe(201)
        // The trip reflects the latest; the first row is still there.
        ->and($trip->distance_resolved_at->equalTo($second->resolved_at))->toBeTrue()
        ->and(DistanceEvidence::query()->forTrip($trip)->find($first->id))->not->toBeNull();
});

it('does not resolve a trip that has not completed, even when its pings arrive', function () {
    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);
    $trip = Trip::factory()->create(['tenant_id' => $tenant->id, 'status' => TripStatus::TRIP_STARTED]);

    GpsFixtures::straightLine($tenant->id, $trip->id, 11, 250);
    (new ResolveTripDistance($trip->id))->handle(app(DistanceResolutionService::class));

    expect(DistanceEvidence::query()->forTrip($trip)->count())->toBe(0)
        ->and($trip->fresh()->distance_resolved_at)->toBeNull();
});

it('schedules the resolution behind the operator\'s grace period, once per trip', function () {
    Queue::fake([ResolveTripDistance::class]);
    app(SettingsService::class)->setGroup('tracking', ['resolution_grace_seconds' => 300]);

    ['trip' => $trip, 'tenant' => $tenant] = measuredTrip(odometerKm: 50, withTrace: false);

    Queue::assertPushed(ResolveTripDistance::class, fn (ResolveTripDistance $job) => $job->tripId === $trip->id
        && $job->delay !== null
        && abs(now()->diffInSeconds($job->delay, false) - 300) <= 2);

    // Late pings for the completed trip ask for it again — and while the
    // first is still pending, the job's uniqueness collapses the second
    // into it: one push, not two. (Once the first has *run*, the same
    // request schedules a fresh one — the re-resolution test above.)
    dispatch(new RecordTripLocations($tenant->id, $trip->id, [[
        'latitude' => '0.3152', 'longitude' => '32.5816', 'recorded_at' => now()->toDateTimeString(),
    ]]));

    Queue::assertPushed(ResolveTripDistance::class, 1);
});

it('stores the mock-location flag from the ingestion endpoint and refuses to trust a trace carrying it', function () {
    ['trip' => $trip, 'tenant' => $tenant, 'actor' => $actor] = measuredTrip(odometerKm: 50, withTrace: false);

    $pings = [];
    for ($i = 0; $i < 12; $i++) {
        $pings[] = [
            'latitude' => 0.3152,
            'longitude' => 32.5816 + $i * 0.001,
            'recorded_at' => now()->subMinutes(30)->addSeconds($i * 10)->toDateTimeString(),
            'is_mock' => $i === 5,
        ];
    }

    $this->actingAs($actor)
        ->postJson("/api/v1/trips/{$trip->id}/locations", ['pings' => $pings])
        ->assertStatus(202);

    expect(DB::table('trip_locations')->where('trip_id', $trip->id)->where('is_mock', 1)->count())->toBe(1);

    $evidence = $trip->fresh()->latestDistanceEvidence();

    expect($evidence->dropped['mock'])->toBe(1)
        ->and($evidence->pings_kept)->toBe(11)
        ->and($evidence->grade)->toBe(DistanceGrade::HELD)
        ->and($evidence->reason)->toContain('mock-location');
});

it('replays a trip from the console without writing, and writes with --commit', function () {
    ['trip' => $trip] = measuredTrip(odometerKm: 50);
    $before = DistanceEvidence::query()->forTrip($trip)->count();

    // Each expected substring must match only its own line: Laravel checks
    // them as ordered Mockery expectations, and a line that satisfies an
    // earlier one is consumed by it.
    $this->artisan('trips:replay-distance', ['trip' => $trip->id])
        ->expectsOutputToContain('Trace (billable)')
        ->expectsOutputToContain('Engine')
        ->expectsOutputToContain('Decision (gps_primary): 50.00 km, grade C')
        ->expectsOutputToContain('Nothing written')
        ->assertSuccessful();

    expect(DistanceEvidence::query()->forTrip($trip)->count())->toBe($before);

    $this->artisan('trips:replay-distance', ['trip' => $trip->id, '--policy' => 'odometer', '--commit' => true])
        ->expectsOutputToContain('Decision (odometer)')
        ->expectsOutputToContain('Recorded as evidence')
        ->assertSuccessful();

    $latest = $trip->fresh()->latestDistanceEvidence();

    expect(DistanceEvidence::query()->forTrip($trip)->count())->toBe($before + 1)
        ->and($latest->policy)->toBe(DistancePolicy::ODOMETER);

    $this->artisan('trips:replay-distance', ['trip' => $trip->id, '--policy' => 'nonsense'])->assertFailed();
    $this->artisan('trips:replay-distance', ['trip' => 999_999])->assertFailed();
});

it('refuses to edit or delete an evidence row', function () {
    ['trip' => $trip] = measuredTrip(odometerKm: 50);
    $evidence = $trip->latestDistanceEvidence();

    expect(fn () => $evidence->update(['billed_km' => 1]))->toThrow(TripEventImmutableException::class)
        ->and(fn () => $evidence->delete())->toThrow(TripEventImmutableException::class);
});
