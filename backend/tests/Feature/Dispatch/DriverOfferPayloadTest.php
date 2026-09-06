<?php

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Support\Carbon;
use Modules\Bookings\Enums\OrderRequestStatus;
use Modules\Bookings\Models\OrderRequest;
use Modules\Dispatch\Enums\DispatchOfferStatus;
use Modules\Dispatch\Models\DispatchOffer;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Support\DriverPresence;
use Modules\Fleet\Support\DriverPresenceStore;
use Modules\Vehicles\Models\Vehicle;
use Tests\Support\BillingFixtures;

/**
 * What a driver is shown before they accept — `GET /me/offers`.
 *
 * `WalkInAutoDispatchTest` covers the chain that *produces* an offer. This
 * file covers the payload itself, because the decision a driver makes in
 * fifteen seconds is only as good as what is on the card, and because two of
 * the fields are the kind that go wrong quietly:
 *
 * - **`package` and `payment` are allow-lists over `order_requests.details`.**
 *   That column holds `recipient_phone` on every delivery. A projection that
 *   leaked it would break ADR-0024 §7 without any test failing and without
 *   looking wrong in review — the field is called `details`.
 * - **`payment` must not default.** `cash` is the plausible stand-in for a
 *   method nobody gave, and it is the one that sends a driver out with no
 *   float.
 * - **`estimated_fare` must degrade to null rather than 500.** It reaches
 *   into Billing from a list endpoint a driver polls every few seconds.
 *
 * Coordinates are Kampala: 0.3476 N, 32.5825 E is the city centre, and 0.01
 * of latitude is roughly 1.1 km.
 */

/**
 * A driver on duty at a point, holding one live offer for `$order`.
 *
 * The offer is built directly rather than through `DispatchOfferService`
 * because what is under test is the *rendering*, and going through the
 * matcher would make every assertion here also depend on the ranking
 * happening to pick this driver.
 *
 * @return array{0: User, 1: DispatchOffer}
 */
function offerShownTo(OrderRequest $order, string $category = 'sedan', float $pickupDistanceKm = 0.4): array
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $user->id]);
    $vehicle = Vehicle::factory()->create(['category' => $category, 'status' => 'active']);

    $store = app(DriverPresenceStore::class);
    $store->setDuty($driver->id, true, $vehicle->id);
    $store->heartbeat(new DriverPresence(
        driverId: $driver->id,
        onDuty: true,
        vehicleId: $vehicle->id,
        latitude: 0.3476,
        longitude: 32.5825,
        accuracyMetres: 10.0,
        recordedAt: Carbon::now(),
    ));

    $offer = DispatchOffer::factory()->create([
        'order_request_id' => $order->id,
        'driver_id' => $driver->id,
        'vehicle_id' => $vehicle->id,
        'status' => DispatchOfferStatus::OFFERED,
        'pickup_distance_km' => $pickupDistanceKm,
        'offered_at' => now(),
        'expires_at' => now()->addSeconds(15),
        'responded_at' => null,
    ]);

    return [$user, $offer];
}

/** A parcel from the city centre to a point ~2.2 km north. */
function deliveryOrder(array $overrides = []): OrderRequest
{
    return OrderRequest::factory()->delivery()->create([
        'status' => OrderRequestStatus::NEW,
        'pickup_location' => 'Geoprix Engineering Limited, Seeta',
        'pickup_latitude' => 0.3476,
        'pickup_longitude' => 32.5825,
        'dropoff_location' => 'Acacia Mall, 14-18 Cooper Rd',
        'dropoff_latitude' => 0.3676,
        'dropoff_longitude' => 32.5825,
        'scheduled_for' => null,
        ...$overrides,
    ]);
}

function offerPayload(User $user): array
{
    return test()->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/offers')
        ->assertOk()
        ->json('data.0');
}

// ── The parcel ───────────────────────────────────────────────────────────

it('tells the driver what the parcel is and how big it is', function () {
    [$user] = offerShownTo(deliveryOrder());

    expect(offerPayload($user)['package'])
        ->toBe(['item_type' => 'parcel', 'package_size' => 'medium']);
});

it('withholds the sender and recipient numbers a delivery carries', function () {
    // `OrderRequestFactory::delivery()` puts a real recipient name and phone
    // into `details`. ADR-0024 §7 releases neither until after the accept —
    // and this payload is also what a push notification is built from, which
    // puts it on a lock screen readable by whoever is holding the phone.
    $order = deliveryOrder();

    expect($order->details)->toHaveKey('recipient_phone');

    [$user] = offerShownTo($order);

    $payload = offerPayload($user);

    // Asserted over the whole encoded body, not over `package`, because the
    // failure this guards against is a *new* key appearing somewhere else in
    // the resource — `details` emitted wholesale, a debug field, a future
    // `contact` block. Narrowing it to one path would let all three through.
    $encoded = json_encode($payload);

    expect($encoded)->not->toContain($order->details['recipient_phone']);
    expect($encoded)->not->toContain($order->details['recipient_name']);
    expect($encoded)->not->toContain($order->contact_phone);
    expect($encoded)->not->toContain($order->contact_name);
});

it('sends no package block on a ride, rather than one full of nulls', function () {
    [$user] = offerShownTo(OrderRequest::factory()->create([
        'status' => OrderRequestStatus::NEW,
        'pickup_latitude' => 0.3476,
        'pickup_longitude' => 32.5825,
        'dropoff_latitude' => 0.3676,
        'dropoff_longitude' => 32.5825,
        'scheduled_for' => null,
    ]));

    expect(offerPayload($user)['package'])->toBeNull();
});

it('reports a size it was never given as null rather than inventing one', function () {
    [$user] = offerShownTo(deliveryOrder(['details' => ['item_type' => 'documents']]));

    expect(offerPayload($user)['package'])
        ->toBe(['item_type' => 'documents', 'package_size' => null]);
});

// ── How it settles ───────────────────────────────────────────────────────

it('tells the driver how the job settles and which end settles it', function () {
    [$user] = offerShownTo(deliveryOrder([
        'details' => ['payment_method' => 'mobile_money', 'payer' => 'receiver'],
    ]));

    expect(offerPayload($user)['payment'])
        ->toBe(['payment_method' => 'mobile_money', 'payer' => 'receiver']);
});

it('assumes no payment method when the order never gave one', function () {
    // The sharpest failure this block can have, and it is a silent one:
    // `cash` is the plausible default and the wrong one. A driver who reads
    // "Cash", turns up with no float and is offered a mobile-money transfer
    // has been told something the platform never knew. Null renders as an
    // em dash, which is the truth — nobody said.
    [$user] = offerShownTo(deliveryOrder(['details' => ['item_type' => 'parcel']]));

    expect(offerPayload($user)['payment'])
        ->toBe(['payment_method' => null, 'payer' => null]);
});

it('serves the payment block on a ride too, because a ride is paid for as well', function () {
    // The opposite of `package`, which is null on a ride. A ride genuinely
    // has no parcel; every job has a bill, so the block is always an object
    // and its members carry the not-known.
    [$user] = offerShownTo(OrderRequest::factory()->create([
        'status' => OrderRequestStatus::NEW,
        'details' => ['passengers' => 2, 'payment_method' => 'cash'],
        'pickup_latitude' => 0.3476,
        'pickup_longitude' => 32.5825,
        'dropoff_latitude' => 0.3676,
        'dropoff_longitude' => 32.5825,
        'scheduled_for' => null,
    ]));

    $payload = offerPayload($user);

    expect($payload['package'])->toBeNull();
    expect($payload['payment'])->toBe(['payment_method' => 'cash', 'payer' => null]);
});

it('lets no other key of details ride along with the two it is allowed', function () {
    // The allow-list's whole purpose, asserted as a shape rather than as an
    // absence: a deny-list would have let `confirm_with_pin` — or tomorrow's
    // new form field — through, and nobody would have noticed.
    [$user] = offerShownTo(deliveryOrder([
        'details' => [
            'item_type' => 'parcel',
            'payment_method' => 'card',
            'payer' => 'sender',
            'confirm_with_pin' => true,
            'sender_phone' => '+256700111222',
        ],
    ]));

    expect(array_keys(offerPayload($user)['payment']))->toBe(['payment_method', 'payer']);
});

// ── The two distances ────────────────────────────────────────────────────

it('serves how far the job is, not only how far away it starts', function () {
    // 0.02 of latitude is ~2.2 km. The two numbers answer different
    // questions and a driver needs both: 0.4 km away is a good offer if the
    // ride is long and a poor one if it is 700 m.
    [$user] = offerShownTo(deliveryOrder(), pickupDistanceKm: 0.4);

    $payload = offerPayload($user);

    expect($payload['pickup_distance_km'])->toBe(0.4);
    expect($payload['trip_distance_km'])->toBeGreaterThan(2.1);
    expect($payload['trip_distance_km'])->toBeLessThan(2.3);
});

it('serves no trip distance for an order taken over the phone', function () {
    // No coordinates at the far end, which is the ordinary case for an order
    // a dispatcher keyed in. Null renders as no figure; a zero would read as
    // a drop-off at the pickup.
    [$user] = offerShownTo(deliveryOrder(['dropoff_latitude' => null, 'dropoff_longitude' => null]));

    expect(offerPayload($user)['trip_distance_km'])->toBeNull();
});

// ── The estimate ─────────────────────────────────────────────────────────

it('prices the job from the public tariff, flagged as an estimate', function () {
    BillingFixtures::publicTariff(['sedan' => [2_000, 1_500]]);

    [$user] = offerShownTo(deliveryOrder());

    $fare = offerPayload($user)['estimated_fare'];

    // 2,000 base + ~2.2 km x 1,500. Asserted as a range because the leg is a
    // great circle rather than a round number — pinning it to the shilling
    // would be a test of the haversine, which `WalkInFareTest` already owns.
    expect($fare['total_minor'])->toBeGreaterThan(5_000);
    expect($fare['total_minor'])->toBeLessThan(5_500);
    expect($fare['currency'])->toBe('UGX');

    // The word "estimate" travels in the payload rather than living only in
    // the client, so no app can render this as a bill by forgetting to.
    expect($fare['is_estimate'])->toBeTrue();
    expect($fare['basis'])->toContain('Straight-line');
});

it('shows no figure rather than a zero when nobody has published a tariff', function () {
    // The loud failure ADR-0026 asks for belongs at completion, where money
    // actually changes hands. Here it would take out the whole offer list —
    // every few seconds, for every driver on duty — over a price.
    [$user] = offerShownTo(deliveryOrder());

    expect(offerPayload($user)['estimated_fare'])->toBeNull();
});

it('shows no figure when the tariff has not priced this vehicle', function () {
    BillingFixtures::publicTariff(['sedan' => [2_000, 1_500]]);

    // A boda dispatched before anybody priced bodas.
    [$user] = offerShownTo(deliveryOrder(), category: 'boda');

    expect(offerPayload($user)['estimated_fare'])->toBeNull();
});

it('shows no figure when there is nothing to measure the fare across', function () {
    BillingFixtures::publicTariff(['sedan' => [2_000, 1_500]]);

    [$user] = offerShownTo(deliveryOrder(['dropoff_latitude' => null, 'dropoff_longitude' => null]));

    expect(offerPayload($user)['estimated_fare'])->toBeNull();
});
