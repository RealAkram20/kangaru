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

it('cannot yet let a customer rate even their own completed trip — pinned defect W1-c-F5, Trips module', function () {
    ['mine' => $mine, 'myTrip' => $myTrip] = twoCustomersWithOrdersAndTrips();

    // Found by this package on 2026-08-18 and NOT fixed here, because W1-c
    // edits no module source. `{trip}` on this route resolves through
    // `BelongsToTenant::resolveRouteBinding`, which drops the tenant scope
    // only for a platform *User*; the actor here is a Customer, no tenant is
    // bound (customer routes carry no `IdentifyTenant`), so `TenantScope`
    // fails closed and the binding 404s before `TripRatingController` runs.
    // The message is the framework's, not the controller's "No such trip." —
    // that is how you can tell it never got there. ADR-0030's rating loop is
    // therefore open at the backend, and the sibling test's 404 for another
    // customer's trip is a real refusal only once this one answers 201.
    //
    // Pinned rather than skipped: the day the Trips module fixes it, this
    // fails and must be flipped to `assertStatus(201)`; until then a green
    // suite does not quietly claim the endpoint works.
    $response = $this->actingAs($mine, 'customer')
        ->postJson("/api/v1/customer/trips/{$myTrip->id}/rating", ['stars' => 5]);

    expect($response->getStatusCode())->toBe(404, 'The rating endpoint answered — flip this test to assertStatus(201) and close W1-c-F5.');
    expect($response->json('message'))->toBe('The requested resource could not be found.');
});
