<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\User;
use Modules\Bookings\Enums\OrderRequestStatus;
use Modules\Bookings\Models\OrderRequest;
use Modules\Dispatch\Enums\DispatchOfferStatus;
use Modules\Dispatch\Models\DispatchOffer;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripEvent;
use Modules\Vehicles\Models\Vehicle;

/**
 * The passenger calling their own ride off (ADR-0024 §7).
 *
 * One button on the ride screen, two different acts behind it: before a
 * captain is assigned there is only an order the matcher is working, and
 * after one there is a real trip holding a real driver and a real van. The
 * cases below are mostly about the seam between those two, and about the one
 * thing the button must *not* be able to do — undo a journey that has already
 * started, which is a status the lifecycle has no edge out of.
 */
function ridingCustomer(TripStatus $status = TripStatus::ACCEPTED): array
{
    $customer = Customer::factory()->create(['first_name' => 'Sarah', 'last_name' => 'N']);
    $driverUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $driverUser->id]);

    $trip = Trip::factory()
        ->forCustomer($customer)
        ->forVehicle(Vehicle::factory()->create())
        ->forDriver($driver)
        ->create(['status' => $status, 'odometer_start' => 1000]);

    $order = OrderRequest::factory()->create([
        'customer_id' => $customer->id,
        'trip_id' => $trip->id,
        'status' => OrderRequestStatus::CONVERTED,
        'scheduled_for' => null,
    ]);

    return [$customer, $trip, $order];
}

it('cancels a ride the captain has accepted but not started', function () {
    [$customer, $trip] = ridingCustomer(TripStatus::ACCEPTED);

    $this->actingAs($customer, 'customer')
        ->postJson('/api/v1/customer/rides/active/cancellation', ['reason' => 'Waiting too long'])
        ->assertOk();

    expect($trip->fresh()->status)->toBe(TripStatus::CANCELLED);
    // Released, which is the whole point: the driver and the van go straight
    // back into the pool rather than being held by a ride nobody is taking.
    expect($trip->fresh()->status->occupiesVehicle())->toBeFalse();
});

it('lets a passenger out while the captain is still driving to them', function () {
    [$customer, $trip] = ridingCustomer(TripStatus::DRIVER_EN_ROUTE);

    $this->actingAs($customer, 'customer')
        ->postJson('/api/v1/customer/rides/active/cancellation')
        ->assertOk();

    expect($trip->fresh()->status)->toBe(TripStatus::CANCELLED);
});

it('refuses once the journey has started, and says why', function () {
    [$customer, $trip] = ridingCustomer(TripStatus::TRIP_STARTED);

    // `TripStatus` has no edge from `trip_started` to `cancelled`, and that is
    // deliberate — a journey under way ends by being finished. The opening
    // odometer is evidence that cannot be un-booked, and a passenger who needs
    // out mid-journey is talking to their driver, not pressing a button.
    $this->actingAs($customer, 'customer')
        ->postJson('/api/v1/customer/rides/active/cancellation')
        ->assertStatus(409)
        ->assertJsonPath('code', 'INVALID_TRIP_TRANSITION');

    expect($trip->fresh()->status)->toBe(TripStatus::TRIP_STARTED);
});

it('records the passenger as the one who cancelled, without inventing a staff user', function () {
    [$customer, $trip] = ridingCustomer();

    $this->actingAs($customer, 'customer')
        ->postJson('/api/v1/customer/rides/active/cancellation', ['reason' => 'I found another ride'])
        ->assertOk();

    // `allTenants()`: a walk-in trip carries no tenant, and `BelongsToTenant`
    // fails closed — with nothing bound the scope matches nothing at all.
    $event = TripEvent::allTenants()->where('trip_id', $trip->id)
        ->where('to_status', TripStatus::CANCELLED)->sole();

    // Null, not a stand-in account. A customer is authenticated on its own
    // guard and has no staff user; putting a fictitious name on a real audit
    // row would be worse than an honest absence.
    expect($event->user_id)->toBeNull();
    expect($event->notes)->toContain('I found another ride');
});

it('decides nothing about who pays', function () {
    [$customer, $trip] = ridingCustomer();

    $this->actingAs($customer, 'customer')
        ->postJson('/api/v1/customer/rides/active/cancellation')
        ->assertOk();

    // ADR-0024 defers walk-in cancellation charges by name. Null is the
    // column's own way of saying "undecided"; writing false here would make
    // that commercial decision on the operator's behalf, for every ride.
    expect($trip->fresh()->cancellation_charge_applicable)->toBeNull();
});

it('calls off a search that has not found anybody yet', function () {
    $customer = Customer::factory()->create();
    $order = OrderRequest::factory()->create([
        'customer_id' => $customer->id,
        'trip_id' => null,
        'status' => OrderRequestStatus::NEW,
        'scheduled_for' => null,
    ]);

    $this->actingAs($customer, 'customer')
        ->postJson('/api/v1/customer/rides/active/cancellation', ['reason' => 'I ordered by mistake'])
        ->assertOk();

    // Closed, so the matcher stops working it and nobody rings somebody who
    // changed their mind. There is no trip to cancel — there never was one.
    expect($order->fresh()->status)->toBe(OrderRequestStatus::CLOSED);
});

it('kills an offer still sitting on a driver\'s phone', function () {
    $customer = Customer::factory()->create();
    $driver = Driver::factory()->create();
    $order = OrderRequest::factory()->create([
        'customer_id' => $customer->id,
        'trip_id' => null,
        'status' => OrderRequestStatus::NEW,
        'scheduled_for' => null,
    ]);

    $offer = DispatchOffer::create([
        'order_request_id' => $order->id,
        'driver_id' => $driver->id,
        'vehicle_id' => Vehicle::factory()->create()->id,
        'status' => DispatchOfferStatus::OFFERED,
        'round' => 1,
        'rank' => 1,
        'score' => 100,
        'offered_at' => now(),
        'expires_at' => now()->addSeconds(15),
    ]);

    $this->actingAs($customer, 'customer')
        ->postJson('/api/v1/customer/rides/active/cancellation')
        ->assertOk();

    // A driver must not be able to accept a ride the passenger has just
    // called off — that is a captain driving to an empty kerb.
    expect($offer->fresh()->status)->toBe(DispatchOfferStatus::SUPERSEDED);
});

it('answers 404 when there is no ride to call off', function () {
    $customer = Customer::factory()->create();

    $this->actingAs($customer, 'customer')
        ->postJson('/api/v1/customer/rides/active/cancellation')
        ->assertStatus(404)
        ->assertJsonPath('code', 'NOT_FOUND');
});

it('cannot reach into somebody else\'s ride', function () {
    [, $trip] = ridingCustomer();
    $stranger = Customer::factory()->create();

    // The scope is the authorisation: the query starts from the token's own
    // customer, so there is no id to tamper with and nothing to refuse.
    $this->actingAs($stranger, 'customer')
        ->postJson('/api/v1/customer/rides/active/cancellation')
        ->assertStatus(404);

    expect($trip->fresh()->status)->toBe(TripStatus::ACCEPTED);
});

it('refuses an unauthenticated caller', function () {
    $this->postJson('/api/v1/customer/rides/active/cancellation')->assertStatus(401);
});
