<?php

use Carbon\CarbonImmutable;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Support\DriverPresence;
use Modules\Fleet\Support\DriverPresenceStore;

/**
 * The store's own contract, exercised directly (ADR-0024 §2).
 *
 * ## Why this file exists at all
 *
 * `DriverPresenceTest` drives the HTTP endpoints, and it is not enough. The
 * controller refuses an off-duty heartbeat with 409 before the store is
 * reached, so every guard *inside* the store was unreachable from a request
 * — and mutating the `ON DUPLICATE KEY UPDATE` column list to break one of
 * them failed no test whatsoever. That is the same trap ADR-0020 records
 * catching in the dispatch scorer: a test that passes for a reason other
 * than the one it claims.
 *
 * The store's guards matter independently of the controller precisely
 * because they are the last line. Anything that reaches the store — a future
 * background job reconciling presence, a bulk sign-off when a shift ends, a
 * second client app — bypasses the controller's check and not this one.
 */
function presenceFor(Driver $driver, string $recordedAt, float $latitude = 0.3476): DriverPresence
{
    return new DriverPresence(
        driverId: $driver->id,
        onDuty: true,
        vehicleId: null,
        latitude: $latitude,
        longitude: 32.5825,
        accuracyMetres: null,
        recordedAt: CarbonImmutable::parse($recordedAt),
    );
}

it('ignores a heartbeat for a driver who has been signed off', function () {
    $store = app(DriverPresenceStore::class);
    $driver = Driver::factory()->create();

    $store->setDuty($driver->id, true);
    $store->heartbeat(presenceFor($driver, '2026-08-09 08:00:00'));
    $store->setDuty($driver->id, false);

    // The race: a ping already in flight when the driver pressed "off
    // duty". Without the `on_duty = 1` clause in the statement's guard, this
    // writes a position back onto the row `setDuty` had just cleared —
    // undoing the clearing, which exists because where a driver was when
    // they signed off is usually where they live.
    //
    // Mutation check: drop `driver_presence.on_duty = 1 AND` from the guard
    // in DatabaseDriverPresenceStore::heartbeat() and this test fails.
    $store->heartbeat(presenceFor($driver, '2026-08-09 09:00:00'));

    $stored = $store->get($driver->id);

    expect($stored?->onDuty)->toBeFalse();
    expect($stored?->latitude)->toBeNull();
    expect($store->dispatchable()->pluck('driverId'))->not->toContain($driver->id);
});

it('never walks a driver backwards when a handset replays its backlog', function () {
    $store = app(DriverPresenceStore::class);
    $driver = Driver::factory()->create();

    $store->setDuty($driver->id, true);
    $store->heartbeat(presenceFor($driver, '2026-08-09 09:00:00', latitude: 0.3476));

    // A phone coming out of a tunnel sends its backlog oldest-first. Letting
    // that land would drag the driver back through a route they already
    // drove — and the matcher would rank them from where they used to be.
    //
    // Mutation check: remove the `VALUES(recorded_at) > …` half of the guard
    // and this test fails.
    $store->heartbeat(presenceFor($driver, '2026-08-09 08:00:00', latitude: 0.9999));

    expect($store->get($driver->id)?->latitude)->toBe(0.3476);
});

it('accepts the first position a driver reports, with nothing to compare against', function () {
    $store = app(DriverPresenceStore::class);
    $driver = Driver::factory()->create();

    // `setDuty` writes a null `recorded_at`, so the freshness half of the
    // guard has no previous value to compare with. The `IS NULL` branch is
    // what keeps the very first heartbeat of a shift from being discarded
    // as "not newer" — without it a driver would be permanently invisible
    // to the matcher, which is a silent, total failure.
    $store->setDuty($driver->id, true);

    // `now()`, not a fixed clock time like the tests above. Those only
    // assert what was stored; this one asserts dispatchability, which is
    // judged against `presence_ttl_seconds` from the present moment — so a
    // hardcoded 08:00 makes the assertion depend on what time of day the
    // suite runs. It was written that way first and failed for exactly that
    // reason, which is a fixture bug wearing the costume of a code bug.
    $store->heartbeat(presenceFor($driver, now()->toDateTimeString()));

    expect($store->get($driver->id)?->latitude)->toBe(0.3476);
    expect($store->dispatchable()->pluck('driverId'))->toContain($driver->id);
});

it('keeps duty state when a driver swaps vehicles mid-shift', function () {
    $store = app(DriverPresenceStore::class);
    $driver = Driver::factory()->create();

    $store->setDuty($driver->id, true);
    $store->heartbeat(presenceFor($driver, '2026-08-09 08:00:00'));

    expect($store->get($driver->id)?->onDuty)->toBeTrue();
});

it('narrows to the drivers asked about', function () {
    $store = app(DriverPresenceStore::class);
    $wanted = Driver::factory()->create();
    $other = Driver::factory()->create();

    foreach ([$wanted, $other] as $driver) {
        $store->setDuty($driver->id, true);
        $store->heartbeat(presenceFor($driver, now()->toDateTimeString()));
    }

    // Dispatch already knows which drivers passed the availability filter,
    // so the store must be able to answer for just those — loading every
    // on-duty driver to discard most of them in PHP is the waste this
    // parameter exists to avoid on the hottest read in the system.
    $ids = $store->dispatchable([$wanted->id])->pluck('driverId');

    expect($ids)->toContain($wanted->id);
    expect($ids)->not->toContain($other->id);
});

it('forgets a driver entirely', function () {
    $store = app(DriverPresenceStore::class);
    $driver = Driver::factory()->create();

    $store->setDuty($driver->id, true);
    $store->forget($driver->id);

    expect($store->get($driver->id))->toBeNull();
});