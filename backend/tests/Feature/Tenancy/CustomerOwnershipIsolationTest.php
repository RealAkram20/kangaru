<?php

use App\Models\Customer;
use Modules\Bookings\Models\OrderRequest;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * W1-c · Security gate. The customer surface (ADR-0013) is not tenant-scoped
 * — a walk-in belongs to the platform, not to a client — so "cross-tenant"
 * there means **one member of the public reading another's**. The rule is
 * the same as AGENTS.md's for tenants: another customer's record answers
 * 404, never 403, and never 200.
 *
 * Every assertion is a count or an exact status; the own-record twin of each
 * refusal proves the fixture is real.
 */

/**
 * @return array{mine: Customer, theirs: Customer, myTrip: Trip, theirTrip: Trip, myOrders: int, theirOrders: int, theirOrderId: int}
 */
function twoCustomersWithOrdersAndTrips(): array
{
    $mine = Customer::factory()->create();
    $theirs = Customer::factory()->create();

    OrderRequest::factory()->count(2)->create(['customer_id' => $mine->id]);
    $theirOrders = OrderRequest::factory()->count(3)->create(['customer_id' => $theirs->id]);
    OrderRequest::factory()->create(['customer_id' => null]);

    $trip = fn (Customer $customer) => Trip::factory()
        ->forCustomer($customer)
        ->forVehicle(Vehicle::factory()->create())
        ->forDriver(Driver::factory()->create())
        ->create(['status' => TripStatus::TRIP_COMPLETED]);

    return [
        'mine' => $mine,
        'theirs' => $theirs,
        'myTrip' => $trip($mine),
        'theirTrip' => $trip($theirs),
        'myOrders' => 2,
        'theirOrders' => 3,
        'theirOrderId' => $theirOrders->first()->id,
    ];
}

it('lists exactly the customer\'s own order requests', function () {
    ['mine' => $mine, 'myOrders' => $myOrders] = twoCustomersWithOrdersAndTrips();

    $response = $this->actingAs($mine, 'customer')
        ->getJson('/api/v1/customer/order-requests')
        ->assertOk();

    // Two of mine, three of theirs, one anonymous: exactly two come back.
    expect(count($response->json('data.order_requests')))->toBe($myOrders);
    expect($response->json('meta.total'))->toBe($myOrders);
});

it('answers 404, never 403, when a customer names another customer\'s order request', function () {
    ['mine' => $mine, 'theirOrderId' => $theirOrderId] = twoCustomersWithOrdersAndTrips();

    $this->actingAs($mine, 'customer')
        ->getJson("/api/v1/customer/order-requests/{$theirOrderId}")
        ->assertStatus(404)
        ->assertJsonPath('code', 'NOT_FOUND');

    // And the owner reaches the same id, so the 404 above is a refusal and
    // not an absence.
    $theirs = Customer::query()->whereKeyNot($mine->id)->orderBy('id')->firstOrFail();
    $this->actingAs($theirs, 'customer')
        ->getJson("/api/v1/customer/order-requests/{$theirOrderId}")
        ->assertOk()
        ->assertJsonPath('data.order_request.id', $theirOrderId);
});

it('answers 404, never 403, when a customer rates another customer\'s trip', function () {
    ['mine' => $mine, 'theirTrip' => $theirTrip] = twoCustomersWithOrdersAndTrips();

    $this->actingAs($mine, 'customer')
        ->postJson("/api/v1/customer/trips/{$theirTrip->id}/rating", ['stars' => 5])
        ->assertStatus(404)
        ->assertJsonPath('code', 'NOT_FOUND');
});

it('lets a customer rate their own completed trip — W1-c-F5, closed', function () {
    ['mine' => $mine, 'myTrip' => $myTrip] = twoCustomersWithOrdersAndTrips();

    // This test spent 2026-08-18 to 2026-08-20 pinned at 404: `{trip}`
    // resolved through `BelongsToTenant::resolveRouteBinding`, which
    // dropped the tenant scope only for a platform *User*; the actor here
    // is a Customer, no tenant is bound, so `TenantScope` failed closed and
    // the binding 404d before `TripRatingController` ever ran. Found by the
    // census; felt by the owner ("gave this drive a rating but it was not
    // given to the driver"). The resolver now treats a Customer like the
    // other tenant-less actor, and the controller's own `customer_id`
    // check keeps the sibling test's 404 a real refusal.
    $this->actingAs($mine, 'customer')
        ->postJson("/api/v1/customer/trips/{$myTrip->id}/rating", ['stars' => 5])
        ->assertStatus(201)
        ->assertJsonPath('data.stars', 5);
});
