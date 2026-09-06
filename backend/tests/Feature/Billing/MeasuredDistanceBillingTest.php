<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\Http;
use Modules\Administration\Services\SettingsService;
use Modules\Billing\Models\Invoice;
use Modules\Billing\Models\RateCard;
use Modules\Billing\Services\RateCardService;
use Modules\Bookings\Models\OrderRequest;
use Modules\Drivers\Enums\LedgerEntryKind;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverLedgerEntry;
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
 * Phase 2 of `docs/measured-distance-plan.md` (ADR-0045 §§2, 3, 5): the fare
 * is priced from the resolver's figure, held trips do not bill until a person
 * clears them, the policy is the rate card version's, and a walk-in gets a
 * provisional fare at the kerb while the settled one waits for the resolver.
 *
 * The queue is synchronous under test, so a completed trip is resolved —
 * and, for a walk-in, settled — inside the completing call. OSRM is faked to
 * the 50 km fixture: a matched chunk of n pings is (n − 1) × 250 m, a route
 * between any two points is 50 km.
 */
function measuredBillingOsrm(): void
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

/**
 * The 50 km fixture with one mock-location ping in it: the trace is not
 * trusted, so the odometer stands in inside the road's corridor.
 */
function untrustedFiftyKmTrace(?int $tenantId, int $tripId): void
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
 * A corporate trip driven to Trip Completed with a chosen trace, odometer
 * span and completion payload.
 *
 * @param  array<string, mixed>  $completion
 */
function corporateTripWith(array $ctx, ?string $trace, int $odometerKm, array $completion = []): Trip
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
        untrustedFiftyKmTrace($ctx['tenant']->id, $trip->id);
    }

    return $machine->transition($trip, TripStatus::TRIP_COMPLETED, $ctx['dispatcher'], [
        'odometer_end' => 10_000 + $odometerKm,
        ...$completion,
    ])->fresh();
}

function invoiceRequest(User $finance, Trip $trip, string $key = 'measured-key-1')
{
    return test()->actingAs($finance)
        ->withHeader('Idempotency-Key', $key)
        ->postJson("/api/v1/trips/{$trip->id}/invoice");
}

// ---------------------------------------------------------------------------
// The policy is the rate card version's
// ---------------------------------------------------------------------------

it('accepts a distance policy on a rate card version and defaults it to the odometer', function () {
    $ctx = BillingFixtures::tenantWithRateCard();

    expect($ctx['version']->distance_policy->value)->toBe('odometer');

    $response = test()->actingAs($ctx['finance'])->postJson("/api/v1/rate-cards/{$ctx['card']->id}/versions", [
        'effective_from' => '2021-01-01',
        'distance_policy' => 'gps_primary',
        'rates' => [[
            'vehicle_category' => 'sedan',
            'base_fare_minor' => 5_000,
            'per_km_minor' => 500,
            'per_waiting_minute_minor' => 200,
            'minimum_charge_minor' => 0,
            'maximum_charge_minor' => null,
        ]],
    ])->assertCreated();

    expect($response->json('data.distance_policy'))->toBe('gps_primary');

    test()->actingAs($ctx['finance'])->postJson("/api/v1/rate-cards/{$ctx['card']->id}/versions", [
        'effective_from' => '2022-01-01',
        'distance_policy' => 'nonsense',
        'rates' => [['vehicle_category' => 'sedan', 'base_fare_minor' => 1, 'per_km_minor' => 1, 'per_waiting_minute_minor' => 0, 'minimum_charge_minor' => 0, 'maximum_charge_minor' => null]],
    ])->assertStatus(422);
});

// ---------------------------------------------------------------------------
// Corporate: the gate and the figure
// ---------------------------------------------------------------------------

it('still invoices an odometer-policy trip that has no trace at all — missing evidence is not a discrepancy', function () {
    $ctx = BillingFixtures::tenantWithRateCard();
    $trip = corporateTripWith($ctx, trace: null, odometerKm: 42);

    expect($trip->distance_grade)->toBe(DistanceGrade::UNVERIFIED);

    invoiceRequest($ctx['finance'], $trip)->assertCreated();
});

it('invoices from the resolver figure under gps_primary — the trace, not the odometer', function () {
    measuredBillingOsrm();
    $ctx = BillingFixtures::tenantWithRateCard(version: ['distance_policy' => 'gps_primary']);
    // Odometer says 60 km; the trusted trace and the road say 50.
    $trip = corporateTripWith($ctx, trace: 'trusted', odometerKm: 60);

    expect($trip->distance_grade)->toBe(DistanceGrade::VERIFIED)
        ->and((float) $trip->billed_distance_km)->toBe(50.0)
        ->and((float) $trip->distance_km)->toBe(60.0);

    $response = invoiceRequest($ctx['finance'], $trip)->assertCreated();

    $distanceLine = collect($response->json('data.lines'))->firstWhere('type', 'distance');
    expect((float) $distanceLine['quantity'])->toBe(50.0)
        // Base 5,000 + 50 km × 500.
        ->and($response->json('data.total_minor'))->toBe(30_000);
});

it('refuses to invoice an unresolved trip under gps_primary, and an unverified one', function () {
    $ctx = BillingFixtures::tenantWithRateCard(version: ['distance_policy' => 'gps_primary']);

    // Completed before the resolver existed: no resolution at all.
    BillingFixtures::bindTenant($ctx['tenant']);
    $unresolved = Trip::factory()->create([
        'tenant_id' => $ctx['tenant']->id,
        'vehicle_id' => $ctx['vehicle']->id,
        'driver_id' => $ctx['driver']->id,
        // The fleet whose driver ran it (ADR-0055 §6). `RecordsActingFleet`
        // fills this from the `AccessContext`, and `bindTenant` above binds a
        // **client** context — so a trip built this way carried no fleet, and
        // `InvoiceService` refused it with "names no fleet" before the 409
        // this test is actually about. Named explicitly rather than left to a
        // binding that means something else.
        'operator_id' => $ctx['driver']->operator_id,
        'status' => TripStatus::TRIP_COMPLETED,
        'odometer_start' => 100,
        'odometer_end' => 142,
        'distance_km' => '42.00',
        'started_at' => now()->subHour(),
        'completed_at' => now(),
    ]);

    invoiceRequest($ctx['finance'], $unresolved)
        ->assertStatus(409)
        ->assertJsonPath('code', 'TRIP_DISTANCE_UNRESOLVED');

    // Resolved, but nothing vouches for the odometer, on a contract that
    // asked to be billed on the trace: held.
    $unverified = corporateTripWith($ctx, trace: null, odometerKm: 42);
    expect($unverified->distance_grade)->toBe(DistanceGrade::UNVERIFIED);

    invoiceRequest($ctx['finance'], $unverified, 'measured-key-2')
        ->assertStatus(409)
        ->assertJsonPath('code', 'TRIP_DISTANCE_HELD');
});

it('holds a clamped odometer, lets finance clear it with a reason, then invoices the clamped figure', function () {
    measuredBillingOsrm();
    $ctx = BillingFixtures::tenantWithRateCard(version: ['distance_policy' => 'gps_primary']);
    // Untrusted trace (a mock ping), road 50 km, odometer 100 km: clamped
    // to the corridor ceiling of 62.5 km and held.
    $trip = corporateTripWith($ctx, trace: 'untrusted', odometerKm: 100);

    expect($trip->distance_grade)->toBe(DistanceGrade::HELD)
        ->and((float) $trip->billed_distance_km)->toBe(62.5);

    invoiceRequest($ctx['finance'], $trip)->assertStatus(409)->assertJsonPath('code', 'TRIP_DISTANCE_HELD');

    // A dispatcher may not clear; a reason is required and must say something.
    test()->actingAs($ctx['dispatcher'])->postJson("/api/v1/trips/{$trip->id}/distance/clearance", ['reason' => 'Driver explained the detour by phone'])->assertForbidden();
    test()->actingAs($ctx['finance'])->postJson("/api/v1/trips/{$trip->id}/distance/clearance", ['reason' => 'ok'])->assertStatus(422);

    $cleared = test()->actingAs($ctx['finance'])
        ->postJson("/api/v1/trips/{$trip->id}/distance/clearance", ['reason' => 'Driver explained the detour by phone; the client confirmed the extra stop.'])
        ->assertOk();

    expect($cleared->json('data.distance.held'))->toBeFalse()
        ->and($cleared->json('data.distance.grade'))->toBe('C')
        ->and($cleared->json('data.distance.cleared_reason'))->toContain('extra stop');

    // Idempotent: clearing again changes nothing and is not an error.
    test()->actingAs($ctx['finance'])->postJson("/api/v1/trips/{$trip->id}/distance/clearance", ['reason' => 'Second click, same reason as before.'])->assertOk();

    $response = invoiceRequest($ctx['finance'], $trip, 'measured-key-3')->assertCreated();
    expect((float) collect($response->json('data.lines'))->firstWhere('type', 'distance')['quantity'])->toBe(62.5);

    // The evidence row it overruled is untouched and still says C.
    $evidence = test()->actingAs($ctx['finance'])->getJson("/api/v1/trips/{$trip->id}/distance")->assertOk();
    expect($evidence->json('data.0.grade'))->toBe('C')
        ->and($evidence->json('data.0.route_km'))->toEqual(50)
        ->and($evidence->json('data.0.dropped.mock'))->toBe(1);
});

it('refuses to clear a trip that is not held', function () {
    $ctx = BillingFixtures::tenantWithRateCard();
    $trip = corporateTripWith($ctx, trace: null, odometerKm: 42); // U under odometer: bills, but is clearable? U is clearable; A is not

    measuredBillingOsrm();
    $verified = corporateTripWith($ctx, trace: 'trusted', odometerKm: 50);
    expect($verified->distance_grade)->toBe(DistanceGrade::VERIFIED);

    test()->actingAs($ctx['finance'])
        ->postJson("/api/v1/trips/{$verified->id}/distance/clearance", ['reason' => 'Nothing to clear here, really.'])
        ->assertStatus(409)
        ->assertJsonPath('code', 'TRIP_DISTANCE_NOT_HELD');
});

it('lets a held trip bill when the operator has switched the gate off', function () {
    measuredBillingOsrm();
    app(SettingsService::class)->setGroup('tracking', ['held_blocks_billing' => false]);
    $ctx = BillingFixtures::tenantWithRateCard(version: ['distance_policy' => 'gps_primary']);
    $trip = corporateTripWith($ctx, trace: 'untrusted', odometerKm: 100);

    expect($trip->distance_grade)->toBe(DistanceGrade::HELD);
    invoiceRequest($ctx['finance'], $trip)->assertCreated();
});

// ---------------------------------------------------------------------------
// Walk-in: the kerb, the settlement, the ledger
// ---------------------------------------------------------------------------

/**
 * A walk-in trip started with pins, an optional trace, and completed by its
 * driver with the given payload.
 *
 * @return array{trip: Trip, driver: User}
 */
function walkInTripCompleted(?string $trace, int $odometerKm, array $completion = []): array
{
    $customer = Customer::factory()->create();
    $driverUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $driverUser->id]);
    $trip = Trip::factory()
        ->forCustomer($customer)
        ->forVehicle(Vehicle::factory()->create(['category' => 'sedan', 'status' => 'active']))
        ->forDriver($driver)
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

    if ($trace === 'trusted') {
        GpsFixtures::straightLine(null, $trip->id, 201, 250);
    } elseif ($trace === 'untrusted') {
        untrustedFiftyKmTrace(null, $trip->id);
    }

    app(TenantContext::class)->set(null);
    app(TripStateMachine::class)->transition($trip, TripStatus::TRIP_COMPLETED, $driverUser, [
        'odometer_end' => 100 + $odometerKm,
        ...$completion,
    ]);

    return ['trip' => $trip->fresh(), 'driver' => $driverUser];
}

/** The public tariff, then a second version with the given policy. */
function publicTariffWithPolicy(string $policy): RateCard
{
    $card = BillingFixtures::publicTariff(['sedan' => [2_000, 1_500]]);
    $actor = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
    app(TenantContext::class)->set(null);

    $version = app(RateCardService::class)->addVersion($card, [
        'effective_from' => '2020-06-01',
        'distance_policy' => $policy,
        'rates' => [[
            'vehicle_category' => 'sedan',
            'base_fare_minor' => 2_000,
            'per_km_minor' => 1_500,
            'per_waiting_minute_minor' => 0,
            'minimum_charge_minor' => 0,
            'maximum_charge_minor' => null,
        ]],
    ], $actor);

    $version->forceFill(['tenant_id' => null])->save();
    $version->rates()->update(['tenant_id' => null]);

    return $card->refresh();
}

it('settles a walk-in exactly as before under the odometer policy, with the provisional fare equal to the settled one', function () {
    BillingFixtures::publicTariff(['sedan' => [2_000, 1_500]]);

    ['trip' => $trip, 'driver' => $driver] = walkInTripCompleted(trace: null, odometerKm: 10);

    // 2,000 + 10 × 1,500. Settled inside the completing call (sync queue).
    expect($trip->fare_minor)->toBe(17_000)
        ->and($trip->fare_provisional_minor)->toBe(17_000)
        ->and($trip->distance_grade)->toBe(DistanceGrade::UNVERIFIED);

    $resource = test()->actingAs($driver)->getJson("/api/v1/trips/{$trip->id}")->assertOk();
    expect($resource->json('data.fare.total_minor'))->toBe(17_000)
        // Equal to the settled fare, so it is not shown twice.
        ->and($resource->json('data.provisional_fare'))->toBeNull()
        ->and($resource->json('data.distance.grade'))->toBe('U')
        ->and($resource->json('data.distance.held'))->toBeFalse()
        ->and($resource->json('data.variance_threshold_percent'))->toEqual(10);

    // The ledger pair followed the settlement.
    expect(DriverLedgerEntry::query()->where('trip_id', $trip->id)->where('kind', LedgerEntryKind::CASH_COLLECTED)->value('amount_minor'))->toBe(-17_000);
});

it('prices a provisional fare at the kerb from the handset distance under gps_primary, then settles from the trace and records the cash actually taken', function () {
    measuredBillingOsrm();
    publicTariffWithPolicy('gps_primary');

    // The handset measured 48 km on its own buffer; the odometer says 60;
    // the trace and the road say 50.
    ['trip' => $trip, 'driver' => $driver] = walkInTripCompleted(trace: 'trusted', odometerKm: 60, completion: ['provisional_distance_km' => 48]);

    // Provisional: 2,000 + 48 × 1,500 = 74,000. Settled: 2,000 + 50 × 1,500 = 77,000.
    expect($trip->fare_provisional_minor)->toBe(74_000)
        ->and($trip->fare_minor)->toBe(77_000)
        ->and((float) $trip->provisional_distance_km)->toBe(48.0)
        ->and($trip->distance_grade)->toBe(DistanceGrade::VERIFIED)
        ->and((float) $trip->billed_distance_km)->toBe(50.0);

    $resource = test()->actingAs($driver)->getJson("/api/v1/trips/{$trip->id}")->assertOk();
    expect($resource->json('data.fare.total_minor'))->toBe(77_000)
        // Different from the settled fare, so it stays visible.
        ->and($resource->json('data.provisional_fare.total_minor'))->toBe(74_000)
        ->and($resource->json('data.provisional_fare.is_provisional'))->toBeTrue()
        ->and($resource->json('data.provisional_fare.distance_km'))->toEqual(48);

    // Cash collected is what was taken at the kerb; the driver's share is of
    // what the trip was worth.
    $entries = DriverLedgerEntry::query()->where('trip_id', $trip->id)->get()->keyBy(fn ($e) => $e->kind->value);
    expect($entries[LedgerEntryKind::CASH_COLLECTED->value]->amount_minor)->toBe(-74_000)
        // 20 % commission of 77,000 = 15,400; earned 61,600.
        ->and($entries[LedgerEntryKind::FARE_EARNED->value]->amount_minor)->toBe(61_600)
        ->and($entries[LedgerEntryKind::CASH_COLLECTED->value]->description)->toContain('provisional fare of 74000');
});

it('leaves a held walk-in unsettled — provisional fare on the handset — until finance clears it, then settles and credits', function () {
    measuredBillingOsrm();
    publicTariffWithPolicy('gps_primary');

    // Untrusted trace, road 50, odometer 100 → clamped to 62.5, held.
    ['trip' => $trip, 'driver' => $driver] = walkInTripCompleted(trace: 'untrusted', odometerKm: 100, completion: ['provisional_distance_km' => 55]);

    expect($trip->distance_grade)->toBe(DistanceGrade::HELD)
        ->and($trip->fare_minor)->toBeNull()
        ->and($trip->fare_provisional_minor)->toBe(2_000 + 55 * 1_500)
        ->and(DriverLedgerEntry::query()->where('trip_id', $trip->id)->exists())->toBeFalse();

    $resource = test()->actingAs($driver)->getJson("/api/v1/trips/{$trip->id}")->assertOk();
    expect($resource->json('data.fare'))->toBeNull()
        ->and($resource->json('data.provisional_fare.total_minor'))->toBe(84_500)
        ->and($resource->json('data.distance.held'))->toBeTrue();

    $finance = User::factory()->create(['tenant_id' => null, 'role' => UserRole::FINANCE]);
    test()->actingAs($finance)
        ->postJson("/api/v1/trips/{$trip->id}/distance/clearance", ['reason' => 'Reviewed the trace; the passenger asked for a long way round.'])
        ->assertOk();

    $trip->refresh();
    // Settled from the clamped figure: 2,000 + 62.5 × 1,500 = 95,750.
    expect($trip->fare_minor)->toBe(95_750)
        ->and(DriverLedgerEntry::query()->where('trip_id', $trip->id)->where('kind', LedgerEntryKind::CASH_COLLECTED)->value('amount_minor'))->toBe(-84_500);
});

it('does not restate a settled walk-in fare when late pings re-resolve the trip', function () {
    measuredBillingOsrm();
    publicTariffWithPolicy('gps_primary');
    ['trip' => $trip] = walkInTripCompleted(trace: 'trusted', odometerKm: 50);
    $settled = $trip->fare_minor;
    expect($settled)->toBe(77_000);

    // More pings land an hour later: a second evidence row, the same fare.
    GpsFixtures::straightLine(null, $trip->id, 41, 250, now()->subMinutes(20));
    $this->artisan('trips:replay-distance', ['trip' => $trip->id, '--commit' => true])->assertSuccessful();

    expect($trip->fresh()->fare_minor)->toBe($settled)
        ->and(Invoice::query()->count())->toBe(0);
});
