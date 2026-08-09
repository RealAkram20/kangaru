<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\Tenant;
use App\Models\User;
use Modules\Bookings\Models\OrderRequest;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripEvent;
use Modules\Vehicles\Models\Vehicle;

/**
 * The last link in ADR-0024's chain: once a driver has accepted, each party
 * can ring the other — and only then, and only each other.
 *
 * Written as much for the negative cases as the positive one. Every leak
 * this file guards against would be silent: nothing errors, a number is
 * simply present in a payload it should not be in, and nobody notices until
 * somebody's phone rings.
 */
function walkInTripInProgress(TripStatus $status = TripStatus::ACCEPTED): array
{
    $customer = Customer::factory()->create([
        // `name` is a composed accessor over the pair (ADR-0015), not a
        // column — setting it directly writes a field that does not exist.
        'first_name' => 'Sarah',
        'last_name' => 'N',
        'phone' => '+256700000009',
    ]);
    $driverUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $driverUser->id, 'phone' => '+256700000111']);

    $trip = Trip::factory()
        ->forCustomer($customer)
        ->forVehicle(Vehicle::factory()->create())
        ->forDriver($driver)
        ->create(['origin' => 'Acacia Mall', 'destination' => 'Garden City', 'status' => $status]);

    $order = OrderRequest::factory()->create([
        'customer_id' => $customer->id,
        'trip_id' => $trip->id,
        'contact_name' => 'Sarah N',
        'contact_phone' => '+256700000222',
        'pickup_location' => 'Acacia Mall',
        'scheduled_for' => null,
    ]);

    return [$customer, $driverUser, $driver, $trip, $order];
}

it('gives the driver the passenger\'s number once the trip is live', function () {
    [, $driverUser, , $trip] = walkInTripInProgress();

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        // The number on the *order*, not the account's. It is the one the
        // person typed for this ride — "call me on my work phone, I'm at
        // reception" — while the account holds whatever they registered
        // with, possibly years ago.
        ->assertJsonPath('data.passenger_contact.phone', '+256700000222');
});

it('withholds the passenger\'s number before the driver has accepted', function () {
    [, $driverUser, , $trip] = walkInTripInProgress(TripStatus::ASSIGNED);

    // A number handed to a driver who then declines is a number given away
    // for nothing. `assigned` is the state an accept moves *out* of.
    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->assertJsonPath('data.passenger_contact', null);
});

it('withholds the passenger\'s number once the trip is closed', function () {
    [, $driverUser, , $trip] = walkInTripInProgress(TripStatus::CLOSED);

    // A completed trip is not a directory.
    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->assertJsonPath('data.passenger_contact', null);
});

it('never puts the passenger\'s number in front of another driver', function () {
    [, , , $trip] = walkInTripInProgress();

    $otherUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    Driver::factory()->create(['user_id' => $otherUser->id]);

    // 403, not a 200 with the field withheld — and that is worth asserting
    // precisely because it is *stronger* than expected. This test was
    // written assuming another driver could read the trip and had to be
    // denied the number by the resource; `TripPolicy::view` already refuses
    // the whole row to anyone without `trips.view.all` who is neither its
    // driver nor its requester. The number never gets near them.
    //
    // Left in place rather than deleted: the resource guard is what stands
    // between the passenger's number and everyone who *does* hold
    // `trips.view.all`, and that case is covered by the dispatcher test
    // below. This one pins the outer door, so a future loosening of
    // TripPolicy::view shows up here rather than as a quiet disclosure.
    $this->actingAs($otherUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertStatus(403);
});

it('never puts a passenger\'s number in a dispatcher\'s trip listing', function () {
    walkInTripInProgress();

    $dispatcher = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    // A dispatcher holding `trips.view.all` sees the whole board, and that
    // is right. It does not follow that every passenger's mobile number
    // belongs in a list view — the number is served to the one person who
    // needs to ring them at a busy pickup.
    //
    // **This is the test that guards the resource.** Every other reader is
    // already refused the trip outright by `TripPolicy::view`, so this is
    // the only path on which the guard is the thing standing in the way.
    //
    // Mutation check: delete the `driver?->user_id !== $user->id` check in
    // TripResource::passengerContactFor() and this test fails.
    $response = $this->actingAs($dispatcher, 'sanctum')->getJson('/api/v1/trips')->assertOk();

    foreach ($response->json('data') as $trip) {
        expect($trip['passenger_contact'])->toBeNull();
    }
});

it('never reveals contacts on a corporate trip', function () {
    $tenant = Tenant::factory()->create();
    $driverUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $driverUser->id]);

    $trip = Trip::factory()
        ->forTenant($tenant)
        ->forVehicle(Vehicle::factory()->create())
        ->forDriver($driver)
        ->create(['status' => TripStatus::ACCEPTED]);

    TripEvent::create([
        'tenant_id' => $tenant->id, 'trip_id' => $trip->id, 'from_status' => null,
        'to_status' => TripStatus::ASSIGNED, 'user_id' => null, 'notes' => null,
    ]);

    // A client's passenger is the client's business, and their details live
    // in the client's own systems. ADR-0024 is not the place to start
    // publishing them.
    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->assertJsonPath('data.passenger_contact', null);
});

it('gives the customer the captain and a number to ring', function () {
    [$customer, , $driver, $trip] = walkInTripInProgress();

    $this->withToken($customer->createToken('customer')->plainTextToken)
        ->getJson('/api/v1/customer/rides/active')
        ->assertOk()
        ->assertJsonPath('data.phase', TripStatus::ACCEPTED->value)
        ->assertJsonPath('data.trip_id', $trip->id)
        ->assertJsonPath('data.captain.name', $driver->name)
        ->assertJsonPath('data.captain.phone', '+256700000111');
});

it('takes the captain\'s number away when the ride is over', function () {
    [$customer] = walkInTripInProgress(TripStatus::TRIP_COMPLETED);

    // `trip_completed` is deliberately still "live" for contact purposes —
    // it is exactly when a passenger rings back about a bag on the seat —
    // but the ride itself is finished, so it is no longer the *active* one
    // and the screen returns to the order form.
    $this->withToken($customer->createToken('customer')->plainTextToken)
        ->getJson('/api/v1/customer/rides/active')
        ->assertOk()
        ->assertJsonPath('data', null);
});

it('never shows one customer another customer\'s ride', function () {
    walkInTripInProgress();
    $stranger = Customer::factory()->create();

    // The scope is the authorization: the query starts from the token's own
    // customer_id, so there is no "may this customer see that ride"
    // question left for a policy to get wrong.
    $this->withToken($stranger->createToken('customer')->plainTextToken)
        ->getJson('/api/v1/customer/rides/active')
        ->assertOk()
        ->assertJsonPath('data', null);
});

it('reports the search phase before any driver has accepted', function () {
    $customer = Customer::factory()->create();

    OrderRequest::factory()->create([
        'customer_id' => $customer->id,
        'trip_id' => null,
        'scheduled_for' => null,
    ]);

    $this->withToken($customer->createToken('customer')->plainTextToken)
        ->getJson('/api/v1/customer/rides/active')
        ->assertOk()
        // `RidePhase`'s own vocabulary, so the client's mapping stays an
        // identity function rather than a translation table.
        ->assertJsonPath('data.phase', 'searching')
        ->assertJsonPath('data.captain', null);
});
