<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\User;
use Modules\Bookings\Models\OrderRequest;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;
use Tests\Support\BillingFixtures;

/**
 * What the driver's pickup screen reads off a trip — `GET /trips/{id}`.
 *
 * Three fields, added so `PickupScreen` could draw a map and state a fare
 * without inventing either. All three go wrong quietly rather than loudly,
 * which is why they are asserted here:
 *
 * - **`pickup`/`dropoff` coordinates are all-or-nothing.** Half a position
 *   is not a place, and a client that filled the missing half with a zero
 *   would put a Kampala vehicle at 0°N 0°E — in the Atlantic off Ghana, the
 *   same spot ADR-0020 records a latitude/longitude swap landing one.
 * - **`estimated_fare` must be bounded to `show`.** It reaches into Billing,
 *   and `TripResource` also renders list endpoints — an unbounded quote is a
 *   query per row on a dispatch board.
 * - **A quote and a bill must not wear the same label.** `fare` is the
 *   settled figure and `estimated_fare` the quote (ADR-0026 §2); a screen
 *   that confused them would show a passenger an estimate as a charge.
 *
 * Coordinates are Kampala: 0.3476 N, 32.5825 E is the city centre, and 0.02
 * of latitude is roughly 2.2 km.
 *
 * @return array{0: User, 1: Trip, 2: OrderRequest}
 */
function walkInTripWithPins(array $orderOverrides = [], array $tripOverrides = []): array
{
    $customer = Customer::factory()->create(['first_name' => 'Sarah', 'last_name' => 'N']);
    $driverUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $driverUser->id]);

    $trip = Trip::factory()
        ->forCustomer($customer)
        ->forVehicle(Vehicle::factory()->create(['category' => 'sedan', 'status' => 'active']))
        ->forDriver($driver)
        ->create([
            'origin' => 'Acacia Mall, 14-18 Cooper Rd',
            'destination' => 'Kololo Airstrip',
            'status' => TripStatus::DRIVER_EN_ROUTE,
            ...$tripOverrides,
        ]);

    $order = OrderRequest::factory()->create([
        'customer_id' => $customer->id,
        'trip_id' => $trip->id,
        'pickup_location' => 'Acacia Mall, 14-18 Cooper Rd',
        'pickup_latitude' => 0.3476,
        'pickup_longitude' => 32.5825,
        'dropoff_location' => 'Kololo Airstrip',
        'dropoff_latitude' => 0.3676,
        'dropoff_longitude' => 32.5825,
        'scheduled_for' => null,
        ...$orderOverrides,
    ]);

    return [$driverUser, $trip, $order];
}

// ── The two places ───────────────────────────────────────────────────────

it('serves both ends with the coordinates the order was pinned at', function () {
    [$driverUser, $trip] = walkInTripWithPins();

    $payload = $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->json('data');

    expect($payload['pickup']['label'])->toBe('Acacia Mall, 14-18 Cooper Rd');
    expect($payload['pickup']['latitude'])->toBe(0.3476);
    expect($payload['pickup']['longitude'])->toBe(32.5825);
    expect($payload['dropoff']['latitude'])->toBe(0.3676);

    // `origin` and `destination` are untouched. AGENTS.md allows additive
    // changes within a version and no removals; every existing client reads
    // those two.
    expect($payload['origin'])->toBe('Acacia Mall, 14-18 Cooper Rd');
    expect($payload['destination'])->toBe('Kololo Airstrip');
});

it('serves a label and no coordinates for an order taken over the phone', function () {
    // The ordinary case for anything a dispatcher keyed in. The label still
    // arrives; the map simply does not draw.
    [$driverUser, $trip] = walkInTripWithPins([
        'pickup_latitude' => null,
        'pickup_longitude' => null,
        'dropoff_latitude' => null,
        'dropoff_longitude' => null,
    ]);

    $payload = $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->json('data');

    expect($payload['pickup']['label'])->toBe('Acacia Mall, 14-18 Cooper Rd');
    expect($payload['pickup']['latitude'])->toBeNull();
    expect($payload['pickup']['longitude'])->toBeNull();
});

it('refuses to serve half a position', function () {
    // The sharpest of the three, because it is the one a client cannot
    // defend against: given a latitude and no longitude, the tempting fix is
    // `?? 0`, and zero longitude at Uganda's latitude is the Atlantic.
    // Withholding both is what makes "is this place located" one question.
    [$driverUser, $trip] = walkInTripWithPins(['pickup_longitude' => null]);

    $payload = $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->json('data');

    expect($payload['pickup']['latitude'])->toBeNull();
    expect($payload['pickup']['longitude'])->toBeNull();
});

it('serves no coordinates for a corporate trip, which has no order behind it', function () {
    $driverUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $driverUser->id]);

    $trip = Trip::factory()
        ->forVehicle(Vehicle::factory()->create(['status' => 'active']))
        ->forDriver($driver)
        ->create(['origin' => 'Head office', 'destination' => 'Entebbe', 'status' => TripStatus::DRIVER_EN_ROUTE]);

    $payload = $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->json('data');

    expect($payload['pickup']['label'])->toBe('Head office');
    expect($payload['pickup']['latitude'])->toBeNull();
});

// ── The money ────────────────────────────────────────────────────────────

it('quotes an unsettled walk-in from the public tariff, flagged as an estimate', function () {
    BillingFixtures::publicTariff(['sedan' => [2_000, 1_500]]);

    [$driverUser, $trip] = walkInTripWithPins();

    $payload = $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->json('data');

    // 2,000 base + ~2.2 km x 1,500. A range, not a figure to the shilling —
    // pinning it would be a test of the haversine, which `WalkInFareTest`
    // already owns.
    expect($payload['estimated_fare']['total_minor'])->toBeGreaterThan(5_000);
    expect($payload['estimated_fare']['total_minor'])->toBeLessThan(5_500);
    expect($payload['estimated_fare']['is_estimate'])->toBeTrue();

    // Nothing has been charged yet, so there is no fare — not a zero, which
    // would read as a free ride.
    expect($payload['fare'])->toBeNull();
});

it('stops quoting once a real fare exists, so no screen shows both', function () {
    BillingFixtures::publicTariff(['sedan' => [2_000, 1_500]]);

    [$driverUser, $trip] = walkInTripWithPins([], [
        'status' => TripStatus::TRIP_COMPLETED,
        'fare_minor' => 12_500,
        'fare_currency' => 'UGX',
        'fare_computed_at' => now(),
    ]);

    $payload = $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->json('data');

    expect($payload['fare']['total_minor'])->toBe(12_500);
    // The counterpart of the always-true flag on the estimate, carried so a
    // client never has to infer which of the two it is holding.
    expect($payload['fare']['is_estimate'])->toBeFalse();

    expect($payload['estimated_fare'])->toBeNull();
});

it('shows no figure rather than a zero when nobody has published a tariff', function () {
    // Caught rather than propagated: an unpriced category must cost this trip
    // a figure, not the whole request a 500. The loud failure ADR-0026 wants
    // belongs in `settle()`, where money changes hands.
    [$driverUser, $trip] = walkInTripWithPins();

    $payload = $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->json('data');

    expect($payload['estimated_fare'])->toBeNull();
    expect($payload['fare'])->toBeNull();
});

it('does not quote on the trips list, which would be a query per row', function () {
    BillingFixtures::publicTariff(['sedan' => [2_000, 1_500]]);

    [$driverUser, $trip] = walkInTripWithPins();

    $row = collect(
        $this->actingAs($driverUser, 'sanctum')
            ->getJson('/api/v1/trips')
            ->assertOk()
            ->json('data')
    )->firstWhere('id', $trip->id);

    expect($row)->not->toBeNull();

    // The bound `TripResource::estimatedFare()` documents: the list does not
    // load the order request, so it pays for no quotes. The single-trip
    // endpoint above is where the figure lives.
    expect($row['estimated_fare'])->toBeNull();
    expect($row['pickup']['latitude'])->toBeNull();
});
