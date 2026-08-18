<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\User;
use Modules\Administration\Services\SettingsService;
use Modules\Drivers\Enums\LedgerEntryKind;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverLedgerEntry;
use Modules\Drivers\Services\DriverLedgerService;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * `Trip.earnings` — what the driver made, on `GET /trips/{id}`.
 *
 * The field the "Ride Complete" screen is built on, and the reason it exists
 * is that the figure was already in the database with no way out: ADR-0029's
 * ledger records a `fare_earned` entry per completed walk-in trip, keyed by
 * `trip_id`, and the only surface over it served *aggregates* (`/me/stats`).
 * So the one screen that must answer "what did I just make" could not.
 *
 * Four things go wrong quietly here, which is why each has a case:
 *
 * - **The commission must be derived, never recomputed.** ADR-0029 §2 writes
 *   no `commission` entry on purpose, and §3 forbids restating what a driver
 *   already earned when the rate changes. Deriving `gross - earned` from the
 *   rows actually written is what makes that hold years later.
 * - **It is the driver's, and nobody else's.** A dispatcher sees the board;
 *   what a driver takes home is not part of it, and a corporate client must
 *   never read the platform's margin on their work.
 * - **It must stay off the list endpoint.** The ledger relation is unbounded
 *   per row — loading it on `index` is the N+1 AGENTS.md forbids.
 * - **Absent is not zero.** Between a completion arriving and the listener
 *   crediting it, there is genuinely no figure. `UGX 0` would tell a driver
 *   they worked for nothing.
 *
 * Note the helper names: Pest's test helpers are plain global functions, so
 * `completedWalkInTrip` collided with `WalkInFareTest`'s at load time and took
 * the whole suite down with a fatal. Prefix anything declared in a test file.
 *
 * @return array{0: User, 1: Trip, 2: Driver}
 */
function earningsTrip(array $tripOverrides = []): array
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
            'status' => TripStatus::TRIP_COMPLETED,
            'fare_minor' => 12_500,
            'fare_currency' => 'UGX',
            'fare_computed_at' => now(),
            ...$tripOverrides,
        ]);

    return [$driverUser, $trip, $driver];
}

/**
 * Credit the trip the way the platform does — through the real service, not
 * by writing rows.
 *
 * The seeder made the same choice and for the same reason: the entries are
 * then whatever `DriverLedgerService` says they are, including the commission
 * split, so a change to that rule changes this test's inputs with it. A test
 * that hand-wrote `amount_minor` would go on passing after the rule moved.
 */
function creditEarningsTrip(Trip $trip): void
{
    app(DriverLedgerService::class)->recordCompletedTrip($trip);
}

// -- The figures ---------------------------------------------------------

it('serves the driver their own share, with the fee derived from what was recorded', function () {
    [$driverUser, $trip] = earningsTrip();
    creditEarningsTrip($trip);

    $payload = $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->json('data');

    // 20% of 12,500 is 2,500, and the driver takes the rest. The house
    // rounds against itself (ADR-0029 §3), so any remainder is theirs.
    expect($payload['earnings']['total_minor'])->toBe(12_500);
    expect($payload['earnings']['earned_minor'])->toBe(10_000);
    expect($payload['earnings']['commission_minor'])->toBe(2_500);
    expect($payload['earnings']['currency'])->toBe('UGX');

    // The three reconcile. This is the assertion the mockup for this screen
    // could not satisfy: it drew a fare, a fee and a total that did not add
    // up, and labelled the gross figure as the driver's earnings.
    expect($payload['earnings']['earned_minor'] + $payload['earnings']['commission_minor'])
        ->toBe($payload['earnings']['total_minor']);

    // The gross is still the fare the passenger paid. Two figures, two
    // fields, neither pretending to be the other.
    expect($payload['fare']['total_minor'])->toBe(12_500);
});

it('reports the rate in force when the trip completed, not the rate set later', function () {
    // ADR-0029 §3 by name: "Changing the setting must never restate what a
    // driver already earned — a retroactive commission change is the kind of
    // silent rewrite an audit trail cannot distinguish from theft."
    //
    // This passes only because the fee is derived from the recorded entry. A
    // resource that recomputed fare x percent would move this driver's
    // completed earnings the moment the office changed the number.
    [$driverUser, $trip] = earningsTrip();
    creditEarningsTrip($trip);

    app(SettingsService::class)->setGroup('billing', ['driver_commission_percent' => 50]);

    $payload = $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->json('data');

    expect($payload['earnings']['earned_minor'])->toBe(10_000);
    expect($payload['earnings']['commission_minor'])->toBe(2_500);
});

it('serves no earnings until the completion has actually been credited', function () {
    // The window the driver app spends most of its time in: completion goes
    // through the outbox, so the phone reaches this screen before the server
    // has the transition. An em dash and "not confirmed yet" is honest; a
    // zero would read as an unpaid job.
    [$driverUser, $trip] = earningsTrip();

    $payload = $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->json('data');

    expect($payload)->toHaveKey('earnings');
    expect($payload['earnings'])->toBeNull();
});

it('serves no earnings on a corporate trip, which raises no ledger entry at all', function () {
    // ADR-0029 §4: a corporate trip is invoiced to the client and carries no
    // per-trip fare, so there is nothing to split. Inventing one from a rate
    // card would be fabricating a number.
    $driverUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $driverUser->id]);

    $trip = Trip::factory()
        ->forVehicle(Vehicle::factory()->create(['status' => 'active']))
        ->forDriver($driver)
        ->create([
            'origin' => 'Head office',
            'destination' => 'Entebbe',
            'status' => TripStatus::TRIP_COMPLETED,
        ]);

    $payload = $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->json('data');

    expect($payload['earnings'])->toBeNull();
    expect($payload['fare'])->toBeNull();
});

// -- Who may read it -----------------------------------------------------

it('never shows one driver what another driver earned', function () {
    // The platform reader is the case that matters, because everyone else is
    // already refused the row outright by `TripPolicy::view`. A dispatcher
    // holding `trips.view.all` legitimately sees the whole board — it does
    // not follow that a driver's take-home belongs on it, and a corporate
    // client reading their own trips must never see the platform's margin.
    [, $trip] = earningsTrip();
    creditEarningsTrip($trip);

    $dispatcher = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    $payload = $this->actingAs($dispatcher, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->json('data');

    // The trip is readable and the fare is on it — that is the board doing
    // its job. The split is not.
    expect($payload['fare']['total_minor'])->toBe(12_500);
    expect($payload['earnings'])->toBeNull();
});

it('does not read the ledger on the trips list, which would be a query per row', function () {
    [$driverUser, $trip] = earningsTrip();
    creditEarningsTrip($trip);

    $row = collect(
        $this->actingAs($driverUser, 'sanctum')
            ->getJson('/api/v1/trips')
            ->assertOk()
            ->json('data')
    )->firstWhere('id', $trip->id);

    expect($row)->not->toBeNull();

    // Same bound `estimated_fare` carries: `show()` loads the relation and
    // `index()` does not, so the resource finds it unloaded and withholds
    // rather than lazily firing a query per row.
    expect($row['earnings'])->toBeNull();
});

// -- What the ledger actually holds ---------------------------------------

it('reads the credit back rather than deriving it from the fare', function () {
    // Proves the resource is reading the *entry*, not doing arithmetic on
    // `fare_minor`. An adjusted credit — the shape a correction takes under
    // ADR-0029's append-only rule — must be what the driver is shown.
    [$driverUser, $trip, $driver] = earningsTrip();

    DriverLedgerEntry::create([
        'driver_id' => $driver->id,
        'trip_id' => $trip->id,
        'kind' => LedgerEntryKind::FARE_EARNED,
        'amount_minor' => 11_000,
        'currency' => 'UGX',
        'description' => 'Fare for trip at a negotiated rate',
    ]);

    $payload = $this->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->json('data');

    // 11,000 of a 12,500 fare, so the fee is 1,500 — a figure no percentage
    // of 12,500 produces.
    expect($payload['earnings']['earned_minor'])->toBe(11_000);
    expect($payload['earnings']['commission_minor'])->toBe(1_500);
});
