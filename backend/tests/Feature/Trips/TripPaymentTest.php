<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\User;
use Modules\Bookings\Models\OrderRequest;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * `Trip.payment` — how the job settles, for the driver still carrying it.
 *
 * The offer card already showed this and the trip did not, which meant the
 * fact was available for the fifteen seconds a driver had to answer and gone
 * by the time they reached the drop-off an hour later. A driver carrying no
 * float needs to know it is cash *before* they arrive.
 *
 * **The reason this file exists rather than one more assertion elsewhere is
 * the column it reads.** `order_requests.details` is filled by an
 * unauthenticated public endpoint (ADR-0012 §3) and holds `sender_phone` and
 * `recipient_phone` beside the harmless keys. Emitting it wholesale leaks two
 * numbers ADR-0024 §7 withholds and looks completely innocent in review,
 * because the field is called `details`. `Modules\Bookings\Support\
 * OrderDetails` is the single allow-listed reader; the leak test below is the
 * one that must never be deleted.
 *
 * @return array{0: User, 1: Trip}
 */
function walkInTripWithPayment(array $details = []): array
{
    $customer = Customer::factory()->create(['first_name' => 'Sarah', 'last_name' => 'N']);
    $driverUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $driverUser->id]);

    $trip = Trip::factory()
        ->forCustomer($customer)
        ->forVehicle(Vehicle::factory()->create(['category' => 'sedan', 'status' => 'active']))
        ->forDriver($driver)
        ->create([
            'origin' => 'Acacia Mall',
            'destination' => 'Kololo Airstrip',
            'status' => TripStatus::TRIP_STARTED,
        ]);

    OrderRequest::factory()->create([
        'customer_id' => $customer->id,
        'trip_id' => $trip->id,
        'scheduled_for' => null,
        'details' => $details,
    ]);

    return [$driverUser, $trip];
}

it('tells the driver how the ride settles while they are still driving it', function () {
    // `receiver`, not `passenger`. `StorePublicOrderRequest` validates
    // `details.payer` as `Rule::in(['sender', 'receiver'])` — that form is
    // the only writer of the column — so "passenger" is a value the platform
    // cannot produce, and the spec enumerates the two that it can.
    //
    // The fixture said `passenger` and passed until the response was checked
    // against `docs/api/openapi.yaml`, which is the whole argument for
    // validating responses rather than only asserting on them: an assertion
    // agrees with whatever the fixture invented.
    [$driverUser, $trip] = walkInTripWithPayment([
        'payment_method' => 'cash',
        'payer' => 'receiver',
    ]);

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->assertJsonPath('data.payment.payment_method', 'cash')
        ->assertJsonPath('data.payment.payer', 'receiver');
});

it('lets no other key of details ride along with the two it is allowed', function () {
    // The load-bearing test in this file. `details` is public-facing input,
    // so a key added to the order form must default to *not* shipping.
    [$driverUser, $trip] = walkInTripWithPayment([
        'payment_method' => 'mobile_money',
        'sender_phone' => '+256700000001',
        'recipient_phone' => '+256700000002',
        'item_type' => 'documents',
    ]);

    $response = $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk();

    expect(array_keys($response->json('data.payment')))
        ->toEqualCanonicalizing(['payment_method', 'payer']);

    // Asserted against the whole encoded payload, not just the payment block:
    // a leak that appears under some *other* key is the failure this is
    // guarding, and checking only `data.payment` would miss it entirely.
    expect($response->getContent())
        ->not->toContain('+256700000001')
        ->not->toContain('+256700000002');
});

it('says nothing rather than guessing cash when nobody stated a method', function () {
    // A driver who arrives expecting notes and is offered a transfer they
    // have no wallet for has been told something the platform never knew.
    [$driverUser, $trip] = walkInTripWithPayment([]);

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->assertJsonPath('data.payment.payment_method', null)
        ->assertJsonPath('data.payment.payer', null);
});

it('serves no payment block at all on a corporate trip, which settles by invoice', function () {
    // Not an object full of nulls. A client's work is invoiced under
    // ADR-0024 §7; there is no per-trip cash for a driver to collect, and a
    // payment row on one would be inventing a transaction.
    $driverUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $driverUser->id]);

    $trip = Trip::factory()
        ->forVehicle(Vehicle::factory()->create(['category' => 'sedan', 'status' => 'active']))
        ->forDriver($driver)
        ->create(['status' => TripStatus::TRIP_STARTED]);

    $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->assertJsonPath('data.payment', null);
});

it('does not read the order on the trips list, which would be a query per row', function () {
    // The same bound `estimated_fare` carries. `TripResource` renders list
    // endpoints too, and reaching for the order on each row is how a
    // dispatch board of fifty trips becomes fifty extra queries.
    [$driverUser, $trip] = walkInTripWithPayment(['payment_method' => 'cash']);

    $response = $this->actingAs($driverUser, 'sanctum')
        ->getJson('/api/v1/trips')
        ->assertOk();

    $row = collect($response->json('data'))->firstWhere('id', $trip->id);

    expect($row)->not->toBeNull();
    expect($row['payment'])->toBeNull();
});
