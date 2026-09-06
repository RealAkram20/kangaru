<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Models\Trip;
use Modules\Trips\Services\TripRouteRecorder;
use Modules\Trips\Support\LivePosition;
use Modules\Trips\Support\LivePositionStore;
use Modules\Vehicles\Models\Vehicle;

/**
 * ADR-0019 — where the fleet is right now.
 *
 * `Modules/Trips/README.md` recorded it plainly: "There is no live map."
 * Answering "where is UAA 123B" meant an index dive into `trip_locations`,
 * the table expected to reach ~500M rows a year, repeated per vehicle every
 * few seconds.
 *
 * The cases that matter are the snapshot staying newest-wins when a device
 * replays its backlog, the history surviving a live-store failure, and
 * visibility matching the trips listing exactly — a client watching another
 * client's van move is the worst-shaped bug this platform can have.
 */
function ping(string $recordedAt, float $lat, float $lng): array
{
    return [
        'latitude' => $lat,
        'longitude' => $lng,
        'recorded_at' => $recordedAt,
        'speed_kph' => 42.5,
        'heading_degrees' => 90,
    ];
}

function livePositions(): LivePositionStore
{
    return app(LivePositionStore::class);
}

function movingTrip(Tenant $tenant, ?Driver $driver = null): Trip
{
    return Trip::factory()
        ->forTenant($tenant)
        ->forVehicle(Vehicle::factory()->create())
        ->forDriver($driver ?? Driver::factory()->create())
        ->create(['status' => 'trip_started']);
}

// ── The snapshot itself ──────────────────────────────────────────────────

it('records the newest ping in a batch as the current position', function () {
    $tenant = Tenant::factory()->create();
    $trip = movingTrip($tenant);

    app(TripRouteRecorder::class)->record($tenant->id, $trip->id, [
        ping('2026-09-01 08:00:00', 0.3100, 32.5800),
        ping('2026-09-01 08:00:30', 0.3200, 32.5900),
        ping('2026-09-01 08:00:10', 0.3150, 32.5850),
    ]);

    $position = livePositions()->get($trip->vehicle_id);

    // The batch is not ordered; the newest timestamp wins, not the last
    // element.
    expect($position)->not->toBeNull();
    expect($position->latitude)->toBe(0.32);
    expect($position->recordedAt->toDateTimeString())->toBe('2026-09-01 08:00:30');
    expect($position->tripId)->toBe($trip->id);
});

it('does not let a device replaying its backlog drag the marker backwards', function () {
    $tenant = Tenant::factory()->create();
    $trip = movingTrip($tenant);
    $recorder = app(TripRouteRecorder::class);

    $recorder->record($tenant->id, $trip->id, [ping('2026-09-01 09:00:00', 0.4000, 32.7000)]);

    // A device out of signal sends its backlog oldest-first, long after the
    // pings it missed. An unguarded upsert would move the vehicle back
    // through a route it has already driven.
    $recorder->record($tenant->id, $trip->id, [
        ping('2026-09-01 08:00:00', 0.3100, 32.5800),
        ping('2026-09-01 08:30:00', 0.3500, 32.6000),
    ]);

    $position = livePositions()->get($trip->vehicle_id);

    expect($position->recordedAt->toDateTimeString())->toBe('2026-09-01 09:00:00');
    expect($position->latitude)->toBe(0.4);
});

it('keeps the route even when the live store fails, because the route is the evidence', function () {
    $tenant = Tenant::factory()->create();
    $trip = movingTrip($tenant);

    // The route backs billed distance and the odometer reconciliation. A
    // live-map dependency that can fail a ping batch would, through the
    // job's retry, duplicate a stretch of it into the table billing reads.
    $this->app->bind(LivePositionStore::class, fn () => new class implements LivePositionStore
    {
        public function put(array $positions): void
        {
            throw new RuntimeException('redis is down');
        }

        public function get(int $vehicleId): ?LivePosition
        {
            return null;
        }

        public function all(array $vehicleIds = []): Collection
        {
            return collect();
        }

        public function forget(int $vehicleId): void {}
    });

    app(TripRouteRecorder::class)->record($tenant->id, $trip->id, [
        ping('2026-09-01 08:00:00', 0.3100, 32.5800),
        ping('2026-09-01 08:00:10', 0.3150, 32.5850),
    ]);

    expect(DB::table('trip_locations')->where('trip_id', $trip->id)->count())->toBe(2);
});

it('reports how stale a position is, which is what a still marker cannot say', function () {
    $tenant = Tenant::factory()->create();
    $trip = movingTrip($tenant);

    livePositions()->put([new LivePosition(
        vehicleId: $trip->vehicle_id,
        tenantId: $tenant->id,
        tripId: $trip->id,
        driverId: $trip->driver_id,
        latitude: 0.31,
        longitude: 32.58,
        speedKph: null,
        headingDegrees: null,
        recordedAt: CarbonImmutable::now()->subMinutes(5),
    )]);

    $row = $this->actingAs(platformDispatcher(), 'sanctum')
        ->getJson('/api/v1/live-positions')->assertOk()->json('data.0');

    // A marker sitting still is ambiguous until you know whether it is a
    // parked vehicle or a dead phone.
    expect($row['age_seconds'])->toBeGreaterThanOrEqual(290);
    expect($row['stale'])->toBeTrue();
});

// ── Visibility ───────────────────────────────────────────────────────────

function platformDispatcher(): User
{
    return User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);
}

it('requires a signed-in caller', function () {
    $this->getJson('/api/v1/live-positions')->assertUnauthorized();
});

it('shows a client only their own vehicles', function () {
    $mine = Tenant::factory()->create();
    $theirs = Tenant::factory()->create();

    $myTrip = movingTrip($mine);
    $theirTrip = movingTrip($theirs);

    $recorder = app(TripRouteRecorder::class);
    $recorder->record($mine->id, $myTrip->id, [ping('2026-09-01 08:00:00', 0.31, 32.58)]);
    $recorder->record($theirs->id, $theirTrip->id, [ping('2026-09-01 08:00:00', 0.40, 32.70)]);

    $admin = User::factory()->create(['tenant_id' => $mine->id, 'role' => UserRole::CORPORATE_ADMIN]);

    $rows = $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/live-positions')->assertOk()->json('data');

    // A client watching another client's van move across a map is the
    // worst-shaped bug this platform can have (ADR-0001).
    expect(collect($rows)->pluck('vehicle_id'))->toContain($myTrip->vehicle_id);
    expect(collect($rows)->pluck('vehicle_id'))->not->toContain($theirTrip->vehicle_id);
});

it('shows a driver only the trip they are on', function () {
    $tenant = Tenant::factory()->create();
    $account = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->forUser($account)->create();

    $mine = movingTrip($tenant, $driver);
    $someoneElses = movingTrip($tenant);

    $recorder = app(TripRouteRecorder::class);
    $recorder->record($tenant->id, $mine->id, [ping('2026-09-01 08:00:00', 0.31, 32.58)]);
    $recorder->record($tenant->id, $someoneElses->id, [ping('2026-09-01 08:00:00', 0.40, 32.70)]);

    $rows = $this->actingAs($account, 'sanctum')
        ->getJson('/api/v1/live-positions')->assertOk()->json('data');

    expect($rows)->toHaveCount(1);
    expect($rows[0]['trip_id'])->toBe($mine->id);
});

it('leaves out a vehicle whose trip has finished', function () {
    $tenant = Tenant::factory()->create();
    $trip = movingTrip($tenant);

    app(TripRouteRecorder::class)->record($tenant->id, $trip->id, [ping('2026-09-01 08:00:00', 0.31, 32.58)]);

    // The row survives the trip, deliberately — but a marker for a van
    // sitting in the yard would have a dispatcher routing work to it.
    $trip->update(['status' => 'trip_completed']);

    $this->actingAs(platformDispatcher(), 'sanctum')
        ->getJson('/api/v1/live-positions')
        ->assertOk()
        ->assertJsonCount(0, 'data');
});

it('lets a platform dispatcher see every client, and narrow to one', function () {
    $a = Tenant::factory()->create();
    $b = Tenant::factory()->create();
    $tripA = movingTrip($a);
    $tripB = movingTrip($b);

    $recorder = app(TripRouteRecorder::class);
    $recorder->record($a->id, $tripA->id, [ping('2026-09-01 08:00:00', 0.31, 32.58)]);
    $recorder->record($b->id, $tripB->id, [ping('2026-09-01 08:00:00', 0.40, 32.70)]);

    $dispatcher = platformDispatcher();

    $all = $this->actingAs($dispatcher, 'sanctum')
        ->getJson('/api/v1/live-positions')->assertOk()->json('data');
    expect($all)->toHaveCount(2);

    $narrowed = $this->actingAs($dispatcher, 'sanctum')
        ->getJson('/api/v1/live-positions?tenant_id='.$a->id)->assertOk()->json('data');
    expect($narrowed)->toHaveCount(1);
    expect($narrowed[0]['vehicle_id'])->toBe($tripA->vehicle_id);
});

it('says nothing is moving rather than failing when the fleet is idle', function () {
    $this->actingAs(platformDispatcher(), 'sanctum')
        ->getJson('/api/v1/live-positions')
        ->assertOk()
        ->assertJsonPath('message', 'Nothing is moving.')
        ->assertJsonCount(0, 'data');
});

// ── Names on the markers (the live map made real, 2026-08-20) ───────────

it('names the vehicle, the driver, the trip and the client beside each position', function () {
    $tenant = Tenant::factory()->create(['name' => 'Centenary Bank']);
    $driver = Driver::factory()->create(['name' => 'Grace Nakato']);
    $trip = Trip::factory()
        ->forTenant($tenant)
        ->forVehicle(Vehicle::factory()->create(['registration_number' => 'UBK 421H', 'make' => 'Toyota', 'model' => 'Noah', 'category' => 'van']))
        ->forDriver($driver)
        ->create(['status' => 'driver_en_route', 'origin' => 'Kampala Road', 'destination' => 'Entebbe Airport']);

    app(TripRouteRecorder::class)->record($tenant->id, $trip->id, [ping('2026-09-01 08:00:00', 0.31, 32.58)]);

    $row = $this->actingAs(platformDispatcher(), 'sanctum')
        ->getJson('/api/v1/live-positions')->assertOk()->json('data.0');

    expect($row['vehicle'])->toBe(['id' => $trip->vehicle_id, 'registration_number' => 'UBK 421H', 'make' => 'Toyota', 'model' => 'Noah', 'category' => 'van']);
    expect($row['driver'])->toBe(['id' => $driver->id, 'name' => 'Grace Nakato']);
    expect($row['trip'])->toBe([
        'id' => $trip->id,
        'status' => 'driver_en_route',
        'origin' => 'Kampala Road',
        'destination' => 'Entebbe Airport',
        'client' => ['id' => $tenant->id, 'name' => 'Centenary Bank'],
    ]);

    // The flat ids every existing reader uses are still there, unchanged.
    expect($row['vehicle_id'])->toBe($trip->vehicle_id);
    expect($row['trip_id'])->toBe($trip->id);
});

it('allow-lists what it says about a vehicle and a driver', function () {
    $tenant = Tenant::factory()->create();
    $trip = movingTrip($tenant);
    app(TripRouteRecorder::class)->record($tenant->id, $trip->id, [ping('2026-09-01 08:00:00', 0.31, 32.58)]);

    $row = $this->actingAs(platformDispatcher(), 'sanctum')
        ->getJson('/api/v1/live-positions')->assertOk()->json('data.0');

    // A map needs a plate and a name. A VIN, a licence number and a phone
    // number are what the fleet register is for, behind its own policy.
    expect(array_keys($row['vehicle']))->toBe(['id', 'registration_number', 'make', 'model', 'category']);
    expect(array_keys($row['driver']))->toBe(['id', 'name']);
    expect($row['trip'])->not->toHaveKeys(['passenger_name', 'passenger_phone', 'details']);
});

it('tells the page whether the list spans clients, and which it may narrow to', function () {
    $tenant = Tenant::factory()->create(['name' => 'Centenary Bank']);

    $platform = $this->actingAs(platformDispatcher(), 'sanctum')
        ->getJson('/api/v1/live-positions')->assertOk()->json('meta');
    expect($platform['scope'])->toBe('platform');
    expect(collect($platform['filters']['clients'])->pluck('label'))->toContain('Centenary Bank');

    $admin = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_ADMIN]);
    $client = $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/live-positions')->assertOk()->json('meta');
    expect($client['scope'])->toBe('tenant');
    expect($client['filters']['clients'])->toBe([]);
});
