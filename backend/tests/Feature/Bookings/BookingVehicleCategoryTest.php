<?php

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Models\Operator;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Modules\Bookings\Models\Booking;
use Modules\Dispatch\Services\DispatchRecommender;
use Modules\Drivers\Models\Driver;
use Modules\Fleet\Models\VehicleAllocation;
use Modules\Trips\Models\Trip;
use Modules\Trips\Support\LivePosition;
use Modules\Trips\Support\LivePositionStore;
use Modules\Vehicles\Models\Vehicle;
use Modules\Vehicles\Models\VehicleCategory;

/**
 * ADR-0051 — the kind of vehicle a client asks for.
 *
 * Three claims, and the third is the one that would break silently:
 *
 * 1. **Null is a real answer**, distinguishable forever from a preference
 *    that was not honoured. A default here would erase the difference a
 *    bank's auditor is entitled to see.
 * 2. **It is a preference, not a filter.** The alternatives are still
 *    offered — a hard filter would leave a client with no candidate at all
 *    on a thin morning and nothing saying why.
 * 3. **The tiers hold arithmetically.** "A match outranks everything except
 *    a contracted vehicle" is a claim about numbers: the category bonus has
 *    to stay under `1000 - 20 - 500`. Nothing but a test notices when
 *    somebody rounds it up to 500 and a commercial agreement quietly stops
 *    winning.
 */
function bookingClient(): array
{
    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    return [
        $tenant,
        User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_ADMIN]),
    ];
}

function bookingPayload(array $overrides = []): array
{
    return array_merge([
        'passenger_name' => 'Grace Achieng',
        'passenger_phone' => '+256 772 000 111',
        'passenger_count' => 4,
        'origin' => 'Centenary Bank, Mapeera House',
        'destination' => 'Entebbe Airport',
    ], $overrides);
}

/* ------------------------------------------------------------------ 1 --- */

it('records the kind of vehicle a client asked for', function () {
    [$tenant, $client] = bookingClient();
    $colleague = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_EMPLOYEE]);

    $this->actingAs($client, 'sanctum')
        ->postJson('/api/v1/bookings', bookingPayload([
            'passenger_user_id' => $colleague->id,
            'vehicle_category' => 'van',
        ]))
        ->assertStatus(201)
        ->assertJsonPath('data.vehicle_category', 'van');

    expect(Booking::sole()->vehicle_category)->toBe('van');
});

it('keeps "no preference" as null rather than defaulting to a category', function () {
    [$tenant, $client] = bookingClient();
    $colleague = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_EMPLOYEE]);

    $this->actingAs($client, 'sanctum')
        ->postJson('/api/v1/bookings', bookingPayload(['passenger_user_id' => $colleague->id]))
        ->assertStatus(201)
        // Not `'sedan'`, and not `''`. A default would make "did not mind"
        // indistinguishable from "asked for a sedan", which is the one
        // distinction this column exists to keep.
        ->assertJsonPath('data.vehicle_category', null);

    expect(Booking::sole()->vehicle_category)->toBeNull();
});

it('refuses a category the fleet has retired', function () {
    [$tenant, $client] = bookingClient();
    $colleague = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_EMPLOYEE]);
    VehicleCategory::query()->where('key', 'van')->update(['active' => false]);

    // Deliberately *not* grandfathered, unlike a vehicle's own category on
    // UpdateVehicleRequest: a booking is a request being made now.
    $this->actingAs($client, 'sanctum')
        ->postJson('/api/v1/bookings', bookingPayload([
            'passenger_user_id' => $colleague->id,
            'vehicle_category' => 'van',
        ]))
        ->assertStatus(422)
        ->assertJsonValidationErrors('vehicle_category');

    expect(Booking::query()->count())->toBe(0);
});

/* ------------------------------------------------------------------ 2 --- */

/**
 * A booking with two candidate vehicles of different categories, both free.
 *
 * @return array{0: Booking, 1: Vehicle, 2: Vehicle}
 */
function twoCandidates(?string $wanted): array
{
    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $staff = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DISPATCHER]);

    // Two drivers, because the recommender pairs one driver per vehicle and
    // returns nothing at all with none available.
    Driver::factory()->count(2)->create(['status' => 'active']);

    $van = Vehicle::factory()->create(['category' => 'van', 'seating_capacity' => 8, 'status' => 'active']);
    $sedan = Vehicle::factory()->create(['category' => 'sedan', 'seating_capacity' => 5, 'status' => 'active']);

    $booking = Booking::create([
        'tenant_id' => $tenant->id,
        'requested_by_user_id' => $staff->id,
        'passenger_name' => 'Grace Achieng',
        'passenger_phone' => '+256 772 000 111',
        'passenger_count' => 4,
        'vehicle_category' => $wanted,
        'origin' => 'Mapeera House',
        'destination' => 'Entebbe',
        'status' => 'pending',
    ]);

    return [$booking, $van, $sedan];
}

/**
 * The actor the recommender scopes its pool by (ADR-0055 §6).
 *
 * A fleet dispatcher on `Operator::SHANITAH`, which is what `VehicleFactory`
 * and `DriverFactory` default to — so the pool these tests build is exactly
 * the pool this actor may see. Before the scope existed the recommender took
 * no actor and ranked every fleet's vehicles together.
 */
function rankingDispatcher(): User
{
    return User::factory()->create([
        'tenant_id' => null,
        'operator_id' => Operator::SHANITAH,
        'access_level' => AccessLevel::FLEET,
        'role' => UserRole::DISPATCHER,
    ]);
}

it('ranks the requested kind of vehicle first', function () {
    [$booking, $van] = twoCandidates('van');

    $suggestions = app(DispatchRecommender::class)->forBooking($booking, rankingDispatcher());

    expect($suggestions)->toHaveCount(2);
    expect($suggestions->first()->vehicle->id)->toBe($van->id);
    expect($suggestions->first()->reasons)->toContain('Van, as the client requested.');
});

it('still offers the other kinds, saying which they are', function () {
    [$booking] = twoCandidates('van');

    $suggestions = app(DispatchRecommender::class)->forBooking($booking, rankingDispatcher());

    // The whole argument for ranking over filtering. A hard filter would
    // return one suggestion here — and none at all on the morning the van
    // is in the workshop.
    expect($suggestions)->toHaveCount(2);

    $mismatch = $suggestions->last();
    expect($mismatch->reasons)->toContain('Not the van the client requested — this is a sedan.');
});

it('changes nothing for a booking that states no preference', function () {
    [$booking] = twoCandidates(null);

    $suggestions = app(DispatchRecommender::class)->forBooking($booking, rankingDispatcher());

    // Neither sentence appears at all, so a booking without a preference
    // scores exactly as it did before ADR-0051 — which is what makes this
    // additive rather than a change to how everything is dispatched.
    foreach ($suggestions as $suggestion) {
        foreach ($suggestion->reasons as $reason) {
            expect($reason)->not->toContain('as the client requested');
            expect($reason)->not->toContain('Not the');
        }
    }
});

/* ------------------------------------------------------------------ 3 --- */

/**
 * Gives a vehicle a live position.
 *
 * A vehicle only has one because it is on a trip; the matcher reads the
 * position rather than the trip, so a **completed** trip is used, which
 * leaves the vehicle free. Same shape as `parkVehicleAt` in
 * Feature/Dispatch/AutomaticDispatchTest.
 */
function parkVehicleOnPickup(Vehicle $vehicle, Tenant $tenant, float $lat, float $lng): void
{
    $trip = Trip::factory()->forTenant($tenant)->forVehicle($vehicle)
        ->forDriver(Driver::factory()->create())->create(['status' => 'trip_completed']);

    app(LivePositionStore::class)->put([new LivePosition(
        vehicleId: $vehicle->id,
        tenantId: $tenant->id,
        tripId: $trip->id,
        driverId: $trip->driver_id,
        latitude: $lat,
        longitude: $lng,
        speedKph: null,
        headingDegrees: null,
        recordedAt: CarbonImmutable::now(),
    )]);
}

/**
 * The **worst case for the contract**, built deliberately.
 *
 * The first version of this test stood two vehicles with no reported
 * position side by side and asserted the contracted one won. It passed — and
 * it went on passing with the category bonus mutated to 500, which is past
 * the point where ADR-0009's rule stops holding. With no position, distance
 * contributes zero to both, so the comparison was 1000 against 450 and
 * nothing in between could ever be distinguished. A test that cannot fail
 * proves nothing.
 *
 * So the two vehicles sit at the extremes of every term:
 *
 * | | contracted sedan | requested van |
 * |---|---|---|
 * | contract | +1000 | 0 |
 * | category | 0 | +`CATEGORY_MATCH` |
 * | distance | +0 (reports no position) | **+500** (exactly on the pickup) |
 * | spare seats | **-20** (24-seater for 4) | -0 (4-seater for 4) |
 * | **total** | **980** | `CATEGORY_MATCH + 500` |
 *
 * 980 against 950 at the shipped 450, and the ordering flips the moment the
 * bonus passes 480 — exactly the bound ADR-0051 derives. **Proved by
 * mutation:** at 500 the van wins and this fails.
 */
it('lets a contracted vehicle outrank the requested kind, at the worst case for the contract', function () {
    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $staff = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::DISPATCHER]);
    Driver::factory()->count(2)->create(['status' => 'active']);

    // Twenty spare seats: the largest penalty the recommender ever applies.
    $sedan = Vehicle::factory()->create(['category' => 'sedan', 'seating_capacity' => 24, 'status' => 'active']);
    // No spare seats, and it will be parked on the pickup itself.
    $van = Vehicle::factory()->create(['category' => 'van', 'seating_capacity' => 4, 'status' => 'active']);

    $booking = Booking::create([
        'tenant_id' => $tenant->id,
        'requested_by_user_id' => $staff->id,
        'passenger_name' => 'Grace Achieng',
        'passenger_phone' => '+256 772 000 111',
        'passenger_count' => 4,
        'vehicle_category' => 'van',
        'origin' => 'Mapeera House',
        // Coordinates, or distance is not used at all and the van never gets
        // its 500 — which is how the first version of this test defeated
        // itself without anybody noticing.
        'origin_latitude' => 0.3136,
        'origin_longitude' => 32.5811,
        'destination' => 'Entebbe',
        'status' => 'pending',
    ]);

    parkVehicleOnPickup($van, $tenant, 0.3136, 32.5811);

    VehicleAllocation::factory()->create([
        'tenant_id' => $tenant->id,
        'vehicle_id' => $sedan->id,
        'starts_on' => now()->subDay()->toDateString(),
        'ends_on' => now()->addDay()->toDateString(),
        'exclusive' => false,
    ]);

    $suggestions = app(DispatchRecommender::class)->forBooking($booking, rankingDispatcher());

    // ADR-0009 §1: a commercial agreement is not overridden by a preference,
    // even one the client stated, and even against a van at the kerb.
    expect($suggestions->first()->vehicle->id)->toBe($sedan->id);
    // And it says both things, so the dispatcher can choose otherwise.
    expect($suggestions->first()->reasons)->toContain('Contracted to this client for this date.');
    expect($suggestions->first()->reasons)
        ->toContain('Not the van the client requested — this is a sedan.');
});
