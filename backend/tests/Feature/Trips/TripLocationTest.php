<?php

use App\Enums\UserRole;
use App\Exceptions\TripEventImmutableException;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripLocation;
use Modules\Trips\Services\RouteDistanceCalculator;
use Modules\Vehicles\Models\Vehicle;
use Tests\Support\GpsFixtures;

/**
 * ADR-0003 ingestion and the route it produces.
 *
 * Distances are asserted against arithmetic, not against whatever the
 * calculator returns: GpsFixtures lays points a known number of metres
 * apart along a line of latitude, so "10 points 100 m apart is 0.9 km" is
 * something a person can check, and a broken Haversine cannot agree with it
 * by construction.
 */

/**
 * @return array<string, mixed>
 */
function gpsFixture(): array
{
    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $driverUser = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->forUser($driverUser)->create();
    $dispatcher = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DISPATCHER]);
    $finance = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::FINANCE]);
    $vehicle = Vehicle::factory()->create();

    $trip = Trip::factory()->forTenant($tenant)->forVehicle($vehicle)->forDriver($driver)->create();

    return compact('tenant', 'driverUser', 'driver', 'dispatcher', 'finance', 'vehicle', 'trip');
}

it('accepts a batch of pings with 202 and writes them through the queue', function () {
    ['driverUser' => $driverUser, 'trip' => $trip] = gpsFixture();

    $response = $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/locations", [
            'pings' => [
                ['latitude' => 0.3152, 'longitude' => 32.5816, 'recorded_at' => now()->subMinutes(2)->toIso8601String()],
                ['latitude' => 0.3153, 'longitude' => 32.5820, 'recorded_at' => now()->subMinute()->toIso8601String(), 'speed_kph' => 42.5],
            ],
        ]);

    // 202, not 201: validated and buffered, not yet written. QUEUE_CONNECTION
    // is sync under phpunit.xml, so the rows exist by the time we assert.
    $response->assertStatus(202)->assertJsonPath('data.accepted', 2);

    expect(TripLocation::where('trip_id', $trip->id)->count())->toBe(2);
});

it('rejects malformed pings before anything is queued', function () {
    ['driverUser' => $driverUser, 'trip' => $trip] = gpsFixture();

    // Latitude beyond the poles — the shape of a swapped lat/lng pair.
    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/locations", [
            'pings' => [['latitude' => 132.58, 'longitude' => 0.3152, 'recorded_at' => now()->toIso8601String()]],
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('pings.0.latitude');

    // A device with a wrong clock, reporting from next week.
    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/locations", [
            'pings' => [['latitude' => 0.3152, 'longitude' => 32.5816, 'recorded_at' => now()->addWeek()->toIso8601String()]],
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('pings.0.recorded_at');

    expect(TripLocation::where('trip_id', $trip->id)->count())->toBe(0);
});

it('caps how many pings one request may carry', function () {
    ['driverUser' => $driverUser, 'trip' => $trip] = gpsFixture();

    $tooMany = array_fill(0, (int) config('tracking.max_pings_per_request') + 1, [
        'latitude' => 0.3152, 'longitude' => 32.5816, 'recorded_at' => now()->toIso8601String(),
    ]);

    $this->actingAs($driverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/locations", ['pings' => $tooMany])
        ->assertStatus(422)
        ->assertJsonValidationErrors('pings');
});

it('measures route distance from the trace', function () {
    ['tenant' => $tenant, 'trip' => $trip] = gpsFixture();

    // 11 points, 100 m apart = 1.0 km.
    $expected = GpsFixtures::straightLine($tenant->id, $trip->id, 11, 100.0);
    expect($expected)->toBe(1.0);

    expect(app(RouteDistanceCalculator::class)->kilometresFor($trip->id))->toBe(1.0);
});

it('reports no distance rather than zero when there is no trace', function () {
    ['trip' => $trip] = gpsFixture();

    // Null and 0.0 are different claims: "no GPS evidence" versus "the
    // vehicle did not move". Reconciliation treats them differently, so the
    // calculator must too.
    expect(app(RouteDistanceCalculator::class)->kilometresFor($trip->id))->toBeNull();

    TripLocation::factory()->forTrip($trip->tenant_id, $trip->id)->create();
    expect(app(RouteDistanceCalculator::class)->kilometresFor($trip->id))->toBeNull();
});

it('ignores receiver jitter from a stationary vehicle', function () {
    ['tenant' => $tenant, 'trip' => $trip] = gpsFixture();

    // 120 pings — 20 minutes at ADR-0003's 10-second cadence — wandering
    // 3 m either side of one spot. Summed naively that is ~360 m of
    // distance the vehicle never travelled, on the figure used to check a
    // driver's odometer reading.
    GpsFixtures::stationaryJitter($tenant->id, $trip->id, 120, 3.0);

    expect(app(RouteDistanceCalculator::class)->kilometresFor($trip->id))->toBe(0.0);
});

it('serves the route for replay, newest cursor and measured distance', function () {
    ['tenant' => $tenant, 'trip' => $trip, 'dispatcher' => $dispatcher] = gpsFixture();

    GpsFixtures::straightLine($tenant->id, $trip->id, 6, 250.0);

    $this->actingAs($dispatcher, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/locations")
        ->assertOk()
        ->assertJsonCount(6, 'data')
        ->assertJsonPath('meta.gps_distance_km', 1.25)
        ->assertJsonStructure(['meta' => ['cursor' => ['next']]])
        // Coordinates cross the wire as numbers, for a map library.
        ->assertJsonPath('data.0.latitude', GpsFixtures::START_LAT);
});

it('rejects an unknown query parameter on the route endpoint', function () {
    ['trip' => $trip, 'dispatcher' => $dispatcher] = gpsFixture();

    $this->actingAs($dispatcher, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/locations?trip_id=99")
        ->assertStatus(422)
        ->assertJsonValidationErrors('trip_id');
});

it('lets only the trip\'s own driver and dispatch roles record locations', function () {
    ['trip' => $trip, 'dispatcher' => $dispatcher, 'finance' => $finance, 'tenant' => $tenant] = gpsFixture();

    $ping = ['pings' => [['latitude' => 0.3152, 'longitude' => 32.5816, 'recorded_at' => now()->toIso8601String()]]];

    // Finance is billed off this trace, so Finance must not be able to
    // write it.
    $this->actingAs($finance, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/locations", $ping)
        ->assertForbidden();

    // Another tenant's driver, on their own trip, must not reach this one.
    $otherDriverUser = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DRIVER]);
    Driver::factory()->forUser($otherDriverUser)->create();

    $this->actingAs($otherDriverUser, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/locations", $ping)
        ->assertForbidden();

    $this->actingAs($dispatcher, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/locations", $ping)
        ->assertStatus(202);
});

it('refuses to update or delete a recorded ping', function () {
    ['trip' => $trip] = gpsFixture();

    $ping = TripLocation::factory()->forTrip($trip->tenant_id, $trip->id)->create();

    // The route is evidence for a billed distance and for whether a
    // driver's odometer reading is trustworthy. A trace that can be edited
    // afterwards settles neither argument.
    expect(fn () => $ping->update(['latitude' => '1.0000000']))
        ->toThrow(TripEventImmutableException::class);
    expect(fn () => $ping->delete())
        ->toThrow(TripEventImmutableException::class);
});

it('writes each ping into the partition for the month it was recorded in', function () {
    ['tenant' => $tenant, 'trip' => $trip] = gpsFixture();

    // `recorded_at` is the device's clock, so a ping synced late still
    // belongs to — and must be stored in — the month it happened.
    GpsFixtures::straightLine($tenant->id, $trip->id, 3, 100.0, now()->startOfMonth()->addDays(2));

    $partition = DB::selectOne(
        'SELECT PARTITION_NAME AS name FROM information_schema.PARTITIONS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND PARTITION_NAME = ?',
        ['trip_locations', 'p'.now()->format('Ym')],
    );

    expect($partition)->not->toBeNull('the current month should have its own partition');

    // Partition pruning is the point: a query for this month must not have
    // to consider any other month's rows.
    $rows = DB::select('SELECT COUNT(*) AS c FROM trip_locations PARTITION (`p'.now()->format('Ym').'`)');
    expect((int) $rows[0]->c)->toBe(3);
});
