<?php

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Models\Operator;
use App\Models\Tenant;
use App\Models\User;
use Modules\Bookings\Models\Booking;
use Modules\Bookings\Models\OrderRequest;
use Modules\Dispatch\Services\DispatchRecommender;
use Modules\Drivers\Models\Driver;
use Modules\Vehicles\Models\Vehicle;

/**
 * ADR-0020 §2, completed — the coordinates the matcher ranks by.
 *
 * The public order form has geocoded from its first day and held `lngLat`
 * to centre its map. It never sent it, so the platform discarded the one
 * input that makes proximity dispatch possible and then had nothing to rank
 * by. These assert the round trip, and the two ways it must refuse.
 */
function coordinateOrderPayload(array $overrides = []): array
{
    return [
        'service_type' => 'ride',
        'contact_name' => 'Grace Amongin',
        'contact_phone' => '+256700123456',
        'pickup_location' => 'Acacia Mall',
        'dropoff_location' => 'Entebbe Airport',
        ...$overrides,
    ];
}

function submitCoordinateOrder(array $payload)
{
    // Posted anonymously, like every other public-order test: the endpoint
    // is the walk-in form's, and acting as a Customer makes `Auditable`
    // write a `user_id` that is not a `users` row — an FK violation, not a
    // more realistic test.
    return test()->postJson('/api/v1/public/order-requests', $payload);
}

it('keeps the coordinates a walk-in order was placed with', function () {
    submitCoordinateOrder(coordinateOrderPayload([
        'pickup_latitude' => 0.3476,
        'pickup_longitude' => 32.5825,
        'dropoff_latitude' => 0.0424,
        'dropoff_longitude' => 32.4435,
    ]))->assertCreated();

    $order = OrderRequest::query()->latest('id')->first();

    expect((float) $order->pickup_latitude)->toBe(0.3476);
    expect((float) $order->pickup_longitude)->toBe(32.5825);
    expect((float) $order->dropoff_latitude)->toBe(0.0424);
});

it('still accepts an order with no coordinates, because a phone order has none', function () {
    submitCoordinateOrder(coordinateOrderPayload())->assertCreated();

    $order = OrderRequest::query()->latest('id')->first();

    // `places.ts` is explicit that a geocoder outage degrades to plain text
    // rather than an error screen; the column follows it.
    expect($order->pickup_latitude)->toBeNull();
    expect($order->pickup_location)->toBe('Acacia Mall');
});

it('refuses half a point rather than storing a longitude with no latitude', function () {
    submitCoordinateOrder(coordinateOrderPayload(['pickup_longitude' => 32.5825]))
        ->assertStatus(422)
        ->assertJsonValidationErrors('pickup_latitude');
});

it('refuses a latitude that is not a latitude', function () {
    submitCoordinateOrder(coordinateOrderPayload([
        'pickup_latitude' => 132.0,
        'pickup_longitude' => 32.5825,
    ]))->assertStatus(422)->assertJsonValidationErrors('pickup_latitude');
});

it('cannot catch a Kampala lat/lng swap, and this records why', function () {
    // Kampala is 0.3476 N, 32.5825 E. Swap them and you get 32.5825 N,
    // 0.3476 E — a point off the coast of Ghana, and **both values are in
    // range**, so the bounds check waves it through. This was written as a
    // test asserting the swap is refused; it is not, and pretending
    // otherwise would have left a false guarantee in the suite.
    //
    // Catching it needs a service-area bounding box, which is the
    // geofencing work rather than a validation rule — and a hardcoded
    // Uganda box would be wrong the day the platform crosses a border.
    submitCoordinateOrder(coordinateOrderPayload([
        'pickup_latitude' => 32.5825,
        'pickup_longitude' => 0.3476,
    ]))->assertCreated();
});

it('exposes the coordinates to the dispatcher queue', function () {
    submitCoordinateOrder(coordinateOrderPayload([
        'pickup_latitude' => 0.3476,
        'pickup_longitude' => 32.5825,
    ]))->assertCreated();

    $dispatcher = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);

    $row = test()->actingAs($dispatcher, 'sanctum')
        ->getJson('/api/v1/order-requests')->assertOk()->json('data.order_requests.0');

    expect((float) $row['pickup_latitude'])->toBe(0.3476);
});

it('keeps the coordinates a staff-created booking was raised with', function () {
    $tenant = Tenant::factory()->create();
    $staff = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_ADMIN]);

    test()->actingAs($staff, 'sanctum')->postJson('/api/v1/bookings', [
        'passenger_user_id' => $staff->id,
        'passenger_name' => 'Grace Amongin',
        'passenger_phone' => '+256700123456',
        'passenger_count' => 2,
        'origin' => 'Acacia Mall',
        'origin_latitude' => 0.3476,
        'origin_longitude' => 32.5825,
        'destination' => 'Entebbe Airport',
    ])->assertCreated();

    $booking = Booking::allTenants()->latest('id')->first();

    expect((float) $booking->origin_latitude)->toBe(0.3476);
});

it('makes the matcher rank by distance once a booking has coordinates', function () {
    $tenant = Tenant::factory()->create();
    $staff = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_ADMIN]);
    Driver::factory()->create();
    Vehicle::factory()->create(['seating_capacity' => 5]);

    test()->actingAs($staff, 'sanctum')->postJson('/api/v1/bookings', [
        'passenger_user_id' => $staff->id,
        'passenger_name' => 'Grace Amongin',
        'passenger_phone' => '+256700123456',
        'passenger_count' => 2,
        'origin' => 'Acacia Mall',
        'origin_latitude' => 0.3476,
        'origin_longitude' => 32.5825,
        'destination' => 'Entebbe Airport',
    ])->assertCreated();

    $booking = Booking::allTenants()->latest('id')->first();

    // The recommender scopes its pool by the acting fleet (ADR-0055 §6), so
    // it now takes the dispatcher rather than the booking alone. Shanitah,
    // because that is what `VehicleFactory` and `DriverFactory` default to.
    $dispatcher = User::factory()->create([
        'tenant_id' => null,
        'operator_id' => Operator::SHANITAH,
        'access_level' => AccessLevel::FLEET,
        'role' => UserRole::DISPATCHER,
    ]);

    $suggestion = app(DispatchRecommender::class)->bestFor($booking, $dispatcher);

    // The whole point of the round trip: before this, every suggestion said
    // "pickup has no coordinates, so distance was not used" — for every
    // booking the platform had ever taken.
    expect($suggestion)->not->toBeNull();
    expect(implode(' ', $suggestion->reasons))->not->toContain('no coordinates');
});
