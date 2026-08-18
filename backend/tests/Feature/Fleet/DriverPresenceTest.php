<?php

use App\Enums\UserRole;
use App\Models\User;
use App\Support\Auth\ClientScope;
use Illuminate\Support\Carbon;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Enums\AvailabilityKind;
use Modules\Fleet\Enums\AvailabilityResource;
use Modules\Fleet\Enums\AvailabilityStatus;
use Modules\Fleet\Models\AvailabilityBlock;
use Modules\Fleet\Support\DriverPresenceStore;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * ADR-0024 §2 — the input automatic dispatch was missing.
 *
 * Before this, `DispatchRecommender` ranked by `live_positions`, whose only
 * writer is the trip GPS pipeline; a driver waiting at a stage reported
 * nothing at all. These tests cover the three things that make presence
 * trustworthy rather than merely present: duty is an explicit act,
 * availability still decides, and staleness removes a driver instead of
 * freezing them at a place they have left.
 */
function signedInDriver(array $attributes = []): array
{
    $user = User::factory()->create([
        'tenant_id' => null,
        'role' => UserRole::DRIVER,
        ...$attributes,
    ]);

    $driver = Driver::factory()->create(['user_id' => $user->id]);

    return [$user, $driver];
}

it('starts every driver off duty, without a stored record', function () {
    [$user] = signedInDriver();

    $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/duty')
        ->assertOk()
        // A synthesised off-duty answer rather than a 404 or an empty body:
        // a client forced to read "nothing" as "off duty" is a client that
        // will eventually read "request failed" as "off duty" too.
        ->assertJsonPath('data.on_duty', false)
        ->assertJsonPath('data.dispatchable', false);
});

it('puts a driver on duty with the vehicle they hold the keys to', function () {
    [$user, $driver] = signedInDriver();
    $vehicle = Vehicle::factory()->create();

    $this->actingAs($user, 'sanctum')
        ->putJson('/api/v1/me/duty', ['on_duty' => true, 'vehicle_id' => $vehicle->id])
        ->assertOk()
        ->assertJsonPath('data.on_duty', true)
        ->assertJsonPath('data.vehicle_id', $vehicle->id);

    expect(app(DriverPresenceStore::class)->get($driver->id)?->onDuty)->toBeTrue();
});

it('lets a driver go on duty before the depot has handed them a vehicle', function () {
    [$user] = signedInDriver();

    // Deliberately not a 422. A driver can be signed on before keys are
    // issued, and dispatch ranks them without a vehicle of their own rather
    // than refusing them — ADR-0020's rule that a missing input is reported,
    // not guessed at.
    $this->actingAs($user, 'sanctum')
        ->putJson('/api/v1/me/duty', ['on_duty' => true])
        ->assertOk()
        ->assertJsonPath('data.on_duty', true)
        ->assertJsonPath('data.vehicle_id', null);
});

it('refuses to put a driver on approved leave on duty', function () {
    [$user, $driver] = signedInDriver();

    AvailabilityBlock::create([
        'resource_type' => AvailabilityResource::DRIVER,
        'resource_id' => $driver->id,
        'kind' => AvailabilityKind::LEAVE,
        'status' => AvailabilityStatus::APPROVED,
        'starts_at' => now()->subDay(),
        'ends_at' => now()->addDay(),
        'reason' => 'Annual leave',
    ]);

    // The same refusal a dispatcher gets from the assignment endpoint, from
    // the same service. Two answers to "is this driver available" is how
    // dispatch ends up being the one to discover they disagree.
    $this->actingAs($user, 'sanctum')
        ->putJson('/api/v1/me/duty', ['on_duty' => true])
        ->assertStatus(409)
        ->assertJsonPath('code', 'DRIVER_UNAVAILABLE');

    expect(app(DriverPresenceStore::class)->get($driver->id))->toBeNull();
});

it('lets a driver carrying a passenger go back on duty', function () {
    [$user, $driver] = signedInDriver();
    $vehicle = Vehicle::factory()->create();

    $trip = Trip::factory()->create([
        'driver_id' => $driver->id,
        'vehicle_id' => $vehicle->id,
        'status' => TripStatus::DRIVER_EN_ROUTE,
    ]);

    // `AvailabilityService` calls this driver unavailable, and for the
    // dispatcher's question — "may I give them another job" — it is right.
    // This is the other question, and an occupying trip is the strongest
    // possible argument *for* being on duty rather than against it.
    //
    // Refusing here locked drivers out of their own switch: anyone who closed
    // the app mid-job, or signed off by accident, got 409 ON_TRIP and stayed
    // off duty until somebody completed the trip for them. Seen on a live
    // server — a driver sat off duty in the app while holding a live trip.
    $this->actingAs($user, 'sanctum')
        ->putJson('/api/v1/me/duty', ['on_duty' => true])
        ->assertOk()
        ->assertJsonPath('data.on_duty', true);

    expect(app(DriverPresenceStore::class)->get($driver->id)?->onDuty)->toBeTrue();
    expect($trip->fresh()->status)->toBe(TripStatus::DRIVER_EN_ROUTE);
});

it('records a heartbeat and reports the driver as dispatchable', function () {
    [$user, $driver] = signedInDriver();

    $this->actingAs($user, 'sanctum')->putJson('/api/v1/me/duty', ['on_duty' => true]);

    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/presence', [
            'latitude' => 0.3476,
            'longitude' => 32.5825,
            'accuracy_metres' => 12.5,
            'recorded_at' => now()->toIso8601String(),
        ])
        // 202, not 201: nothing is created, one row is overwritten, and the
        // store may legitimately discard the ping as older than what it holds.
        ->assertStatus(202)
        ->assertJsonPath('data.dispatchable', true);

    expect(app(DriverPresenceStore::class)->dispatchable()->pluck('driverId'))
        ->toContain($driver->id);
});

it('refuses a heartbeat from a driver who is not on duty', function () {
    [$user] = signedInDriver();

    // Refused rather than dropped. The app stops sending these at sign-off,
    // so one arriving means the app and the platform disagree about whether
    // a shift is running — and the app has to be told, or it keeps showing
    // a driver as online while dispatch has written them off.
    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/presence', [
            'latitude' => 0.3476,
            'longitude' => 32.5825,
            'recorded_at' => now()->toIso8601String(),
        ])
        ->assertStatus(409)
        ->assertJsonPath('code', 'NOT_ON_DUTY');
});

it('never lets a heartbeat put a signed-off driver back into the pool', function () {
    [$user, $driver] = signedInDriver();
    $store = app(DriverPresenceStore::class);

    $this->actingAs($user, 'sanctum')->putJson('/api/v1/me/duty', ['on_duty' => true]);
    $this->actingAs($user, 'sanctum')->postJson('/api/v1/me/presence', [
        'latitude' => 0.3476, 'longitude' => 32.5825, 'recorded_at' => now()->toIso8601String(),
    ])->assertStatus(202);

    $this->actingAs($user, 'sanctum')->putJson('/api/v1/me/duty', ['on_duty' => false])->assertOk();

    // What this actually proves is the *controller's* refusal — the request
    // never reaches the store. The store's own guard against the same race
    // is unreachable from here and is covered directly in
    // `DriverPresenceStoreTest`; an earlier version of this comment claimed
    // otherwise, and mutating the store's SQL failed no test at all.
    //
    // Both are worth having. This one is the contract the app sees; that
    // one is the last line for anything that reaches the store without
    // passing through a controller.
    $this->actingAs($user, 'sanctum')->postJson('/api/v1/me/presence', [
        'latitude' => 0.3476, 'longitude' => 32.5825, 'recorded_at' => now()->toIso8601String(),
    ])->assertStatus(409);

    expect($store->get($driver->id)?->onDuty)->toBeFalse();
    expect($store->dispatchable()->pluck('driverId'))->not->toContain($driver->id);
});

it('clears the position when a driver goes off duty', function () {
    [$user, $driver] = signedInDriver();

    $this->actingAs($user, 'sanctum')->putJson('/api/v1/me/duty', ['on_duty' => true]);
    $this->actingAs($user, 'sanctum')->postJson('/api/v1/me/presence', [
        'latitude' => 0.3476, 'longitude' => 32.5825, 'recorded_at' => now()->toIso8601String(),
    ]);

    $this->actingAs($user, 'sanctum')->putJson('/api/v1/me/duty', ['on_duty' => false]);

    // Not merely tidiness. Where a driver was when they signed off is
    // usually where they live, and a point left behind is one the matcher
    // could rank tomorrow morning.
    expect(app(DriverPresenceStore::class)->get($driver->id)?->latitude)->toBeNull();
});

it('drops a driver out of the pool once their position goes stale', function () {
    [$user, $driver] = signedInDriver();
    $store = app(DriverPresenceStore::class);

    $this->actingAs($user, 'sanctum')->putJson('/api/v1/me/duty', ['on_duty' => true]);
    $this->actingAs($user, 'sanctum')->postJson('/api/v1/me/presence', [
        'latitude' => 0.3476, 'longitude' => 32.5825, 'recorded_at' => now()->toIso8601String(),
    ]);

    expect($store->dispatchable()->pluck('driverId'))->toContain($driver->id);

    // The failure this prevents: a phone that lost signal at 07:00 keeps
    // winning the proximity ranking all morning while every order routed to
    // it times out. Staleness has to remove the driver, not freeze them at
    // a place they left.
    Carbon::setTestNow(now()->addSeconds((int) config('dispatch.presence_ttl_seconds') + 60));

    expect($store->dispatchable()->pluck('driverId'))->not->toContain($driver->id);
    expect($store->get($driver->id)?->isDispatchable())->toBeFalse();

    Carbon::setTestNow();
});

it('keeps a driver dispatchable when their handset refuses location', function () {
    [$user, $driver] = signedInDriver();

    $this->actingAs($user, 'sanctum')->putJson('/api/v1/me/duty', ['on_duty' => true]);

    // On duty, never sent a position. Dropping them would be a silent
    // per-driver outage that looks to the office like a matcher playing
    // favourites — so they stay in the pool and simply rank without a
    // distance component.
    $presence = app(DriverPresenceStore::class)->get($driver->id);

    expect($presence?->isDispatchable())->toBeTrue();
    expect($presence?->hasUsablePosition())->toBeFalse();
    expect(app(DriverPresenceStore::class)->dispatchable()->pluck('driverId'))->toContain($driver->id);
});

it('refuses an account with no driver profile behind it', function () {
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::OPERATIONS_MANAGER]);

    $this->actingAs($user, 'sanctum')
        ->putJson('/api/v1/me/duty', ['on_duty' => true])
        ->assertStatus(403)
        ->assertJsonPath('code', 'NOT_A_DRIVER');
});

it('lets a driver-scoped token reach all three presence routes', function () {
    // ADR-0022's allow-list is fail-closed, so a route added to the API is
    // shut to the driver app until somebody names it. This asserts the
    // naming happened — without it, the whole feature is invisible to the
    // only client that uses it, and every test above would still pass.
    expect(ClientScope::routesFor(ClientScope::DRIVER))
        ->toContain('me.duty.show')
        ->toContain('me.duty.update')
        ->toContain('me.presence.store');
});
