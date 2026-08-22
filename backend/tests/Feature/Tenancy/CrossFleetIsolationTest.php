<?php

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Models\Operator;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Access\AccessContext;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Models\Trip;
use Modules\Vehicles\Models\Vehicle;

/**
 * The mirror of ADR-0001's mandatory cross-tenant suite, one level up
 * (ADR-0055).
 *
 * **A second fleet exists only here.** Production has one, and F0 ships no way
 * to create another — no endpoint, no screen, no seeder — because between F0
 * and F2 the operational tables carry `operator_id` and nothing filters on it.
 * So this suite has to build the thing the application refuses to, or the
 * isolation it claims is untested and stays untested until the day it matters.
 *
 * ## What this does and does not prove
 *
 * It proves `forActor()` — the opt-in scope every listing goes through — and,
 * since F2, route-model binding as well, on `drivers`, `vehicles`, `users`,
 * `trips`, `bookings` and `invoices`.
 *
 * It does **not** prove global isolation. `drivers` and `vehicles` still carry
 * no global scope, deliberately: they have never had one, and a fail-closed
 * scope would turn `AdvanceDispatchOffers` into a silent no-op every ten
 * seconds. Nor are a trip's *children* — `trip_events`, `trip_locations`,
 * `trip_stops` — fleet-scoped in their own right; they are reached through a
 * trip, and the trip is now the gate. Saying so here is the point: a suite
 * that implied more than it checked would be worse than no suite.
 */
beforeEach(function () {
    $this->shanitah = Operator::find(Operator::SHANITAH);

    $this->rival = Operator::create([
        'name' => 'Rival Transport Ltd',
        'slug' => 'rival-transport',
        'status' => 'active',
    ]);

    $this->shanitahStaff = User::factory()->create([
        'operator_id' => $this->shanitah->id,
        'role' => UserRole::DISPATCHER,
    ]);

    $this->rivalStaff = User::factory()->create([
        'operator_id' => $this->rival->id,
        'role' => UserRole::DISPATCHER,
    ]);
});

it('shows a fleet only its own drivers', function () {
    $mine = Driver::factory()->create(['operator_id' => $this->shanitah->id]);
    $theirs = Driver::factory()->create(['operator_id' => $this->rival->id]);

    $seen = Driver::forActor($this->rivalStaff)->pluck('id');

    // A count, not an existence check. The worklog has caught three lying
    // tests on this branch, every one an existence assertion where a count was
    // needed: `toContain` passes just as happily when the list holds both.
    expect($seen)->toHaveCount(1)
        ->and($seen->all())->toBe([$theirs->id])
        ->and($seen)->not->toContain($mine->id);
});

it('shows a fleet only its own vehicles', function () {
    $mine = Vehicle::factory()->create(['operator_id' => $this->shanitah->id]);
    $theirs = Vehicle::factory()->create(['operator_id' => $this->rival->id]);

    $seen = Vehicle::forActor($this->rivalStaff)->pluck('id');

    expect($seen)->toHaveCount(1)
        ->and($seen->all())->toBe([$theirs->id])
        ->and($seen)->not->toContain($mine->id);
});

it('shows a fleet no other fleet staff, while keeping its clients visible', function () {
    $client = Tenant::factory()->create();
    $clientUser = User::factory()->create(['tenant_id' => $client->id]);

    $seen = User::forActor($this->shanitahStaff)->pluck('id');

    expect($seen)->toContain($this->shanitahStaff->id)
        ->and($seen)->toContain($clientUser->id)
        // The hole this closes: before ADR-0055 a fleet actor's listing was
        // unscoped, so a second fleet's entire staff list came back.
        ->and($seen)->not->toContain($this->rivalStaff->id);
});

it('shows a client none of any fleet, which is what the permission catalogue already says', function () {
    $clientUser = User::factory()->create(['tenant_id' => Tenant::factory()->create()->id]);

    Driver::factory()->create(['operator_id' => $this->shanitah->id]);
    Vehicle::factory()->create(['operator_id' => $this->shanitah->id]);

    expect(Driver::forActor($clientUser)->count())->toBe(0)
        ->and(Vehicle::forActor($clientUser)->count())->toBe(0);
});

it('shows head office no fleet of its own, because it owns none', function () {
    $hq = new User([
        'name' => 'Head Office',
        'email' => 'hq@kangaruride.test',
        'password' => 'password',
        'role' => UserRole::SUPER_ADMIN,
    ]);
    $hq->access_level = AccessLevel::KANGARU;
    $hq->save();

    Driver::factory()->create(['operator_id' => $this->shanitah->id]);
    Driver::factory()->create(['operator_id' => $this->rival->id]);

    // Not a permission failure — a shape failure. Kangaru owns no drivers, so
    // there is nothing for it to see (ADR-0055 §5). It reaches a fleet's by
    // acting as somebody in it (ADR-0056).
    expect(Driver::forActor($hq)->count())->toBe(0)
        ->and(User::forActor($hq)->pluck('id')->all())->toBe([$hq->id]);
});

it('gives a new driver the fleet of whoever is acting, not a default', function () {
    app(AccessContext::class)->bindFleet($this->rival->id);

    $driver = Driver::create([
        'name' => 'Someone New',
        'phone' => '+256700000999',
        'license_number' => 'DL-XX-9999',
        'license_expiry' => now()->addYear()->toDateString(),
        'status' => 'active',
    ]);

    expect($driver->operator_id)->toBe($this->rival->id);
});

it('binds the fleet axis from the actor, not from an absent client', function () {
    $context = app(AccessContext::class);

    $context->bindFleet($this->rival->id);
    expect($context->level())->toBe(AccessLevel::FLEET)
        ->and($context->operatorId())->toBe($this->rival->id)
        ->and($context->clientId())->toBeNull();

    // The property the whole design rests on: nothing bound means no rows,
    // and head office is a binding rather than the absence of one.
    $context->clear();
    expect($context->isBound())->toBeFalse();

    $context->bindKangaru();
    expect($context->isBound())->toBeTrue()
        ->and($context->operatorId())->toBeNull();
});

/* --------------------------------------------- the operational tables --- */

it('shows a fleet none of another fleet s trips', function () {
    $client = Tenant::factory()->create();

    $mine = Trip::factory()->create([
        'tenant_id' => $client->id, 'operator_id' => $this->shanitah->id,
    ]);
    $theirs = Trip::factory()->create([
        'tenant_id' => $client->id, 'operator_id' => $this->rival->id,
    ]);

    $seen = Trip::forActor($this->rivalStaff)->pluck('id');

    // Dropping the tenant scope answered "reads across clients", which was the
    // whole question while one fleet existed. It is now half of one, and left
    // at half a second fleet's dispatcher reads the first fleet's work.
    expect($seen)->toHaveCount(1)
        ->and($seen->all())->toBe([$theirs->id])
        ->and($seen)->not->toContain($mine->id);
});

it('still shows a fleet the walk-in work nobody has claimed', function () {
    $client = Tenant::factory()->create();

    Trip::factory()->create(['tenant_id' => $client->id, 'operator_id' => $this->shanitah->id]);
    $unclaimed = Trip::factory()->create(['tenant_id' => $client->id, 'operator_id' => null]);

    // A null fleet means Kangaru's, unclaimed (ADR-0055 §7). A bare
    // `where operator_id = mine` would make every unclaimed walk-in invisible
    // to dispatch — the queue would empty silently and nobody would be told.
    //
    // Visible to every fleet is correct today and wrong for F3, where
    // reaching walk-in demand becomes a grant. This test is the one F3
    // rewrites.
    expect(Trip::forActor($this->rivalStaff)->pluck('id')->all())->toBe([$unclaimed->id]);
});

it('refuses to resolve another fleet s trip by id, not only to list it', function () {
    $client = Tenant::factory()->create();
    $theirs = Trip::factory()->create([
        'tenant_id' => $client->id, 'operator_id' => $this->shanitah->id,
    ]);

    // ADR-0006's implementation note calls route-model binding "half the bug"
    // for the client axis: a patched listing still left every single-resource
    // URL resolving through the global scope. The fleet axis inherits that
    // lesson rather than re-learning it.
    //
    // **Driven over HTTP on purpose.** The first version of this test called
    // `resolveRouteBinding()` directly and passed *with the narrowing disabled*
    // — because outside a request `request()->user()` is null, so the global
    // tenant scope failed closed and returned null for a reason that had
    // nothing to do with fleets. It was green, it was worthless, and only the
    // mutation showed it. Assert through the router, where `SubstituteBindings`
    // actually runs.
    $this->actingAs($this->rivalStaff, 'sanctum')
        ->getJson("/api/v1/trips/{$theirs->id}")
        // 404, not 403: a fleet must not be able to probe a competitor's
        // identifiers by watching status codes.
        ->assertNotFound();
});
