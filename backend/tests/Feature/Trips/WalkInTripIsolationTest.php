<?php

use App\Enums\UserRole;
use App\Models\Customer;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripEvent;
use Modules\Trips\Services\TripService;
use Modules\Vehicles\Models\Vehicle;

/**
 * AGENTS.md-mandated and non-skippable, like every other file named
 * `*IsolationTest`. This one covers the third kind of owner ADR-0024 §1
 * introduced.
 *
 * `trips.tenant_id` becoming nullable is the riskiest edit in ADR-0024,
 * because ADR-0001's isolation guarantee is the one bug this platform
 * cannot ship. The ADR chose *not* to back the invariant with a CHECK
 * constraint, following the precedent the `customers` migration set — which
 * means this file is what actually holds the guarantee up. It is written to
 * be worth that.
 *
 * Three directions, because there are now three principals who must not see
 * each other's trips:
 *
 * 1. A corporate client must not see a walk-in trip.
 * 2. A walk-in customer must not see a corporate client's trip.
 * 3. A walk-in customer must not see *another* walk-in customer's trip.
 *
 * Direction 1 is the one a reader assumes is free because `TenantScope`
 * fails closed. It is asserted anyway: "obviously safe" is the property
 * that stops being true when somebody adds a `withoutGlobalScope` in six
 * months, and this file is the tripwire on that.
 */
function seedWalkInAndCorporateTrips(): array
{
    $tenant = Tenant::factory()->create();
    $customer = Customer::factory()->create();
    $otherCustomer = Customer::factory()->create();

    $corporateTrip = Trip::factory()
        ->forTenant($tenant)
        ->forVehicle(Vehicle::factory()->create())
        ->forDriver(Driver::factory()->create())
        ->create(['origin' => 'Kampala', 'destination' => 'Entebbe']);

    $walkInTrip = Trip::factory()
        ->forCustomer($customer)
        ->forVehicle(Vehicle::factory()->create())
        ->forDriver(Driver::factory()->create())
        ->create(['origin' => 'Acacia Mall', 'destination' => 'Garden City']);

    $otherWalkInTrip = Trip::factory()
        ->forCustomer($otherCustomer)
        ->forVehicle(Vehicle::factory()->create())
        ->forDriver(Driver::factory()->create())
        ->create(['origin' => 'Ntinda', 'destination' => 'Kololo']);

    $clientUser = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::OPERATIONS_MANAGER,
    ]);

    return compact(
        'tenant', 'customer', 'otherCustomer',
        'corporateTrip', 'walkInTrip', 'otherWalkInTrip', 'clientUser',
    );
}

it('hides a walk-in trip from a corporate client\'s listing', function () {
    [
        'corporateTrip' => $corporateTrip,
        'walkInTrip' => $walkInTrip,
        'clientUser' => $clientUser,
    ] = seedWalkInAndCorporateTrips();

    $response = $this->actingAs($clientUser, 'sanctum')->getJson('/api/v1/trips');

    $ids = collect($response->json('data'))->pluck('id');

    $response->assertOk();
    expect($ids)->toContain($corporateTrip->id);
    expect($ids)->not->toContain($walkInTrip->id);
});

it('returns 404, not 403, when a corporate client fetches a walk-in trip by id', function () {
    ['walkInTrip' => $walkInTrip, 'clientUser' => $clientUser] = seedWalkInAndCorporateTrips();

    // 404 rather than 403 for the same reason as every other cross-owner
    // read in this platform: a 403 confirms the row exists.
    $this->actingAs($clientUser, 'sanctum')
        ->getJson("/api/v1/trips/{$walkInTrip->id}")
        ->assertStatus(404)
        ->assertJsonPath('code', 'NOT_FOUND');
});

it('hides a walk-in trip at the model level under a bound TenantContext', function () {
    ['tenant' => $tenant, 'walkInTrip' => $walkInTrip] = seedWalkInAndCorporateTrips();

    // Below the HTTP layer entirely. `TenantScope` filters
    // `where tenant_id = <bound>`, and SQL's NULL never equals anything —
    // so the walk-in row is excluded by the comparison itself rather than
    // by a predicate somebody wrote. This asserts that property directly,
    // because it is the whole reason a null tenant is safe.
    app(TenantContext::class)->set($tenant->id);

    expect(Trip::query()->find($walkInTrip->id))->toBeNull();
    expect(Trip::query()->whereNull('tenant_id')->count())->toBe(0);
});

it('hides a walk-in trip\'s events from the client that shares its vehicle', function () {
    ['tenant' => $tenant, 'walkInTrip' => $walkInTrip] = seedWalkInAndCorporateTrips();

    // The evidence table, which inherits the trip's owner. The fleet is
    // shared across clients (ADR-0005), so the *same van* can carry a
    // client's trip in the morning and a walk-in's in the afternoon —
    // which makes the timeline the place a leak would actually surface.
    TripEvent::create([
        'tenant_id' => null,
        'trip_id' => $walkInTrip->id,
        'from_status' => null,
        'to_status' => TripStatus::ASSIGNED,
        'user_id' => null,
        'notes' => null,
    ]);

    app(TenantContext::class)->set($tenant->id);

    expect(TripEvent::query()->where('trip_id', $walkInTrip->id)->count())->toBe(0);
});

it('scopes a customer to their own trips and nobody else\'s', function () {
    [
        'customer' => $customer,
        'walkInTrip' => $walkInTrip,
        'otherWalkInTrip' => $otherWalkInTrip,
        'corporateTrip' => $corporateTrip,
    ] = seedWalkInAndCorporateTrips();

    // Deliberately with no tenant bound, which is a customer's real
    // condition: `forCustomer` must work from the fail-closed state rather
    // than relying on something having been bound earlier in the request.
    $ids = Trip::forCustomer($customer)->pluck('id');

    expect($ids)->toContain($walkInTrip->id);
    expect($ids)->not->toContain($otherWalkInTrip->id);
    expect($ids)->not->toContain($corporateTrip->id);
});

it('refuses to write a trip owned by both a client and a customer', function () {
    $tenant = Tenant::factory()->create();
    $customer = Customer::factory()->create();
    $actor = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    // The invariant ADR-0024 §1 chose to keep in the service rather than in
    // a CHECK constraint. This is the assertion that decision leans on.
    expect(fn () => app(TripService::class)->create([
        'tenant_id' => $tenant->id,
        'customer_id' => $customer->id,
        'vehicle_id' => Vehicle::factory()->create()->id,
        'driver_id' => Driver::factory()->create()->id,
        'origin' => 'Kampala',
        'destination' => 'Entebbe',
    ], $actor))->toThrow(LogicException::class);
});

it('keeps a walk-in trip tenantless even when a tenant is bound to the request', function () {
    $tenant = Tenant::factory()->create();
    $customer = Customer::factory()->create();
    $actor = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    // `BelongsToTenant` fills `tenant_id` from the ambient context whenever
    // it is null on create, and it cannot know a customer already owns this
    // row. Without `Trip::booted()` undoing that, a walk-in trip dispatched
    // inside a request that happens to have a tenant bound is filed under
    // that client — a cross-tenant leak with no error and no symptom.
    //
    // Mutation check: delete the `creating` hook in Trip::booted() and this
    // test fails while every other test in the suite still passes.
    app(TenantContext::class)->set($tenant->id);

    $trip = app(TripService::class)->create([
        'customer_id' => $customer->id,
        'vehicle_id' => Vehicle::factory()->create()->id,
        'driver_id' => Driver::factory()->create()->id,
        'origin' => 'Acacia Mall',
        'destination' => 'Garden City',
    ], $actor);

    expect($trip->tenant_id)->toBeNull();
    expect($trip->customer_id)->toBe($customer->id);
});
