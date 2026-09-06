<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\User;
use Modules\Bookings\Enums\OrderRequestServiceType;
use Modules\Bookings\Models\OrderRequest;
use Modules\Drivers\Models\Driver;
use Modules\Drivers\Services\DriverLedgerService;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * What the trip *record* reads off `GET /trips/{id}` — the four fields the
 * driver app's Trip Details screen needed and nothing served.
 *
 * The screen is one page for every kind of job, which is what forced these:
 *
 * - **`service_type`** — a delivery and a ride are different jobs, and a record
 *   that says neither is a record about nothing. It is a real column beside
 *   `order_requests.details`, never a key inside it.
 * - **`reference`** — the identifier the *customer* was given. The trip's `id`
 *   is the platform's; when somebody rings about a job, both ends have to be
 *   reading the same string.
 * - **`package`** — what was carried, on a delivery only. This is the field
 *   that goes near `details`, so it goes through the one allow-listed reader,
 *   and the case below proves the two withheld phone numbers do not follow it
 *   out.
 * - **`earnings.lines`** — the trip's own ledger rows. The mockup asked for a
 *   fare breakdown (base fare, distance, waiting) and there is none after the
 *   fact: `TripPricingEngine` is pure and writes nothing, so a walk-in stores
 *   one total. These are the rows that genuinely exist, and they are the
 *   driver's side of the money rather than the passenger's.
 *
 * `earnings` itself, its three figures and its driver gate are covered by
 * `TripEarningsTest`; this file asserts the gate again only where `lines`
 * carries something that file's payload does not.
 *
 * Helper names are prefixed: Pest's test helpers are plain global functions,
 * and an unprefixed `walkInTrip` has already collided across two files here and
 * taken the suite down with a fatal at load time.
 *
 * @return array{0: User, 1: Trip, 2: OrderRequest}
 */
function recordTrip(array $orderOverrides = [], array $tripOverrides = []): array
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
            'destination' => 'Kololo Hill Drive',
            'status' => TripStatus::TRIP_COMPLETED,
            'distance_km' => 12.6,
            'fare_minor' => 12_500,
            'fare_currency' => 'UGX',
            'fare_computed_at' => now(),
            ...$tripOverrides,
        ]);

    $order = OrderRequest::factory()->create([
        'customer_id' => $customer->id,
        'trip_id' => $trip->id,
        'reference' => 'KR-2026-0815',
        'service_type' => OrderRequestServiceType::RIDE,
        'pickup_location' => 'Acacia Mall, 14-18 Cooper Rd',
        'dropoff_location' => 'Kololo Hill Drive',
        'scheduled_for' => null,
        ...$orderOverrides,
    ]);

    return [$driverUser, $trip, $order];
}

function recordPayload(User $driverUser, Trip $trip): array
{
    return test()->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertOk()
        ->json('data');
}

// -- What kind of job it was ------------------------------------------------

it('says which service the trip was, and quotes the customer their own reference', function () {
    [$driverUser, $trip] = recordTrip();

    $payload = recordPayload($driverUser, $trip);

    expect($payload['service_type'])->toBe('ride');
    expect($payload['reference'])->toBe('KR-2026-0815');
});

it('serves neither on a corporate trip, rather than guessing at a ride', function () {
    // A corporate booking has a contract behind it, not an order request. A
    // client that defaulted null to `ride` would label a parcel run a taxi
    // fare — and the reference belongs to a walk-in customer who does not
    // exist here.
    $driverUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $driverUser->id]);

    $trip = Trip::factory()
        ->forVehicle(Vehicle::factory()->create(['status' => 'active']))
        ->forDriver($driver)
        ->create(['status' => TripStatus::TRIP_COMPLETED]);

    $payload = recordPayload($driverUser, $trip);

    expect($payload)->toHaveKeys(['service_type', 'reference', 'package']);
    expect($payload['service_type'])->toBeNull();
    expect($payload['reference'])->toBeNull();
    expect($payload['package'])->toBeNull();
});

// -- The parcel, and the two numbers that must not follow it out ------------

it('serves the parcel on a delivery, and only the two allow-listed keys', function () {
    [$driverUser, $trip] = recordTrip([
        'service_type' => OrderRequestServiceType::DELIVERY,
        'details' => [
            'item_type' => 'documents',
            'package_size' => 'small',
            // The two ADR-0024 §7 withholds. They live in the same column, and
            // a resource that emitted `details` wholesale would ship both while
            // looking entirely innocent in review.
            'sender_phone' => '+256700000001',
            'recipient_phone' => '+256700000002',
        ],
    ]);

    $payload = recordPayload($driverUser, $trip);

    expect($payload['package'])->toBe(['item_type' => 'documents', 'package_size' => 'small']);

    // Not "the phones are absent from `package`" — absent from the *whole*
    // payload. A field added anywhere on this resource that reached into
    // `details` would fail here rather than in review.
    expect(json_encode($payload))
        ->not->toContain('sender_phone')
        ->not->toContain('recipient_phone')
        ->not->toContain('+256700000001')
        ->not->toContain('+256700000002');
});

it('serves no parcel on a ride, rather than an object full of nulls', function () {
    // The absence is the fact: a ride genuinely has no parcel, and a client
    // that had to tell "no parcel" from "a parcel nobody described" would get
    // it wrong. `payment` is deliberately the other way round on both this
    // resource and the offer card.
    [$driverUser, $trip] = recordTrip(['details' => ['item_type' => 'parcel']]);

    $payload = recordPayload($driverUser, $trip);

    expect($payload['package'])->toBeNull();
    expect($payload['payment'])->toBeArray();
});

// -- The timeline the route rail is drawn from ------------------------------

it('renders each event\'s clock reading in the fleet\'s zone, not in UTC', function () {
    // The rail on the trip record shows "08:30" beside a pickup address. The
    // stored instant is UTC (`config/app.php`), so a handset formatting it
    // locally shows a Kampala driver 05:30 — and a phone that has picked up a
    // neighbouring zone shows a third answer. Same trap `DriverTripResource`
    // was written around, on a screen where an hour's error reads as a record
    // of a different journey.
    [$driverUser, $trip] = recordTrip();

    // The clock is moved rather than the row: `created_at` is not fillable and
    // `TripEvent` refuses `updating` outright — the timeline is append-only, so
    // there is no way to backdate one after the fact and there should not be.
    test()->travelTo('2026-08-15T05:30:00+00:00');

    $trip->events()->create([
        'from_status' => TripStatus::DRIVER_EN_ROUTE,
        'to_status' => TripStatus::DRIVER_ARRIVED,
        'user_id' => $driverUser->id,
    ]);

    test()->travelBack();

    $events = test()->actingAs($driverUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/events")
        ->assertOk()
        ->json('data');

    // **Not empty**, which it was until this screen was built. `TripEvent` is
    // tenant-scoped and `TenantScope` fails closed, so a walk-in's timeline —
    // tenantless by definition — came back as `[]` through the relation query.
    // Only on the trips a driver actually does, which is why it survived.
    expect($events)->not->toBeEmpty();

    $arrived = collect($events)->firstWhere('to_status', 'driver_arrived');

    // Kampala is UTC+3 all year — no daylight saving to make this seasonal.
    expect($arrived['local_time'])->toBe('08:30');
    expect($arrived['local_day'])->toBe('2026-08-15');
    // The UTC instant is still served unchanged: it is what any client doing
    // arithmetic (elapsed time, waiting periods) must use.
    expect($arrived['created_at'])->toContain('05:30');
});

it('refuses another driver the timeline, which is the only thing guarding it', function () {
    // **This test exists because a mutation survived.** Commenting out
    // `authorize('view', $trip)` in `TripEventController` broke nothing: the
    // corporate-client isolation test passes because route binding 404s the
    // *trip* for a tenant user, so it never reaches the controller.
    //
    // That matters more now than it did. `TripEvent::forTrip()` drops the tenant
    // scope so a walk-in's timeline is readable at all, which means the policy is
    // the whole of what stands between one driver and another driver's rows —
    // both are platform-level users, and `resolveRouteBinding` lets a
    // platform-level user resolve any trip by id.
    [, $trip] = recordTrip();

    $trip->events()->create([
        'from_status' => TripStatus::DRIVER_EN_ROUTE,
        'to_status' => TripStatus::DRIVER_ARRIVED,
    ]);

    $otherUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    Driver::factory()->create(['user_id' => $otherUser->id]);

    test()->actingAs($otherUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}/events")
        ->assertForbidden();
});

// -- The money, row by row --------------------------------------------------

it('serves the trip\'s own ledger rows, in the shape the wallet statement uses', function () {
    [$driverUser, $trip] = recordTrip();
    app(DriverLedgerService::class)->recordCompletedTrip($trip);

    $payload = recordPayload($driverUser, $trip);

    $lines = $payload['earnings']['lines'];

    // A cash job writes the pair ADR-0029 §2 describes: the driver's share as
    // a credit, and the whole fare as a debit because they are holding the
    // office's money. Both are the driver's record of this trip.
    expect($lines)->toHaveCount(2);

    // The same members `GET /me/ledger` serves, so the app renders these with
    // the component it already has. A shape of its own here would be a second
    // vocabulary for one fact about somebody's pay.
    expect($lines[0])->toHaveKeys([
        'id', 'kind', 'kind_label', 'amount_minor', 'currency', 'description',
        'trip_id', 'service_type', 'created_at',
    ]);

    $earned = collect($lines)->firstWhere('kind', 'fare_earned');

    expect($earned['amount_minor'])->toBe(10_000);
    // Labelled by the *job*, not by the enum: "Ride earnings" rather than the
    // generic "Fare earned". This is the field that silently comes back null
    // when the service map is built with an eager load — `TenantScope` fails
    // closed on a customer-owned trip, so the relation resolves to nothing.
    expect($earned['service_type'])->toBe('ride');

    // ADR-0029 §3 freezes the rate that applied inside this string, which is
    // what lets a driver open a trip from March and read the rate that
    // governed it.
    expect($earned['description'])->toContain('20%');
});

it('leaves a row unlabelled when the trip has no order behind it, rather than blank-labelling it', function () {
    // **A mutation found this gap.** Building the service map as
    // `[$id => $type ?? '']` passed every other test: a walk-in has a type and a
    // corporate trip has no ledger rows to label. The uncovered case is the one
    // the resource's own docblock names — a walk-in a dispatcher fulfilled by
    // hand, which has entries and no order request.
    //
    // `DriverLedgerEntryResource` reads `$map[$id] ?? null` and falls back to the
    // kind's own label, so a *missing* key means "we do not know what kind of job
    // this was" and an empty string means "a job of kind ''" — which reaches the
    // handset as a row titled " earnings".
    $driverUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    $driver = Driver::factory()->create(['user_id' => $driverUser->id]);

    $trip = Trip::factory()
        ->forCustomer(Customer::factory()->create())
        ->forVehicle(Vehicle::factory()->create(['category' => 'sedan', 'status' => 'active']))
        ->forDriver($driver)
        ->create([
            'status' => TripStatus::TRIP_COMPLETED,
            'fare_minor' => 8_000,
            'fare_currency' => 'UGX',
            'fare_computed_at' => now(),
        ]);

    // No `OrderRequest` for this trip, deliberately.
    app(DriverLedgerService::class)->recordCompletedTrip($trip);

    $payload = recordPayload($driverUser, $trip);

    $earned = collect($payload['earnings']['lines'])->firstWhere('kind', 'fare_earned');

    expect($earned['service_type'])->toBeNull();
});

it('never shows one driver the rows of another, and refuses the whole trip first', function () {
    // **`TripPolicy` gets there before the field gate does**, which is worth
    // pinning rather than assuming: another driver cannot read this trip at
    // all, so `lines` is unreachable for them by two independent mechanisms.
    //
    // The field gate in `driverEarningsFor()` is still the one that matters,
    // because the caller it excludes is the one the policy *allows* — a
    // dispatcher holding `trips.view.all` sees the board, and what a driver
    // takes home is not part of it. `TripEarningsTest` covers that reader.
    [, $trip] = recordTrip();
    app(DriverLedgerService::class)->recordCompletedTrip($trip);

    $otherUser = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    Driver::factory()->create(['user_id' => $otherUser->id]);

    test()->actingAs($otherUser, 'sanctum')
        ->getJson("/api/v1/trips/{$trip->id}")
        ->assertForbidden();
});

it('keeps the ledger off the trips list, where the relation is not loaded', function () {
    // Unbounded per row: a dispatch board of fifty trips would pay fifty
    // ledger reads for a figure nobody is reading there. `show()` loads the
    // relation and `index()` does not, and this is what holds that line.
    [$driverUser, $trip] = recordTrip();
    app(DriverLedgerService::class)->recordCompletedTrip($trip);

    $rows = test()->actingAs($driverUser, 'sanctum')
        ->getJson('/api/v1/trips')
        ->assertOk()
        ->json('data');

    $listed = collect($rows)->firstWhere('id', $trip->id);

    expect($listed)->not->toBeNull();
    expect($listed['earnings'])->toBeNull();
});
