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
 * The measured-distance shadow report (ADR-0045; Phase 1 step 5 of
 * `docs/measured-distance-plan.md`).
 *
 * The queue is synchronous under test, so completing a trip resolves it in
 * the same call; every trip built here therefore has a latest evidence row
 * the moment it completes. OSRM is faked where it is on, answering the
 * 50 km fixture the way `DistanceResolutionTest` describes.
 */

/**
 * A completed corporate trip for `$tenant`, with the 50 km trace unless told
 * otherwise, and the given odometer span.
 */
function reportTrip(Tenant $tenant, int $odometerKm, bool $withTrace = true): Trip
{
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

    return $machine->transition($trip, TripStatus::TRIP_COMPLETED, $actor, ['odometer_end' => 10_000 + $odometerKm])->fresh();
}

function fakeOsrmForReport(): void
{
    app(SettingsService::class)->setGroup('maps', ['osrm_base_url' => 'https://osrm.test']);
    app(SettingsService::class)->setGroup('tracking', ['trace_matching_enabled' => true]);

    Http::fake(['osrm.test/*' => function ($request) {
        $url = urldecode($request->url());

        if (str_contains($url, '/route/v1/')) {
            return Http::response(['code' => 'Ok', 'routes' => [['distance' => 50_000.0, 'duration' => 3000.0]]]);
        }

        $n = count(explode(';', explode('?', substr($url, strpos($url, '/match/v1/driving/') + 18))[0]));

        return Http::response([
            'code' => 'Ok',
            'matchings' => [['distance' => ($n - 1) * 250.0, 'geometry' => 'g']],
            'tracepoints' => array_map(fn (int $i) => ['matchings_index' => 0, 'waypoint_index' => $i, 'location' => [32.58, 0.31]], range(0, $n - 1)),
        ]);
    }]);
}

function platformReader(): User
{
    return User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
}

it('lists every completed trip\'s latest resolution with the whole-set distribution', function () {
    fakeOsrmForReport();
    $tenant = Tenant::factory()->create();

    $verified = reportTrip($tenant, odometerKm: 50);   // trace 50, road 50, odometer 50 → A
    $bounded = reportTrip($tenant, odometerKm: 50, withTrace: false); // no trace → no reference → odometer unverified → U
    $inflated = reportTrip($tenant, odometerKm: 1_900); // trace wins, A; odometer 38× off

    $response = $this->actingAs(platformReader())->getJson('/api/v1/reports/distance')->assertOk();

    $rows = collect($response->json('data'));
    $summary = $response->json('meta.summary');

    expect($rows)->toHaveCount(3)
        // Newest resolution first.
        ->and($rows->pluck('trip_id')->all())->toBe([$inflated->id, $bounded->id, $verified->id]);

    $row = $rows->firstWhere('trip_id', $verified->id);
    // `toEqual` on the figures: JSON carries 50.0 as `50`, and the type of a
    // decoded number is the decoder's business, not the report's.
    expect($row['grade'])->toBe('A')
        ->and($row['billed_km'])->toEqual(50)
        ->and($row['gps_km'])->toEqual(50)
        ->and($row['route_km'])->toEqual(50)
        ->and($row['odometer_km'])->toEqual(50)
        ->and($row['provider'])->toBe('osrm')
        ->and($row['reference_source'])->toBe('trace')
        ->and($row['policy'])->toBe('gps_primary')
        ->and($row['driver_name'])->not->toBeNull()
        ->and($row['vehicle_registration'])->not->toBeNull()
        ->and($row['variance_flagged'])->toBeFalse();

    expect($rows->firstWhere('trip_id', $inflated->id)['variance_flagged'])->toBeTrue()
        ->and($rows->firstWhere('trip_id', $inflated->id)['grade'])->toBe('A');

    expect($rows->firstWhere('trip_id', $bounded->id)['grade'])->toBe('U')
        ->and($rows->firstWhere('trip_id', $bounded->id)['gps_km'])->toBeNull();

    expect($summary['resolved'])->toBe(3)
        ->and($summary['unresolved'])->toBe(0)
        ->and($summary['grades'])->toBe(['A' => 2, 'B' => 0, 'C' => 0, 'U' => 1])
        ->and($summary['providers'])->toBe(['osrm' => 3, 'haversine' => 0])
        ->and($summary['no_trace'])->toBe(1)
        ->and($summary['no_reference'])->toBe(1)
        ->and($summary['variance_flagged'])->toBe(1)
        ->and($summary['with_mock_pings'])->toBe(0)
        // A trip with no pings has 0 % coverage — a handset that never
        // reported, not an unknown — so the mean is over three, not two.
        ->and($summary['mean_coverage_percent'])->toEqual(66.7)
        ->and($summary['coverage']['95_up'])->toBe(2)
        ->and($summary['coverage']['under_50'])->toBe(1)
        ->and($summary['coverage']['unknown'])->toBe(0)
        ->and($summary['trace_vs_odometer'])->toBe(['within_5' => 1, '5_to_15' => 0, '15_to_30' => 0, 'over_30' => 1, 'unknown' => 1])
        ->and($summary['trace_vs_route'])->toBe(['within_5' => 2, '5_to_15' => 0, '15_to_30' => 0, 'over_30' => 0, 'unknown' => 1]);

    expect($response->json('meta.scope'))->toBe('platform')
        ->and($response->json('meta.covers'))->toBe('All clients');
});

it('shows only the latest resolution of a trip resolved twice', function () {
    $tenant = Tenant::factory()->create();
    $trip = reportTrip($tenant, odometerKm: 50, withTrace: false);

    // Resolve again from the console: a second evidence row, one report row.
    $this->artisan('trips:replay-distance', ['trip' => $trip->id, '--policy' => 'odometer', '--commit' => true])->assertSuccessful();

    $response = $this->actingAs(platformReader())->getJson('/api/v1/reports/distance')->assertOk();

    expect($response->json('data'))->toHaveCount(1)
        ->and($response->json('data.0.policy'))->toBe('odometer')
        ->and($response->json('meta.summary.resolved'))->toBe(1);
});

it('counts completed trips the resolver has not answered for as unresolved', function () {
    $tenant = Tenant::factory()->create();
    reportTrip($tenant, odometerKm: 50, withTrace: false);
    // A trip completed before the resolver existed: no evidence, no columns.
    Trip::factory()->create(['tenant_id' => $tenant->id, 'status' => TripStatus::TRIP_COMPLETED, 'completed_at' => now()]);

    $summary = $this->actingAs(platformReader())->getJson('/api/v1/reports/distance')->assertOk()->json('meta.summary');

    expect($summary['resolved'])->toBe(1)
        ->and($summary['unresolved'])->toBe(1);
});

it('filters by grade, provider and period, and refuses an unknown filter', function () {
    $tenant = Tenant::factory()->create();
    reportTrip($tenant, odometerKm: 50, withTrace: false); // U, haversine
    $reader = platformReader();

    expect($this->actingAs($reader)->getJson('/api/v1/reports/distance?grade=U')->assertOk()->json('data'))->toHaveCount(1)
        ->and($this->actingAs($reader)->getJson('/api/v1/reports/distance?grade=A')->assertOk()->json('data'))->toHaveCount(0)
        ->and($this->actingAs($reader)->getJson('/api/v1/reports/distance?provider=haversine')->assertOk()->json('data'))->toHaveCount(1)
        ->and($this->actingAs($reader)->getJson('/api/v1/reports/distance?provider=osrm')->assertOk()->json('data'))->toHaveCount(0)
        ->and($this->actingAs($reader)->getJson('/api/v1/reports/distance?to='.now()->subDay()->toDateString())->assertOk()->json('meta.summary.resolved'))->toBe(0)
        ->and($this->actingAs($reader)->getJson('/api/v1/reports/distance?from='.now()->toDateString())->assertOk()->json('meta.summary.resolved'))->toBe(1);

    $this->actingAs($reader)->getJson('/api/v1/reports/distance?grade=D')->assertStatus(422);
    $this->actingAs($reader)->getJson('/api/v1/reports/distance?vehicle_id=1')->assertStatus(422)->assertJsonValidationErrors(['vehicle_id']);
    $this->actingAs($reader)->getJson('/api/v1/reports/distance?from=2026-02-01&to=2026-01-01')->assertStatus(422)->assertJsonValidationErrors(['to']);
});

it('scopes a client\'s user to their own tenant and refuses them the tenant filter', function () {
    $mine = Tenant::factory()->create();
    $theirs = Tenant::factory()->create();
    reportTrip($mine, odometerKm: 50, withTrace: false);
    reportTrip($theirs, odometerKm: 50, withTrace: false);

    $client = User::factory()->create(['tenant_id' => $mine->id, 'role' => UserRole::CORPORATE_ADMIN]);

    $response = $this->actingAs($client)->getJson('/api/v1/reports/distance')->assertOk();

    expect($response->json('data'))->toHaveCount(1)
        ->and($response->json('data.0.tenant_id'))->toBe($mine->id)
        ->and($response->json('meta.summary.resolved'))->toBe(1)
        ->and($response->json('meta.scope'))->toBe('tenant');

    // Naming the other tenant is not a filter that exists for them.
    $this->actingAs($client)->getJson("/api/v1/reports/distance?tenant_id={$theirs->id}")
        ->assertStatus(422)
        ->assertJsonValidationErrors(['tenant_id']);
});

it('lets platform staff narrow to one client', function () {
    $a = Tenant::factory()->create();
    $b = Tenant::factory()->create();
    reportTrip($a, odometerKm: 50, withTrace: false);
    reportTrip($b, odometerKm: 50, withTrace: false);
    reportTrip($b, odometerKm: 50, withTrace: false);

    $reader = platformReader();

    expect($this->actingAs($reader)->getJson('/api/v1/reports/distance')->json('meta.summary.resolved'))->toBe(3)
        ->and($this->actingAs($reader)->getJson("/api/v1/reports/distance?tenant_id={$b->id}")->json('meta.summary.resolved'))->toBe(2)
        ->and($this->actingAs($reader)->getJson("/api/v1/reports/distance?tenant_id={$b->id}")->json('meta.covers'))->toBe($b->name);
});

it('requires the reports permission', function () {
    $driver = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);

    $this->actingAs($driver)->getJson('/api/v1/reports/distance')->assertForbidden();
});
