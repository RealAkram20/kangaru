<?php

use App\Models\Customer;
use App\Models\Tenant;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripRating;
use Modules\Vehicles\Models\Vehicle;

/**
 * `POST /customer/trips/{trip}/rating` — the passenger's stars (ADR-0030).
 *
 * This endpoint had no lifecycle coverage of its own: the only test that
 * touched it was the tenancy census's pin of W1-c-F5, the binding bug that
 * kept it 404 for everyone. The owner rated a real ride, nothing arrived,
 * and a green suite had nothing to say about it. These are the cases that
 * suite was missing.
 */
function ratedTrip(Customer $customer, TripStatus $status = TripStatus::TRIP_COMPLETED): Trip
{
    return Trip::factory()
        ->forTenant(Tenant::factory()->create())
        ->forVehicle(Vehicle::factory()->create())
        ->forDriver(Driver::factory()->create())
        ->create(['status' => $status, 'customer_id' => $customer->id]);
}

it('records the stars against the trip and the driver who earned them', function () {
    $customer = Customer::factory()->create();
    $trip = ratedTrip($customer);

    $this->actingAs($customer, 'customer')
        ->postJson("/api/v1/customer/trips/{$trip->id}/rating", ['stars' => 4, 'comment' => 'Smooth ride'])
        ->assertStatus(201)
        ->assertJsonPath('data.stars', 4);

    $rating = TripRating::query()->where('trip_id', $trip->id)->firstOrFail();

    expect($rating->stars)->toBe(4);
    expect($rating->customer_id)->toBe($customer->id);
    // Denormalised on purpose: reassigning the trip later must not move
    // this rating to a driver who did not earn it.
    expect($rating->driver_id)->toBe($trip->driver_id);
    expect($rating->comment)->toBe('Smooth ride');
});

it('refuses to rate a journey that has not happened yet', function () {
    $customer = Customer::factory()->create();
    $trip = ratedTrip($customer, TripStatus::TRIP_STARTED);

    $this->actingAs($customer, 'customer')
        ->postJson("/api/v1/customer/trips/{$trip->id}/rating", ['stars' => 5])
        ->assertStatus(422)
        ->assertJsonPath('message', 'You can rate a ride once it has been completed.');

    expect(TripRating::query()->where('trip_id', $trip->id)->exists())->toBeFalse();
});

it('refuses a second rating — a rating is immutable, not a lever', function () {
    $customer = Customer::factory()->create();
    $trip = ratedTrip($customer);

    $this->actingAs($customer, 'customer')
        ->postJson("/api/v1/customer/trips/{$trip->id}/rating", ['stars' => 2])
        ->assertStatus(201);

    $this->actingAs($customer, 'customer')
        ->postJson("/api/v1/customer/trips/{$trip->id}/rating", ['stars' => 5])
        ->assertStatus(422)
        ->assertJsonPath('message', 'You have already rated this ride. A rating cannot be changed.');

    expect(TripRating::query()->where('trip_id', $trip->id)->value('stars'))->toBe(2);
});

it('takes only one to five whole stars', function () {
    $customer = Customer::factory()->create();
    $trip = ratedTrip($customer);

    foreach ([0, 6, null] as $stars) {
        $this->actingAs($customer, 'customer')
            ->postJson("/api/v1/customer/trips/{$trip->id}/rating", ['stars' => $stars])
            ->assertStatus(422);
    }
});

it('still answers 404 for another customer\'s trip after the binding fix', function () {
    // The resolver widening that closed F5 must not have widened what a
    // customer can *reach*: the controller's own customer_id check is the
    // refusal now, and it masks the id exactly as the scope did.
    $customer = Customer::factory()->create();
    $stranger = Customer::factory()->create();
    $trip = ratedTrip($stranger);

    $this->actingAs($customer, 'customer')
        ->postJson("/api/v1/customer/trips/{$trip->id}/rating", ['stars' => 1])
        ->assertStatus(404)
        ->assertJsonPath('message', 'No such trip.');
});
