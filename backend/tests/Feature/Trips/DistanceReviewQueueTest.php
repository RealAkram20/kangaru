<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\Http;
use Modules\Administration\Services\SettingsService;
use Modules\Bookings\Models\OrderRequest;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Distance\DistanceGrade;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Services\TripRouteRecorder;
use Modules\Trips\Services\TripService;
use Modules\Trips\Services\TripStateMachine;
use Modules\Vehicles\Models\Vehicle;
use Tests\Support\BillingFixtures;
use Tests\Support\GpsFixtures;

/**
 * The distance review queue (ADR-0045 §2) — the worklist behind
 * `POST /trips/{trip}/distance/clearance`.
 *
 * What is under test is which trips appear, in what order, to whom, and what
 * leaves the queue. The gate itself is
 * `tests/Feature/Billing/MeasuredDistanceBillingTest.php`.
 */
function reviewOsrm(): void
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

/** The 50 km fixture with one mock ping in it: the trace is not trusted. */
function reviewUntrustedTrace(?int $tenantId, int $tripId): void
{
    $pings = [];
    $metresPerDegree = deg2rad(1) * 6_371_008.8 * cos(deg2rad(GpsFixtures::START_LAT));

    for ($i = 0; $i < 201; $i++) {
        $pings[] = [
            'latitude' => number_format(GpsFixtures::START_LAT, 7, '.', ''),
            'longitude' => number_format(GpsFixtures::START_LNG + $i * 250 / $metresPerDegree, 7, '.', ''),
            'recorded_at' => now()->subHour()->addSeconds($i * 10)->toDateTimeString(),
            'is_mock' => $i === 100,
        ];
    }

    app(TripRouteRecorder::class)->record($tenantId, $tripId, $pings);
}

/**
 * A completed corporate trip for `$ctx`, with a chosen trace and odometer.
 *
 * @param  array<string, mixed>  $ctx
 */
function reviewTrip(array $ctx, ?string $trace, int $odometerKm): Trip
{
    BillingFixtures::bindTenant($ctx['tenant']);

    $trip = app(TripService::class)->create([
        'tenant_id' => $ctx['tenant']->id,
        'vehicle_id' => $ctx['vehicle']->id,
        'driver_id' => $ctx['driver']->id,
        'origin' => 'Kampala',
        'destination' => 'Entebbe',
    ], $ctx['dispatcher']);

    $machine = app(TripStateMachine::class);

    foreach ([TripStatus::ACCEPTED, TripStatus::DRIVER_EN_ROUTE, TripStatus::DRIVER_ARRIVED, TripStatus::PASSENGER_ONBOARD] as $to) {
        $trip = $machine->transition($trip, $to, $ctx['dispatcher']);
    }

    $trip = $machine->transition($trip, TripStatus::TRIP_STARTED, $ctx['dispatcher'], ['odometer_start' => 10_000]);

    if ($trace === 'trusted') {
        GpsFixtures::straightLine($ctx['tenant']->id, $trip->id, 201, 250);
    } elseif ($trace === 'untrusted') {
        reviewUntrustedTrace($ctx['tenant']->id, $trip->id);
    }

    return $machine->transition($trip, TripStatus::TRIP_COMPLETED, $ctx['dispatcher'], [
        'odometer_end' => 10_000 + $odometerKm,
    ])->fresh();
}

function reviewQueue(User $actor)
{
    return test()->actingAs($actor)->getJson('/api/v1/trips/distance-review');
}

it('lists the trips whose distance is holding money up, and nothing else', function () {
    reviewOsrm();
    $ctx = BillingFixtures::tenantWithRateCard(version: ['distance_policy' => 'gps_primary']);

    // Held: the odometer had to be clamped to the road's corridor.
    $held = reviewTrip($ctx, trace: 'untrusted', odometerKm: 100);
    // Not held: a trusted trace the road agrees with.
    $verified = reviewTrip($ctx, trace: 'trusted', odometerKm: 50);

    // Aged, so the waiting figure is a fact rather than a rounding of zero.
    Trip::withoutGlobalScopes()->whereKey($held->id)->update(['distance_resolved_at' => now()->subDays(3)]);

    expect($held->distance_grade)->toBe(DistanceGrade::HELD)
        ->and($verified->distance_grade)->toBe(DistanceGrade::VERIFIED);

    $response = reviewQueue($ctx['finance'])->assertOk();

    expect($response->json('data'))->toHaveCount(1)
        ->and($response->json('data.0.trip_id'))->toBe($held->id)
        ->and($response->json('data.0.grade'))->toBe('C')
        ->and($response->json('data.0.grade_label'))->toBe('held for review')
        ->and($response->json('data.0.billed_km'))->toEqual(62.5)
        ->and($response->json('data.0.odometer_km'))->toEqual(100)
        ->and($response->json('data.0.waiting_days'))->toBe(3)
        ->and($response->json('data.0.is_walk_in'))->toBeFalse()
        ->and($response->json('data.0.driver_name'))->not->toBeNull()
        ->and($response->json('meta.total'))->toBe(1);
});

it('works the queue oldest first, because the metric is measured from the far end', function () {
    reviewOsrm();
    $ctx = BillingFixtures::tenantWithRateCard(version: ['distance_policy' => 'gps_primary']);

    $newest = reviewTrip($ctx, trace: 'untrusted', odometerKm: 100);
    $oldest = reviewTrip($ctx, trace: 'untrusted', odometerKm: 100);
    $middle = reviewTrip($ctx, trace: 'untrusted', odometerKm: 100);

    Trip::withoutGlobalScopes()->whereKey($oldest->id)->update(['distance_resolved_at' => now()->subDays(9)]);
    Trip::withoutGlobalScopes()->whereKey($middle->id)->update(['distance_resolved_at' => now()->subDays(4)]);
    Trip::withoutGlobalScopes()->whereKey($newest->id)->update(['distance_resolved_at' => now()->subHour()]);

    $ids = collect(reviewQueue($ctx['finance'])->assertOk()->json('data'))->pluck('trip_id')->all();

    expect($ids)->toBe([$oldest->id, $middle->id, $newest->id]);
});

it('holds an unverified trip only where the contract prices the trace', function () {
    // Grade U is "no evidence either way" (ADR-0045 §2). Under the odometer
    // policy it bills as it always did and has no business in a review queue;
    // under a trace-priced one it is exactly what a reviewer must look at.
    $odometerCtx = BillingFixtures::tenantWithRateCard();
    $unverifiedButBillable = reviewTrip($odometerCtx, trace: null, odometerKm: 42);

    $traceCtx = BillingFixtures::tenantWithRateCard(version: ['distance_policy' => 'gps_primary']);
    $unverifiedAndHeld = reviewTrip($traceCtx, trace: null, odometerKm: 42);

    expect($unverifiedButBillable->distance_grade)->toBe(DistanceGrade::UNVERIFIED)
        ->and($unverifiedAndHeld->distance_grade)->toBe(DistanceGrade::UNVERIFIED);

    // A platform reader sees both clients' trips, so the queue's own rule is
    // what separates them rather than the scope.
    $platform = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
    $response = reviewQueue($platform)->assertOk();

    expect(collect($response->json('data'))->pluck('trip_id')->all())->toBe([$unverifiedAndHeld->id])
        ->and($response->json('data.0.grade'))->toBe('U')
        ->and($response->json('data.0.client'))->toBe($traceCtx['tenant']->name);
});

it('drops a trip out of the queue the moment it is cleared', function () {
    reviewOsrm();
    $ctx = BillingFixtures::tenantWithRateCard(version: ['distance_policy' => 'gps_primary']);
    $held = reviewTrip($ctx, trace: 'untrusted', odometerKm: 100);

    expect(reviewQueue($ctx['finance'])->json('meta.total'))->toBe(1);

    test()->actingAs($ctx['finance'])
        ->postJson("/api/v1/trips/{$held->id}/distance/clearance", ['reason' => 'Reviewed the trace; the client confirmed the extra stop.'])
        ->assertOk();

    $response = reviewQueue($ctx['finance'])->assertOk();

    expect($response->json('data'))->toHaveCount(0)
        ->and($response->json('meta.total'))->toBe(0)
        ->and($response->json('message'))->toContain('No trips are waiting');
});

it('shows a client only their own held trips, and a walk-in to nobody but the platform', function () {
    reviewOsrm();
    $mine = BillingFixtures::tenantWithRateCard(version: ['distance_policy' => 'gps_primary']);
    $theirs = BillingFixtures::tenantWithRateCard(version: ['distance_policy' => 'gps_primary']);

    $ours = reviewTrip($mine, trace: 'untrusted', odometerKm: 100);
    reviewTrip($theirs, trace: 'untrusted', odometerKm: 100);

    // A walk-in on the platform's own tariff, held the same way.
    BillingFixtures::publicTariff(['sedan' => [2_000, 1_500]]);
    $customer = Customer::factory()->create();
    $driverUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $walkIn = Trip::factory()
        ->forCustomer($customer)
        ->forVehicle(Vehicle::factory()->create(['category' => 'sedan', 'status' => 'active']))
        ->forDriver(Driver::factory()->create(['user_id' => $driverUser->id]))
        ->create(['status' => TripStatus::TRIP_STARTED, 'odometer_start' => 100, 'started_at' => now()->subSeconds(2000)]);
    OrderRequest::factory()->create(['customer_id' => $customer->id, 'trip_id' => $walkIn->id, 'scheduled_for' => null]);
    reviewUntrustedTrace(null, $walkIn->id);
    app(TenantContext::class)->set(null);
    app(TripStateMachine::class)->transition($walkIn, TripStatus::TRIP_COMPLETED, $driverUser, ['odometer_end' => 200]);

    $client = User::factory()->create(['tenant_id' => $mine['tenant']->id, 'role' => UserRole::CORPORATE_ADMIN]);
    $clientQueue = reviewQueue($client)->assertOk();

    expect(collect($clientQueue->json('data'))->pluck('trip_id')->all())->toBe([$ours->id])
        ->and($clientQueue->json('meta.total'))->toBe(1)
        // Their own client's name is not a fact they need repeated back.
        ->and($clientQueue->json('data.0'))->not->toHaveKey('client');

    $platform = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
    $platformQueue = reviewQueue($platform)->assertOk();

    // Both clients' trips, plus the walk-in — which belongs to the platform.
    $walkInRow = collect($platformQueue->json('data'))->firstWhere('trip_id', $walkIn->id);

    expect($platformQueue->json('meta.total'))->toBe(3)
        ->and($walkInRow['is_walk_in'])->toBeTrue()
        ->and($walkInRow['client'])->toBeNull()
        // Held, so nothing settled behind it — which is the point of the row.
        ->and($walkInRow['fare_settled'])->toBeFalse();
});

it('is empty rather than forbidden for a reader with no trips of their own, and refuses an unknown filter', function () {
    $ctx = BillingFixtures::tenantWithRateCard();
    $employee = User::factory()->create(['tenant_id' => $ctx['tenant']->id, 'role' => UserRole::CORPORATE_EMPLOYEE]);

    // A corporate employee may see the trips they raised, so the queue is not
    // forbidden to them — it is simply empty, which is the honest answer.
    expect(reviewQueue($employee)->assertOk()->json('meta.total'))->toBe(0);

    test()->actingAs($ctx['finance'])
        ->getJson('/api/v1/trips/distance-review?grade=C')
        ->assertStatus(422);
});
