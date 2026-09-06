<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\Tenant;
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
 * `GET /me/trips` — the driver's own trip history.
 *
 * What is asserted here is the set of ways a history goes wrong *quietly* —
 * every one of these produces a plausible list:
 *
 * - **The tenant scope silently eats walk-ins.** `TenantScope` fails closed,
 *   and a walk-in has no tenant, so the obvious query returns a shorter list
 *   with no error anywhere. This is the trap that cost `/me/ledger-entries` a
 *   test, and the first case below exists because of it.
 * - **The money must be the driver's share, not the gross fare.** A list that
 *   showed gross would look richer and would not add up to `/me/earnings`.
 * - **Cancelled trips must appear, with no money on them.** `UGX 0` reads as a
 *   job done for free; the owner ruled the rows in and the figure out.
 * - **One driver's history is never another's**, in either the trips or the
 *   earnings joined onto them.
 * - **The day heading must be the fleet's day**, not UTC's. A UTC boundary
 *   files a Kampala evening under yesterday.
 */
function historyDriver(): array
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $user->id]);

    return [$user, $driver];
}

/**
 * A walk-in trip for this driver — no tenant, a customer, optionally an order
 * request that classifies it and optionally credited through the real ledger
 * service.
 */
function historyTrip(
    Driver $driver,
    TripStatus $status = TripStatus::TRIP_COMPLETED,
    ?OrderRequestServiceType $serviceType = OrderRequestServiceType::RIDE,
    ?int $fareMinor = 10_000,
    ?string $completedAt = null,
): Trip {
    $customer = Customer::factory()->create();

    $trip = Trip::factory()
        ->forCustomer($customer)
        ->forVehicle(Vehicle::factory()->create(['category' => 'sedan', 'status' => 'active']))
        ->forDriver($driver)
        ->create([
            'status' => $status,
            'fare_minor' => $fareMinor,
            'fare_currency' => $fareMinor === null ? null : 'UGX',
            'fare_computed_at' => $fareMinor === null ? null : now(),
            'completed_at' => $completedAt ?? ($status === TripStatus::TRIP_COMPLETED ? now() : null),
        ]);

    if ($serviceType !== null) {
        OrderRequest::factory()->create([
            'customer_id' => $customer->id,
            'trip_id' => $trip->id,
            'service_type' => $serviceType,
            'scheduled_for' => null,
        ]);
    }

    if ($fareMinor !== null && $status === TripStatus::TRIP_COMPLETED) {
        // Through the service, never by writing rows: the entry is then
        // whatever `DriverLedgerService` says it is, commission included, and
        // a change to that rule changes this fixture with it.
        app(DriverLedgerService::class)->recordCompletedTrip($trip);
    }

    return $trip;
}

// -- The scope that fails closed ------------------------------------------

it('serves a walk-in trip, which the tenant scope would silently drop', function () {
    [$user, $driver] = historyDriver();
    historyTrip($driver);

    $rows = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/trips')
        ->assertOk()
        ->json('data');

    // The whole point: a walk-in has `tenant_id` null, the driver has no
    // tenant bound, and `TenantScope` answers `1 = 0` to anything that has
    // not opted out. One row here means `Trip::forDriver()` did.
    expect($rows)->toHaveCount(1);
});

it('never shows one driver another driver’s trips', function () {
    [$user, $driver] = historyDriver();
    [, $other] = historyDriver();

    historyTrip($driver);
    historyTrip($other);
    historyTrip($other);

    $rows = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/trips')
        ->assertOk()
        ->json('data');

    expect($rows)->toHaveCount(1);
});

it('refuses an account with no driver profile', function () {
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);

    $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/trips')
        ->assertForbidden()
        ->assertJsonPath('code', 'NOT_A_DRIVER');
});

// -- The money -------------------------------------------------------------

it('shows what the driver earned, not what the passenger paid', function () {
    [$user, $driver] = historyDriver();
    historyTrip($driver, fareMinor: 10_000);

    $row = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/trips')
        ->assertOk()
        ->json('data.0');

    // 20% commission by default, so the driver's share is 8,000 of a 10,000
    // fare. The gross figure must not be what a driver reads here — it would
    // overstate their take by a quarter and would not reconcile with
    // `/me/earnings`, which totals the same `fare_earned` entries.
    expect($row['earned_minor'])->toBeLessThan(10_000)
        ->and($row['earned_minor'])->toBeGreaterThan(0)
        ->and($row['currency'])->toBe('UGX');
});

it('adds up to exactly what the earnings endpoint reports', function () {
    [$user, $driver] = historyDriver();
    historyTrip($driver, fareMinor: 10_000);
    historyTrip($driver, fareMinor: 25_000);

    $rows = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/trips')
        ->assertOk()
        ->json('data');

    $earnings = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/earnings?period=day')
        ->assertOk()
        ->json('data');

    // The reconciliation that decided which figure this screen shows. Two
    // surfaces about one driver's pay disagreeing is the worst defect either
    // can carry, and it is invisible until somebody adds the list up.
    expect(array_sum(array_column($rows, 'earned_minor')))->toBe($earnings['total_minor']);
});

/**
 * A test I wrote and had to correct, recorded rather than deleted.
 *
 * It set out to prove that dropping `driver_id` from the earnings join would
 * show one driver another's pay. **It cannot**, and the reason is worth
 * knowing: `driver_ledger_entries` carries a unique index on
 * `(trip_id, kind)`, so two drivers can never both hold a `fare_earned` entry
 * for one trip — the insert is refused by the database. Combined with the
 * trip ids all coming from `Trip::forDriver()`, the `driver_id` predicate in
 * `earningsFor()` is defence in depth, not a live guard, and the controller
 * now says so instead of claiming otherwise.
 *
 * What is provable, and is what this asserts, is the layer above: `kind`. The
 * ledger writes a **pair** at completion — a positive `fare_earned` and a
 * negative `cash_collected` for the gross the driver is holding — and summing
 * both would report a finished ride as roughly minus the commission.
 */
it('reads the credit and not the cash the driver is holding', function () {
    [$user, $driver] = historyDriver();
    $trip = historyTrip($driver, fareMinor: 10_000);

    $credit = (int) DriverLedgerEntry::query()
        ->where('driver_id', $driver->getKey())
        ->where('trip_id', $trip->id)
        ->where('kind', LedgerEntryKind::FARE_EARNED)
        ->value('amount_minor');

    // The counterpart exists and is negative, so a join that took both would
    // land somewhere at or below zero rather than on the driver's share.
    $collected = (int) DriverLedgerEntry::query()
        ->where('trip_id', $trip->id)
        ->where('kind', LedgerEntryKind::CASH_COLLECTED)
        ->value('amount_minor');

    $row = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/trips')
        ->assertOk()
        ->json('data.0');

    expect($collected)->toBeLessThan(0)
        ->and($row['earned_minor'])->toBe($credit)
        ->and($row['earned_minor'])->not->toBe($credit + $collected);
});

it('renders a cancelled trip with no money rather than with a zero', function () {
    [$user, $driver] = historyDriver();
    historyTrip($driver, status: TripStatus::CANCELLED, fareMinor: null);

    $row = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/trips')
        ->assertOk()
        ->json('data.0');

    // Null, not 0. `docs/screen-rules.md` §1: "A zero is not a substitute for
    // unknown. `UGX 0` reads as a free ride."
    expect($row['status'])->toBe('cancelled')
        ->and($row['earned_minor'])->toBeNull()
        ->and($row['currency'])->toBeNull();
});

// -- Which trips are history ----------------------------------------------

it('includes the trips a driver was cancelled on, and excludes the live ones', function () {
    [$user, $driver] = historyDriver();

    historyTrip($driver, status: TripStatus::TRIP_COMPLETED);
    historyTrip($driver, status: TripStatus::CANCELLED, fareMinor: null);
    historyTrip($driver, status: TripStatus::NO_SHOW, fareMinor: null);
    // Live legs, each owned by a screen of its own — and an unanswered offer.
    historyTrip($driver, status: TripStatus::TRIP_STARTED, fareMinor: null);
    historyTrip($driver, status: TripStatus::DRIVER_EN_ROUTE, fareMinor: null);
    historyTrip($driver, status: TripStatus::ASSIGNED, fareMinor: null);

    $statuses = collect(
        $this->actingAs($user, 'sanctum')->getJson('/api/v1/me/trips')->assertOk()->json('data'),
    )->pluck('status')->sort()->values()->all();

    expect($statuses)->toBe(['cancelled', 'no_show', 'trip_completed']);
});

// -- The filter ------------------------------------------------------------

it('filters to one kind of job, in SQL rather than over the loaded page', function () {
    [$user, $driver] = historyDriver();

    historyTrip($driver, serviceType: OrderRequestServiceType::RIDE);
    historyTrip($driver, serviceType: OrderRequestServiceType::RIDE);
    historyTrip($driver, serviceType: OrderRequestServiceType::DELIVERY);

    $deliveries = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/trips?service_type=delivery')
        ->assertOk()
        ->json('data');

    expect($deliveries)->toHaveCount(1)
        ->and($deliveries[0]['service_type'])->toBe('delivery');
});

it('says which kind of job a trip was, and null when nothing can say', function () {
    [$user, $driver] = historyDriver();
    // No order request behind it — a walk-in a dispatcher fulfilled by hand.
    historyTrip($driver, serviceType: null);

    $row = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/trips')
        ->assertOk()
        ->json('data.0');

    expect($row['service_type'])->toBeNull();
});

// -- The day a row files under --------------------------------------------

it('files a row under the fleet’s local day, not under UTC’s', function () {
    [$user, $driver] = historyDriver();

    // 22:30 in Kampala on the 15th is 19:30 UTC on the 15th — but 00:30 UTC
    // on the 16th once you are two hours later. This instant is the one that
    // separates the two readings: 23:30 local on the 15th, which is 20:30 UTC
    // on the 15th. Pick an instant that is a *different date* in the two
    // zones to make the assertion bite.
    historyTrip($driver, completedAt: '2026-08-15T22:30:00Z');

    $body = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/trips')
        ->assertOk()
        ->json();

    // 22:30 UTC is 01:30 the next day in Kampala (UTC+3). A UTC day boundary
    // would file this under the 15th; the fleet's day files it under the
    // 16th, which is the day the driver would say they finished it.
    expect($body['data'][0]['local_day'])->toBe('2026-08-16')
        ->and($body['data'][0]['local_time'])->toBe('01:30')
        ->and($body['meta']['timezone'])->toBe('Africa/Kampala');
});

it('serves the day keys the app compares against, rather than leaving it to the handset', function () {
    [$user, $driver] = historyDriver();
    historyTrip($driver);

    $meta = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/trips')
        ->assertOk()
        ->json('meta');

    expect($meta)->toHaveKeys(['cursor', 'timezone', 'today', 'yesterday'])
        ->and($meta['today'])->toMatch('/^\d{4}-\d{2}-\d{2}$/')
        ->and($meta['yesterday'])->toMatch('/^\d{4}-\d{2}-\d{2}$/');
});

// -- Paging ----------------------------------------------------------------

it('pages without skipping or repeating a trip', function () {
    [$user, $driver] = historyDriver();

    // 26 trips over a page size of 25, all completed inside one second so a
    // cursor ordered on `completed_at` would have an undefined order to page
    // over. `id` descending cannot.
    for ($i = 0; $i < 26; $i++) {
        historyTrip($driver, fareMinor: null);
    }

    $first = $this->actingAs($user, 'sanctum')->getJson('/api/v1/me/trips')->assertOk()->json();

    expect($first['data'])->toHaveCount(25)
        ->and($first['meta']['cursor']['next'])->not->toBeNull();

    $second = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/trips?cursor='.$first['meta']['cursor']['next'])
        ->assertOk()
        ->json();

    $ids = array_merge(array_column($first['data'], 'id'), array_column($second['data'], 'id'));

    expect($second['data'])->toHaveCount(1)
        ->and($ids)->toHaveCount(26)
        ->and(array_unique($ids))->toHaveCount(26);
});

// -- What must never be on this screen ------------------------------------

it('carries no passenger contact, because a history is not a directory', function () {
    [$user, $driver] = historyDriver();
    historyTrip($driver);

    $row = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/trips')
        ->assertOk()
        ->json('data.0');

    // ADR-0024 §7 releases a name and number to a driver only while a trip is
    // live. A permanent, scrollable list of everyone they have carried is
    // exactly what that rule exists to prevent — and the payload is
    // `additionalProperties: false`, so the contract fails too.
    expect($row)->not->toHaveKey('passenger_contact')
        ->and($row)->not->toHaveKey('customer_id');
});

it('is reachable by a driver-scoped token', function () {
    [$user, $driver] = historyDriver();
    historyTrip($driver);

    // The allow-list in `ClientScope` fails closed, and it had already
    // stranded `/me/earnings` and `/me/ledger-entries`: the routes shipped,
    // the list did not follow, and nothing caught it because every other test
    // signs in without a `client` and gets an unscoped console token.
    $token = $user->createToken('driver-app', ['driver'])->plainTextToken;

    $this->withHeader('Authorization', 'Bearer '.$token)
        ->getJson('/api/v1/me/trips')
        ->assertOk();
});

it('does not leak a corporate client’s trip into a walk-in driver’s history as earnings', function () {
    [$user, $driver] = historyDriver();

    $tenant = Tenant::factory()->create();

    // A corporate trip is invoiced to the client; ADR-0029 §4 raises no
    // ledger pair for it, so there is no per-trip driver share to show. The
    // row still belongs in the history — the driver did the work — but the
    // money must be an em dash rather than a zero.
    Trip::factory()
        ->forVehicle(Vehicle::factory()->create(['category' => 'sedan', 'status' => 'active']))
        ->forDriver($driver)
        ->create([
            'tenant_id' => $tenant->id,
            'customer_id' => null,
            'status' => TripStatus::TRIP_COMPLETED,
            'completed_at' => now(),
        ]);

    $row = $this->actingAs($user, 'sanctum')
        ->getJson('/api/v1/me/trips')
        ->assertOk()
        ->json('data.0');

    expect($row['status'])->toBe('trip_completed')
        ->and($row['earned_minor'])->toBeNull();
});
