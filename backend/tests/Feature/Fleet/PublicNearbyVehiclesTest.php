<?php

use App\Models\Tenant;
use Carbon\CarbonImmutable;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Support\DriverPresence;
use Modules\Fleet\Support\DriverPresenceStore;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * `GET /public/nearby-vehicles` — the real fleet behind the order page's
 * ambient vehicles and the client live map's capacity view.
 *
 * What matters: it is reachable with no account and answers only positions
 * and silhouettes — nothing that joins back to a driver; it never shows a
 * vehicle a customer could not actually hail (off duty, stale, mid-trip);
 * and it is bounded by radius and count so it cannot dump the fleet.
 */

/** Kampala city centre, the reference point every distance here is from. */
const NEAR = ['latitude' => 0.3476, 'longitude' => 32.5825];

function nearbyStore(): DriverPresenceStore
{
    return app(DriverPresenceStore::class);
}

/** Puts a driver on duty with a fresh position `eastKm` east of NEAR. */
function availableDriver(float $eastKm = 1.0, ?Vehicle $vehicle = null, int $ageSeconds = 15): Driver
{
    $driver = Driver::factory()->create(['vehicle_id' => $vehicle?->id]);

    nearbyStore()->setDuty($driver->id, true, $vehicle?->id);
    nearbyStore()->heartbeat(new DriverPresence(
        driverId: $driver->id,
        onDuty: true,
        vehicleId: $vehicle?->id,
        latitude: NEAR['latitude'],
        longitude: NEAR['longitude'] + $eastKm / 111.32,
        accuracyMetres: 10.0,
        recordedAt: CarbonImmutable::now()->subSeconds($ageSeconds),
    ));

    return $driver;
}

it('answers with no account at all', function () {
    availableDriver();

    $this->getJson('/api/v1/public/nearby-vehicles?latitude=0.3476&longitude=32.5825')
        ->assertOk()
        ->assertJsonCount(1, 'data');
});

it('serves a position and a silhouette, and not one field more', function () {
    $vehicle = Vehicle::factory()->create(['category' => 'boda']);
    availableDriver(1.0, $vehicle);

    $row = $this->getJson('/api/v1/public/nearby-vehicles?latitude=0.3476&longitude=32.5825')
        ->assertOk()->json('data.0');

    // The allow-list IS the privacy design: no driver id, name, plate,
    // phone — nothing that joins back to the register (security-gate F2).
    expect(array_keys($row))->toBe(['key', 'category', 'kind', 'latitude', 'longitude', 'age_seconds']);
    expect($row['category'])->toBe('boda');
    expect($row['kind'])->toBe('boda');
    expect($row['age_seconds'])->toBeGreaterThanOrEqual(15);
});

it('never serves the driver id as the key, and keeps the key stable across a poll', function () {
    $driver = availableDriver();

    $first = $this->getJson('/api/v1/public/nearby-vehicles?latitude=0.3476&longitude=32.5825')->json('data.0.key');
    $second = $this->getJson('/api/v1/public/nearby-vehicles?latitude=0.3476&longitude=32.5825')->json('data.0.key');

    // Stable within the hour so markers glide instead of blinking...
    expect($first)->toBe($second);
    // ...and opaque, so nothing about the driver rides in it.
    expect($first)->not->toBe((string) $driver->id);
    expect($first)->toHaveLength(12);
});

it('rotates the key across hours, so a day of polling follows nobody', function () {
    $driver = availableDriver();

    $now = $this->getJson('/api/v1/public/nearby-vehicles?latitude=0.3476&longitude=32.5825')->json('data.0.key');

    $this->travel(1)->hours();

    // A fresh heartbeat after the hour, so the driver is still served and
    // the comparison below is key-against-key. Without this the presence
    // goes stale, the list comes back empty, and `null !== key` would pass
    // for a key that never rotates — a test that cannot fail.
    nearbyStore()->heartbeat(new DriverPresence(
        driverId: $driver->id,
        onDuty: true,
        vehicleId: null,
        latitude: NEAR['latitude'],
        longitude: NEAR['longitude'] + 1.0 / 111.32,
        accuracyMetres: 10.0,
        recordedAt: CarbonImmutable::now(),
    ));

    $later = $this->getJson('/api/v1/public/nearby-vehicles?latitude=0.3476&longitude=32.5825')->json('data.0.key');

    expect($now)->not->toBeNull();
    expect($later)->not->toBeNull();
    expect($later)->not->toBe($now);
});

it('leaves out a driver who is off duty, stale, or has never reported', function () {
    availableDriver(); // the one that should remain

    $offDuty = availableDriver(2.0);
    nearbyStore()->setDuty($offDuty->id, false);

    availableDriver(3.0, null, (int) config('dispatch.presence_ttl_seconds') + 300); // stale

    $silent = Driver::factory()->create();
    nearbyStore()->setDuty($silent->id, true); // on duty, no position ever

    $this->getJson('/api/v1/public/nearby-vehicles?latitude=0.3476&longitude=32.5825')
        ->assertOk()
        ->assertJsonCount(1, 'data');
});

it('leaves out a driver who is mid-trip — their car is not capacity', function () {
    $free = availableDriver(1.0, Vehicle::factory()->create(['category' => 'sedan']));
    $busy = availableDriver(0.5, Vehicle::factory()->create(['category' => 'sedan']));

    Trip::factory()
        ->forTenant(Tenant::factory()->create())
        ->forVehicle(Vehicle::factory()->create())
        ->forDriver($busy)
        ->create(['status' => 'passenger_onboard']);

    // A finished trip does not make a driver busy.
    Trip::factory()
        ->forTenant(Tenant::factory()->create())
        ->forVehicle(Vehicle::factory()->create())
        ->forDriver($free)
        ->create(['status' => 'trip_completed']);

    $rows = $this->getJson('/api/v1/public/nearby-vehicles?latitude=0.3476&longitude=32.5825')
        ->assertOk()->json('data');

    expect($rows)->toHaveCount(1);

    // The nearer of the two was the busy one — proof the exclusion is by
    // trip, not by distance.
    expect($rows[0]['longitude'])->toEqualWithDelta(NEAR['longitude'] + 1.0 / 111.32, 0.0001);
});

it('bounds the answer by distance, nearest first', function () {
    availableDriver(5.0);
    availableDriver(1.0);
    availableDriver(30.0); // beyond any "nearby"

    $rows = $this->getJson('/api/v1/public/nearby-vehicles?latitude=0.3476&longitude=32.5825')
        ->assertOk()->json('data');

    expect($rows)->toHaveCount(2);
    expect($rows[0]['longitude'])->toBeLessThan($rows[1]['longitude']);
});

it('caps how many it names, so the response can never be a fleet dump', function () {
    foreach (range(1, 14) as $i) {
        availableDriver($i * 0.2);
    }

    $this->getJson('/api/v1/public/nearby-vehicles?latitude=0.3476&longitude=32.5825')
        ->assertOk()
        ->assertJsonCount(12, 'data');
});

it('refuses a request that names no point to be near', function () {
    $this->getJson('/api/v1/public/nearby-vehicles')
        ->assertUnprocessable();

    $this->getJson('/api/v1/public/nearby-vehicles?latitude=91&longitude=32.5')
        ->assertUnprocessable();
});

it('answers an empty list, not an error, when nobody is out there', function () {
    $this->getJson('/api/v1/public/nearby-vehicles?latitude=0.3476&longitude=32.5825')
        ->assertOk()
        ->assertJsonCount(0, 'data');
});
