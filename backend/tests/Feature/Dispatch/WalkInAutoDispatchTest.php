<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\User;
use App\Support\Auth\ClientScope;
use Illuminate\Support\Carbon;
use Modules\Bookings\Enums\OrderRequestStatus;
use Modules\Bookings\Models\OrderRequest;
use Modules\Dispatch\Enums\DispatchOfferStatus;
use Modules\Dispatch\Models\DispatchOffer;
use Modules\Dispatch\Services\DispatchOfferService;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Support\DriverPresence;
use Modules\Fleet\Support\DriverPresenceStore;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * The chain ADR-0024 exists to close: a stranger orders on the website, the
 * platform ranks the drivers who are actually on duty, offers the job to the
 * nearest, and turns their accept into a Trip.
 *
 * Coordinates are Kampala: 0.3476 N, 32.5825 E is the city centre, and each
 * 0.01 of latitude is roughly 1.1 km, which makes "nearer" here a real
 * distance rather than an arbitrary ordering.
 */
function onDutyDriverAt(float $latitude, float $longitude, int $seats = 4): array
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $user->id]);
    $vehicle = Vehicle::factory()->create(['seating_capacity' => $seats, 'status' => 'active']);

    $store = app(DriverPresenceStore::class);
    $store->setDuty($driver->id, true, $vehicle->id);
    $store->heartbeat(new DriverPresence(
        driverId: $driver->id,
        onDuty: true,
        vehicleId: $vehicle->id,
        latitude: $latitude,
        longitude: $longitude,
        accuracyMetres: 10.0,
        recordedAt: Carbon::now(),
    ));

    return [$user, $driver, $vehicle];
}

function walkInOrder(array $overrides = []): OrderRequest
{
    return OrderRequest::factory()->create([
        'status' => OrderRequestStatus::NEW,
        'pickup_location' => 'Acacia Mall',
        'pickup_latitude' => 0.3476,
        'pickup_longitude' => 32.5825,
        'dropoff_location' => 'Garden City',
        'scheduled_for' => null,
        ...$overrides,
    ]);
}

it('offers a new walk-in order to the nearest on-duty driver, unattended', function () {
    // The far driver is created first on purpose. ADR-0020 records a test
    // that passed for the wrong reason here — with distance scoring removed
    // both candidates tied, `sortByDesc` is stable, and the near one
    // happened to have been created first. Ordering the fixtures this way
    // means only distance can put the near driver on top.
    [, $far] = onDutyDriverAt(0.4476, 32.5825);   // ~11 km north
    [, $near] = onDutyDriverAt(0.3486, 32.5825);  // ~110 m north

    $order = walkInOrder();

    app(DispatchOfferService::class)->dispatch($order);

    $offers = DispatchOffer::query()->where('order_request_id', $order->id)->get();

    expect($offers)->toHaveCount(1);
    expect($offers->first()->driver_id)->toBe($near->id);
    expect($offers->first()->driver_id)->not->toBe($far->id);
});

it('fires automatically the moment a public order is received', function () {
    [, $driver] = onDutyDriverAt(0.3486, 32.5825);

    // The whole point of ADR-0024 §6: nobody pressed anything. ADR-0020
    // deliberately left this undone — "nothing polls the queue and assigns
    // unattended" — and this is the second step it named.
    $this->postJson('/api/v1/public/order-requests', [
        'service_type' => 'ride',
        'contact_name' => 'Sarah N',
        'contact_phone' => '+256700000001',
        'pickup_location' => 'Acacia Mall',
        'pickup_latitude' => 0.3476,
        'pickup_longitude' => 32.5825,
        'dropoff_location' => 'Garden City',
    ])->assertStatus(201);

    expect(DispatchOffer::query()->where('driver_id', $driver->id)->live()->exists())->toBeTrue();
});

it('does not write a trip until somebody accepts', function () {
    onDutyDriverAt(0.3486, 32.5825);
    $order = walkInOrder();

    app(DispatchOfferService::class)->dispatch($order);

    // The rule that shapes the whole design (ADR-0024 §3). A trip in
    // `assigned` occupies its vehicle, so creating one to represent an
    // unanswered offer would take a real van out of the fleet for as long as
    // a driver ignored their phone — and offering the ride to a second
    // driver would need a second trip on the same vehicle, which
    // TripAssignmentGuard correctly refuses.
    expect(Trip::query()->withoutGlobalScopes()->count())->toBe(0);
    expect($order->refresh()->trip_id)->toBeNull();
});

it('turns an accept into a customer-owned trip', function () {
    $customer = Customer::factory()->create();
    [$user, $driver, $vehicle] = onDutyDriverAt(0.3486, 32.5825);
    $order = walkInOrder(['customer_id' => $customer->id]);

    app(DispatchOfferService::class)->dispatch($order);
    $offer = DispatchOffer::query()->where('driver_id', $driver->id)->firstOrFail();

    $response = $this->actingAs($user, 'sanctum')
        ->postJson("/api/v1/me/offers/{$offer->id}/acceptance")
        ->assertStatus(201);

    $trip = Trip::query()->withoutGlobalScopes()->findOrFail($response->json('data.id'));

    expect($trip->customer_id)->toBe($customer->id);
    expect($trip->tenant_id)->toBeNull();
    expect($trip->driver_id)->toBe($driver->id);
    expect($trip->vehicle_id)->toBe($vehicle->id);
    expect($trip->status)->toBe(TripStatus::ASSIGNED);

    // The foreign key `OrderRequestStatus::CONVERTED` was promised in
    // ADR-0012 and given in ADR-0024 §4. The case keeps its meaning; it now
    // says which work.
    $order->refresh();
    expect($order->trip_id)->toBe($trip->id);
    expect($order->status)->toBe(OrderRequestStatus::CONVERTED);
});

it('refuses a second driver who accepts the same ride', function () {
    // Wave size is one by default, so two live offers on one order only
    // happen when an operator widens it. Written against that case rather
    // than today's default: a wave size that silently double-books the first
    // time somebody raises it is a trap set for a config change.
    config(['dispatch.offer_wave_size' => 2]);

    [$firstUser, $first] = onDutyDriverAt(0.3486, 32.5825);
    [$secondUser, $second] = onDutyDriverAt(0.3496, 32.5825);
    $order = walkInOrder();

    app(DispatchOfferService::class)->dispatch($order);

    $firstOffer = DispatchOffer::query()->where('driver_id', $first->id)->firstOrFail();
    $secondOffer = DispatchOffer::query()->where('driver_id', $second->id)->firstOrFail();

    $this->actingAs($firstUser, 'sanctum')
        ->postJson("/api/v1/me/offers/{$firstOffer->id}/acceptance")
        ->assertStatus(201);

    $this->actingAs($secondUser, 'sanctum')
        ->postJson("/api/v1/me/offers/{$secondOffer->id}/acceptance")
        ->assertStatus(409)
        ->assertJsonPath('code', 'OFFER_NO_LONGER_OPEN');

    expect(Trip::query()->withoutGlobalScopes()->count())->toBe(1);
    expect($secondOffer->refresh()->status)->toBe(DispatchOfferStatus::SUPERSEDED);
});

it('moves straight to the next driver when one declines', function () {
    [$nearUser, $near] = onDutyDriverAt(0.3486, 32.5825);
    [, $far] = onDutyDriverAt(0.3576, 32.5825);
    $order = walkInOrder();

    app(DispatchOfferService::class)->dispatch($order);
    $offer = DispatchOffer::query()->where('driver_id', $near->id)->firstOrFail();

    // The entire value of a decline over a timeout: the search moves now.
    // A system that made the passenger wait out the full window after being
    // told "no" would be discarding the one signal it was given.
    $this->actingAs($nearUser, 'sanctum')
        ->postJson("/api/v1/me/offers/{$offer->id}/decline", ['reason' => 'Too far'])
        ->assertOk();

    expect($offer->refresh()->status)->toBe(DispatchOfferStatus::DECLINED);
    expect(DispatchOffer::query()->where('driver_id', $far->id)->live()->exists())->toBeTrue();
});

it('never offers the same ride to a driver who already said no', function () {
    [$user, $driver] = onDutyDriverAt(0.3486, 32.5825);
    $order = walkInOrder();

    app(DispatchOfferService::class)->dispatch($order);
    $offer = DispatchOffer::query()->where('driver_id', $driver->id)->firstOrFail();

    $this->actingAs($user, 'sanctum')->postJson("/api/v1/me/offers/{$offer->id}/decline")->assertOk();

    // Without the already-asked filter the wave loop offers the nearest
    // driver the same job five times while they are asleep, and the
    // passenger waits out five full windows for one answer.
    expect(DispatchOffer::query()->where('order_request_id', $order->id)->count())->toBe(1);
});

it('refuses an accept once the clock has run out', function () {
    [$user, $driver] = onDutyDriverAt(0.3486, 32.5825);
    $order = walkInOrder();

    app(DispatchOfferService::class)->dispatch($order);
    $offer = DispatchOffer::query()->where('driver_id', $driver->id)->firstOrFail();

    // Nothing runs in between. ADR-0024 §5: an offer is expired because the
    // clock passed, not because a job noticed — so this must fail with the
    // scheduler stopped, which is exactly the state it is in here.
    //
    // Mutation check: change `DispatchOffer::isLive()` to return
    // `$this->status->isOpen()` and this test fails.
    Carbon::setTestNow(now()->addSeconds((int) config('dispatch.offer_ttl_seconds') + 5));

    $this->actingAs($user, 'sanctum')
        ->postJson("/api/v1/me/offers/{$offer->id}/acceptance")
        ->assertStatus(409)
        ->assertJsonPath('code', 'OFFER_NO_LONGER_OPEN');

    expect(Trip::query()->withoutGlobalScopes()->count())->toBe(0);

    Carbon::setTestNow();
});

it('hides a lapsed offer from the driver\'s list rather than showing a dead countdown', function () {
    [$user, $driver] = onDutyDriverAt(0.3486, 32.5825);
    $order = walkInOrder();

    app(DispatchOfferService::class)->dispatch($order);

    $this->actingAs($user, 'sanctum')->getJson('/api/v1/me/offers')
        ->assertOk()
        ->assertJsonCount(1, 'data');

    Carbon::setTestNow(now()->addSeconds((int) config('dispatch.offer_ttl_seconds') + 5));

    // Rendering it would give the driver a countdown reading a negative
    // number and a button whose only outcome is a 409.
    $this->actingAs($user, 'sanctum')->getJson('/api/v1/me/offers')
        ->assertOk()
        ->assertJsonCount(0, 'data');

    Carbon::setTestNow();
});

it('hands a timed-out ride to the next driver when the sweep runs', function () {
    [, $near] = onDutyDriverAt(0.3486, 32.5825);
    [, $far] = onDutyDriverAt(0.3576, 32.5825);
    $order = walkInOrder();

    app(DispatchOfferService::class)->dispatch($order);

    Carbon::setTestNow(now()->addSeconds((int) config('dispatch.offer_ttl_seconds') + 5));

    $this->artisan('dispatch:advance-offers')->assertExitCode(0);

    expect(DispatchOffer::query()->where('driver_id', $near->id)->first()->status)
        ->toBe(DispatchOfferStatus::EXPIRED);
    expect(DispatchOffer::query()->where('driver_id', $far->id)->live()->exists())->toBeTrue();

    Carbon::setTestNow();
});

it('gives up loudly, leaving the ride in the desk\'s queue', function () {
    config(['dispatch.offer_max_rounds' => 1]);

    [$user, $driver] = onDutyDriverAt(0.3486, 32.5825);
    $order = walkInOrder();

    $offers = app(DispatchOfferService::class);
    $offers->dispatch($order);
    $offer = DispatchOffer::query()->where('driver_id', $driver->id)->firstOrFail();

    $this->actingAs($user, 'sanctum')->postJson("/api/v1/me/offers/{$offer->id}/decline")->assertOk();

    // Not dropped, and not marked closed: it is still exactly what it was,
    // an unfulfilled request in the queue ADR-0012 built and a dispatcher is
    // already watching. A matcher that gives up loudly is one an operator
    // can trust.
    $order->refresh();
    expect($order->status)->toBe(OrderRequestStatus::NEW);
    expect($order->trip_id)->toBeNull();
    expect($offers->searchState($order))->toBe('unmatched');
});

it('reports the search state in the ride screen\'s own vocabulary', function () {
    [$user, $driver] = onDutyDriverAt(0.3486, 32.5825);
    $order = walkInOrder();
    $offers = app(DispatchOfferService::class);

    // `ride.ts` names its phases after TripStatus deliberately, so the
    // mapping is "an identity function rather than a translation table
    // somebody has to keep in step".
    expect($offers->searchState($order))->toBe('searching');

    $offers->dispatch($order);
    expect($offers->searchState($order->refresh()))->toBe('offered');

    $offer = DispatchOffer::query()->where('driver_id', $driver->id)->firstOrFail();
    $this->actingAs($user, 'sanctum')->postJson("/api/v1/me/offers/{$offer->id}/acceptance")->assertStatus(201);

    expect($offers->searchState($order->refresh()))->toBe('assigned');
});

it('never offers a ride to a driver who is off duty', function () {
    [, $driver] = onDutyDriverAt(0.3486, 32.5825);
    app(DriverPresenceStore::class)->setDuty($driver->id, false);

    app(DispatchOfferService::class)->dispatch(walkInOrder());

    // Presence is the filter that did not exist before ADR-0024: every one
    // of these drivers passes the availability check, and only duty
    // separates the one at a stage from the one asleep at home.
    expect(DispatchOffer::query()->count())->toBe(0);
});

it('never offers a ride to somebody else\'s driver profile', function () {
    [, $driver] = onDutyDriverAt(0.3486, 32.5825);
    $intruderUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    Driver::factory()->create(['user_id' => $intruderUser->id]);

    app(DispatchOfferService::class)->dispatch(walkInOrder());
    $offer = DispatchOffer::query()->where('driver_id', $driver->id)->firstOrFail();

    // 404, not 403: another driver's offer is not theirs to know exists.
    $this->actingAs($intruderUser, 'sanctum')
        ->postJson("/api/v1/me/offers/{$offer->id}/acceptance")
        ->assertStatus(404);

    expect($offer->refresh()->status)->toBe(DispatchOfferStatus::OFFERED);
});

it('leaves a scheduled ride for the desk rather than offering it now', function () {
    onDutyDriverAt(0.3486, 32.5825);

    $this->postJson('/api/v1/public/order-requests', [
        'service_type' => 'ride',
        'contact_name' => 'Sarah N',
        'contact_phone' => '+256700000001',
        'pickup_location' => 'Acacia Mall',
        'pickup_latitude' => 0.3476,
        'pickup_longitude' => 32.5825,
        'dropoff_location' => 'Garden City',
        'scheduled_for' => now()->addHours(6)->toIso8601String(),
    ])->assertStatus(201);

    // Holding an offer open for six hours, or waking a matcher at 05:00 to
    // find somebody for a 06:00 pickup, is a scheduler with its own failure
    // modes — deferred by name in ADR-0024.
    expect(DispatchOffer::query()->count())->toBe(0);
});

it('still takes the order when the flag is off', function () {
    config(['dispatch.walk_in_auto_dispatch' => false]);
    onDutyDriverAt(0.3486, 32.5825);

    $this->postJson('/api/v1/public/order-requests', [
        'service_type' => 'ride',
        'contact_name' => 'Sarah N',
        'contact_phone' => '+256700000001',
        'pickup_location' => 'Acacia Mall',
        'dropoff_location' => 'Garden City',
    ])->assertStatus(201);

    // The flag's failure mode is the status quo: a request in the queue and
    // a dispatcher with a telephone.
    expect(OrderRequest::query()->count())->toBe(1);
    expect(DispatchOffer::query()->count())->toBe(0);
});

it('lets a driver-scoped token reach the offer routes', function () {
    // ADR-0022's allow-list is fail-closed. Without this the whole feature
    // is invisible to the only client that uses it, and every test above
    // would still pass.
    expect(ClientScope::routesFor(ClientScope::DRIVER))
        ->toContain('me.offers.index')
        ->toContain('me.offers.acceptance.store')
        ->toContain('me.offers.decline.store');
});
