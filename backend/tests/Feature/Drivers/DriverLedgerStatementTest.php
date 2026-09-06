<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\User;
use Modules\Bookings\Enums\OrderRequestServiceType;
use Modules\Bookings\Models\OrderRequest;
use Modules\Drivers\Enums\LedgerEntryKind;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Models\DriverLedgerEntry;
use Modules\Drivers\Services\DriverLedgerService;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * `GET /me/ledger-entries` — the driver's wallet statement.
 *
 * The gap ADR-0029 left open: the ledger was the record of what a driver is
 * owed and nothing exposed it. `/me/stats` said *what* the balance is,
 * `/me/earnings` said what a period totalled, and neither could answer "why
 * is my balance that?" — the only question a driver has about it.
 *
 * What is asserted here is mostly the seams where a statement goes wrong
 * quietly:
 *
 * - **`cash_collected` must be served.** It is the negative half of the pair
 *   written at completion, and hiding it makes a prettier list that does not
 *   sum to the balance above it.
 * - **The sign must survive.** Positive is owed to the driver, negative is
 *   owed by them, and `settlement` legitimately runs both ways — so a client
 *   must never infer direction from `kind`.
 * - **Ordering must be unique.** The pair shares a timestamp to the second,
 *   so a cursor over `created_at` alone can skip or repeat a row.
 * - **It is one driver's own ledger** and read-only.
 */
function statementDriver(): array
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $user->id]);

    return [$user, $driver];
}

/** A completed trip credited through the real service, optionally classified. */
function statementTrip(
    Driver $driver,
    int $fareMinor = 10_000,
    ?OrderRequestServiceType $serviceType = OrderRequestServiceType::RIDE,
): Trip {
    $customer = Customer::factory()->create();

    $trip = Trip::factory()
        ->forCustomer($customer)
        ->forVehicle(Vehicle::factory()->create(['category' => 'sedan', 'status' => 'active']))
        ->forDriver($driver)
        ->create([
            'status' => TripStatus::TRIP_COMPLETED,
            'fare_minor' => $fareMinor,
            'fare_currency' => 'UGX',
            'fare_computed_at' => now(),
        ]);

    if ($serviceType !== null) {
        OrderRequest::factory()->create([
            'customer_id' => $customer->id,
            'trip_id' => $trip->id,
            'service_type' => $serviceType,
            'scheduled_for' => null,
        ]);
    }

    // Through the service, not by writing rows: the entries are then whatever
    // `DriverLedgerService` says they are, including the commission split.
    app(DriverLedgerService::class)->recordCompletedTrip($trip);

    return $trip;
}

// -- The pair -------------------------------------------------------------

it('serves both halves of a completed trip, not only the credit', function () {
    [$user, $driver] = statementDriver();
    statementTrip($driver, 10_000);

    $rows = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/ledger-entries')
        ->assertOk()
        ->json('data');

    $byKind = collect($rows)->keyBy('kind');

    // 20% commission: the driver earned 8,000 and is holding 10,000.
    expect($byKind[LedgerEntryKind::FARE_EARNED->value]['amount_minor'])->toBe(8_000);
    expect($byKind[LedgerEntryKind::CASH_COLLECTED->value]['amount_minor'])->toBe(-10_000);

    // And they net to the commission the driver now owes — which is what the
    // balance on the home screen shows. A statement that omitted the debit
    // would not reconcile with it.
    expect(collect($rows)->sum('amount_minor'))->toBe(-2_000);
});

it('keeps the sign, because direction cannot be inferred from the kind', function () {
    [$user, $driver] = statementDriver();

    // A settlement in each direction — the one kind that legitimately runs
    // both ways, which is why ADR-0029 §2 replaced a one-way `payout`.
    DriverLedgerEntry::create([
        'driver_id' => $driver->getKey(),
        'kind' => LedgerEntryKind::SETTLEMENT,
        'amount_minor' => 40_000,
        'currency' => 'UGX',
        'description' => 'Cash remitted at the depot',
    ]);

    DriverLedgerEntry::create([
        'driver_id' => $driver->getKey(),
        'kind' => LedgerEntryKind::SETTLEMENT,
        'amount_minor' => -15_000,
        'currency' => 'UGX',
        'description' => 'Paid out to the driver',
    ]);

    $rows = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/ledger-entries')
        ->assertOk()
        ->json('data');

    $amounts = collect($rows)->pluck('amount_minor')->sort()->values()->all();

    expect($amounts)->toBe([-15_000, 40_000]);
    // Same kind, opposite directions. A client reading direction off `kind`
    // would render one of these backwards.
    expect(collect($rows)->pluck('kind')->unique()->all())->toBe([
        LedgerEntryKind::SETTLEMENT->value,
    ]);
});

// -- What each row says ---------------------------------------------------

it('names the kind in the server’s own words rather than leaving a client to', function () {
    [$user, $driver] = statementDriver();
    statementTrip($driver);

    $rows = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/ledger-entries')
        ->assertOk()
        ->json('data');

    expect(collect($rows)->pluck('kind_label')->sort()->values()->all())
        ->toBe(['Cash collected', 'Fare earned']);
});

it('carries the commission rate that applied, in the description', function () {
    // ADR-0029 §3: the rate in force at completion is written into the entry,
    // which is what lets a driver read an old row and see the rate that
    // actually applied rather than the one set today.
    [$user, $driver] = statementDriver();
    $trip = statementTrip($driver, 10_000);

    $rows = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/ledger-entries')
        ->assertOk()
        ->json('data');

    $earned = collect($rows)->firstWhere('kind', LedgerEntryKind::FARE_EARNED->value);

    expect($earned['description'])->toBe("Fare for trip #{$trip->id} at 20% commission");
    expect($earned['trip_id'])->toBe($trip->id);
});

it('says whether a fare was a ride or a delivery', function () {
    [$user, $driver] = statementDriver();
    statementTrip($driver, 10_000, OrderRequestServiceType::DELIVERY);

    $rows = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/ledger-entries')
        ->assertOk()
        ->json('data');

    // Both halves of the pair belong to the same trip, so both carry it.
    expect(collect($rows)->pluck('service_type')->unique()->all())->toBe(['delivery']);
});

it('serves no service type for a trip nobody classified', function () {
    // A walk-in a dispatcher fulfilled by hand: real earnings, no order
    // request, so it cannot be called a ride or a delivery. The app falls
    // back to the kind label, which is always true.
    [$user, $driver] = statementDriver();
    statementTrip($driver, 10_000, null);

    $rows = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/ledger-entries')
        ->assertOk()
        ->json('data');

    expect(collect($rows)->pluck('service_type')->unique()->all())->toBe([null]);
});

it('serves no service type on a settlement, which has no trip behind it', function () {
    [$user, $driver] = statementDriver();

    DriverLedgerEntry::create([
        'driver_id' => $driver->getKey(),
        'kind' => LedgerEntryKind::SETTLEMENT,
        'amount_minor' => 40_000,
        'currency' => 'UGX',
        'description' => 'Cash remitted at the depot',
    ]);

    $rows = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/ledger-entries')
        ->assertOk()
        ->json('data');

    expect($rows[0]['trip_id'])->toBeNull();
    expect($rows[0]['service_type'])->toBeNull();
});

// -- Order and paging -----------------------------------------------------

it('reads newest first, because a statement is read from the top', function () {
    [$user, $driver] = statementDriver();

    foreach ([1_000, 2_000, 3_000] as $amount) {
        DriverLedgerEntry::create([
            'driver_id' => $driver->getKey(),
            'kind' => LedgerEntryKind::SETTLEMENT,
            'amount_minor' => $amount,
            'currency' => 'UGX',
            'description' => "Remittance of {$amount}",
        ]);
    }

    $rows = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/ledger-entries')
        ->assertOk()
        ->json('data');

    expect(collect($rows)->pluck('amount_minor')->all())->toBe([3_000, 2_000, 1_000]);
});

it('pages without skipping or repeating a row of the completion pair', function () {
    // The reason the order is `id` and not `created_at`: both halves of a
    // completion are written in one transaction and share a timestamp to the
    // second, so a cursor over the timestamp alone has an undefined order
    // within the pair and can drop one across a page boundary.
    [$user, $driver] = statementDriver();

    // 15 trips == 30 entries == two pages at 25.
    for ($i = 0; $i < 15; $i++) {
        statementTrip($driver, 10_000);
    }

    $first = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/ledger-entries')
        ->assertOk();

    $firstIds = collect($first->json('data'))->pluck('id');
    $cursor = $first->json('meta.cursor.next');

    expect($firstIds)->toHaveCount(25);
    expect($cursor)->not->toBeNull();

    $secondIds = collect(
        $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/me/ledger-entries?cursor='.$cursor)
            ->assertOk()
            ->json('data')
    )->pluck('id');

    expect($secondIds)->toHaveCount(5);

    $all = $firstIds->concat($secondIds);

    // Every row exactly once — none skipped, none repeated.
    expect($all->unique())->toHaveCount(30);
    expect($all->all())->toBe($all->sortDesc()->values()->all());
});

it('says there is no next page at the end', function () {
    [$user, $driver] = statementDriver();
    statementTrip($driver);

    $response = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/ledger-entries')
        ->assertOk();

    expect($response->json('meta.cursor.next'))->toBeNull();
});

it('answers an empty statement without inventing a row', function () {
    [$user] = statementDriver();

    $response = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/ledger-entries')
        ->assertOk();

    expect($response->json('data'))->toBe([]);
    expect($response->json('meta.cursor.next'))->toBeNull();
});

// -- Filtering by date ----------------------------------------------------

it('narrows to a range, measured in the driver’s local day', function () {
    // Kampala is UTC+3, so 01:00 local on the 16th is 22:00 UTC on the 15th.
    // A UTC-boundary filter would file it under the 15th and a driver asking
    // for "the 16th" would not see their own late-night work.
    [$user, $driver] = statementDriver();

    foreach ([
        '2026-08-15 20:00:00',   // 23:00 local on the 15th
        '2026-08-15 22:00:00',   // 01:00 local on the 16th
        '2026-08-16 09:00:00',   // 12:00 local on the 16th
    ] as $index => $at) {
        $entry = DriverLedgerEntry::create([
            'driver_id' => $driver->getKey(),
            'kind' => LedgerEntryKind::SETTLEMENT,
            'amount_minor' => ($index + 1) * 1_000,
            'currency' => 'UGX',
            'description' => "Entry {$index}",
        ]);

        $entry->forceFill(['created_at' => $at, 'updated_at' => $at])->save();
    }

    $rows = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/ledger-entries?from=2026-08-16&to=2026-08-16')
        ->assertOk()
        ->json('data');

    // The 01:00 and the 12:00, not the 23:00 of the night before.
    expect(collect($rows)->pluck('amount_minor')->sort()->values()->all())->toBe([2_000, 3_000]);
});

it('includes the whole of the day named as `to`', function () {
    // An exclusive upper bound at 00:00 would make picking a single day
    // return nothing at all — the most obvious thing a driver will try.
    [$user, $driver] = statementDriver();

    $entry = DriverLedgerEntry::create([
        'driver_id' => $driver->getKey(),
        'kind' => LedgerEntryKind::SETTLEMENT,
        'amount_minor' => 5_000,
        'currency' => 'UGX',
        'description' => 'Late in the day',
    ]);

    // 20:00 local on the 15th.
    $entry->forceFill(['created_at' => '2026-08-15 17:00:00', 'updated_at' => '2026-08-15 17:00:00'])->save();

    $rows = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/ledger-entries?from=2026-08-15&to=2026-08-15')
        ->assertOk()
        ->json('data');

    expect($rows)->toHaveCount(1);
});

it('refuses a range that runs backwards, rather than silently returning nothing', function () {
    [$user] = statementDriver();

    $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/ledger-entries?from=2026-08-16&to=2026-08-15')
        ->assertStatus(422);
});

it('refuses a date it cannot read', function () {
    [$user] = statementDriver();

    $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/ledger-entries?from=last-tuesday')
        ->assertStatus(422);
});

// -- Who may read it ------------------------------------------------------

it('never shows one driver another driver’s ledger', function () {
    [$user, $driver] = statementDriver();
    [, $other] = statementDriver();

    statementTrip($driver, 10_000);
    statementTrip($other, 99_000);

    $rows = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/ledger-entries')
        ->assertOk()
        ->json('data');

    // Two rows, both this driver's. The other driver's 99,000 fare would be
    // unmistakable if the scope leaked.
    expect($rows)->toHaveCount(2);
    expect(collect($rows)->pluck('amount_minor')->sort()->values()->all())
        ->toBe([-10_000, 8_000]);
});

it('refuses an account with no driver profile', function () {
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);

    $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/ledger-entries')
        ->assertStatus(403);
});

it('offers no way for a driver to write to their own ledger', function () {
    // ADR-0029 §6: the platform records money moving rather than moving it.
    // No withdrawal, no top-up, and a settlement is the office's to write —
    // so there is deliberately no POST here, and the mockup's Withdraw and
    // Add Money buttons had nowhere to go.
    [$user] = statementDriver();

    $this->actingAs($user, 'sanctum')
        ->postJson('/api/v1/me/ledger-entries', ['amount_minor' => 50_000])
        ->assertStatus(405);
});

// -- The N+1 bound --------------------------------------------------------

it('reads a full page without a query per row', function () {
    [$user, $driver] = statementDriver();

    for ($i = 0; $i < 10; $i++) {
        statementTrip($driver, 10_000);
    }

    DB::enableQueryLog();

    $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/ledger-entries')
        ->assertOk();

    $queries = count(DB::getQueryLog());
    DB::disableQueryLog();

    // 20 rows across 10 trips. Unbounded, the resource would lazily load a
    // trip and an order request per row — 40 extra queries. `with('trip.
    // orderRequest')` makes it two, whatever the page holds.
    expect($queries)->toBeLessThan(15);
});
