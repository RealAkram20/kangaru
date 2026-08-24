<?php

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Models\Operator;
use App\Models\OperatorClient;
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

it('shows a fleet no other fleet staff, and only the clients it actually serves', function () {
    $mine = Tenant::factory()->create();
    $myClientUser = User::factory()->create(['tenant_id' => $mine->id]);
    OperatorClient::create([
        'operator_id' => $this->shanitah->id,
        'tenant_id' => $mine->id,
        'status' => OperatorClient::ACTIVE,
    ]);

    // A client on the platform that Shanitah does not serve. This is the half
    // the test was missing, and the half that was leaking.
    $theirs = Tenant::factory()->create();
    $theirClientUser = User::factory()->create(['tenant_id' => $theirs->id]);

    $seen = User::forActor($this->shanitahStaff)->pluck('id');

    expect($seen)->toContain($this->shanitahStaff->id)
        ->and($seen)->toContain($myClientUser->id)
        // The hole this closes: before ADR-0055 a fleet actor's listing was
        // unscoped, so a second fleet's entire staff list came back.
        ->and($seen)->not->toContain($this->rivalStaff->id)
        /*
         * And the one this closes now. The branch read
         * `orWhereNotNull('users.tenant_id')` under a comment saying F2 would
         * narrow it and that *"today one fleet serves all of them"*. That
         * stopped being true on 23 August, when a second fleet was onboarded —
         * from which moment a rival's dispatcher could read the name, email
         * and phone of every employee of every client on the platform.
         *
         * The test could not have caught it either: with one client and one
         * contract-free tenant, "keeping its clients visible" passed on a
         * predicate that kept *everybody's* clients visible.
         */
        ->and($seen)->not->toContain($theirClientUser->id);
});

it('shows a fleet none of a client that has only asked to be served', function () {
    $prospect = Tenant::factory()->create();
    $prospectUser = User::factory()->create(['tenant_id' => $prospect->id]);

    OperatorClient::create([
        'operator_id' => $this->shanitah->id,
        'tenant_id' => $prospect->id,
        'status' => OperatorClient::REQUESTED,
    ]);

    // ADR-0060 §4: asking grants no read. A fleet that could see the staff of
    // every client it had merely requested would learn the size and shape of
    // any organisation on the platform by asking about it - and asking is
    // free and needs nobody's consent.
    expect(User::forActor($this->shanitahStaff)->pluck('id'))->not->toContain($prospectUser->id);
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

/* ------------------------------------------------ and now the listings --- */

/*
 * The four above prove `forActor()`. These prove the console *calls* it.
 *
 * That gap was not hypothetical. `VehicleService::list()` was
 * `return Vehicle::all()` and `DriverService::list()` was an unscoped
 * `Driver::query()`, both taking a `User $user` they never used — so the first
 * fleet onboarded after Shanitah opened its console and read Shanitah's twenty
 * vehicles and nineteen drivers. Every scope test in this file passed
 * throughout, because every one of them called the scope directly.
 *
 * `docs/agent-worklog.md` has caught this exact shape three times now: a guard
 * that is correct, tested, and reached by nothing. The only assertion that
 * catches it is one that goes through the router.
 */
it('serves a fleet only its own vehicles over HTTP, not only in the scope', function () {
    Vehicle::factory()->count(3)->create(['operator_id' => $this->shanitah->id]);
    $theirs = Vehicle::factory()->create(['operator_id' => $this->rival->id]);

    $body = $this->actingAs($this->rivalStaff, 'sanctum')
        ->getJson('/api/v1/vehicles')
        ->assertOk()
        ->json('data');

    // A count first, and the id second. `toContain` on a four-row response
    // passes exactly as happily as on a one-row one — which is how the leak
    // survived a suite that already knew to say this.
    expect($body)->toHaveCount(1)
        ->and($body[0]['id'])->toBe($theirs->id);
});

it('serves a fleet only its own drivers over HTTP', function () {
    Driver::factory()->count(3)->create(['operator_id' => $this->shanitah->id]);
    $theirs = Driver::factory()->create(['operator_id' => $this->rival->id]);

    $body = $this->actingAs($this->rivalStaff, 'sanctum')
        ->getJson('/api/v1/drivers')
        ->assertOk()
        ->json('data');

    expect($body)->toHaveCount(1)
        ->and($body[0]['id'])->toBe($theirs->id);
});

it('serves a brand new fleet an empty register rather than somebody else s', function () {
    // The owner's report, as a test. A fleet created minutes ago has added
    // nothing, so both registers must be empty — and "empty" is the assertion
    // that a leak breaks loudest, because there is no threshold to argue with.
    $fresh = Operator::create([
        'name' => 'Najjemba Transporters', 'slug' => 'najjemba', 'status' => 'active',
    ]);
    $owner = User::factory()->create([
        'operator_id' => $fresh->id, 'role' => UserRole::FLEET_OWNER,
    ]);

    Vehicle::factory()->count(4)->create(['operator_id' => $this->shanitah->id]);
    Driver::factory()->count(4)->create(['operator_id' => $this->shanitah->id]);

    $this->actingAs($owner, 'sanctum')->getJson('/api/v1/vehicles')
        ->assertOk()->assertJsonCount(0, 'data');
    $this->actingAs($owner, 'sanctum')->getJson('/api/v1/drivers')
        ->assertOk()->assertJsonCount(0, 'data');
});

/* ------------------------------------------- and the single-resource URL --- */

/*
 * Hiding a row from a list while leaving its id writable is not isolation.
 *
 * `VehiclePolicy` and `DriverPolicy` each took the model and discarded it —
 * `view()` deferred to `viewAny()`, `update()` and `delete()` both deferred to
 * `create()`, which takes no model at all. So a fleet owner, who holds
 * `vehicles.manage` and `drivers.manage` by seed, could edit or delete a
 * competitor's row by putting its id in the URL. That is worse than the
 * listing leak these tests were written for: one discloses a register, this
 * one writes to somebody else's.
 *
 * ADR-0006's implementation note called single-resource URLs *"half the bug"*
 * on the client axis. The fleet axis had to learn it again.
 */
it('refuses a rival fleet the sight of a vehicle it does not own', function () {
    $theirs = Vehicle::factory()->create(['operator_id' => $this->shanitah->id]);

    $this->actingAs($this->rivalStaff, 'sanctum')
        ->getJson("/api/v1/vehicles/{$theirs->id}")
        ->assertForbidden();
});

it('refuses a rival fleet the sight of a driver it does not employ', function () {
    $theirs = Driver::factory()->create(['operator_id' => $this->shanitah->id]);

    $this->actingAs($this->rivalStaff, 'sanctum')
        ->getJson("/api/v1/drivers/{$theirs->id}")
        ->assertForbidden();
});

it('refuses a rival fleet owner the right to edit or delete a competitor s vehicle', function () {
    $theirs = Vehicle::factory()->create(['operator_id' => $this->shanitah->id]);
    $owner = User::factory()->create([
        'operator_id' => $this->rival->id, 'role' => UserRole::FLEET_OWNER,
    ]);

    $this->actingAs($owner, 'sanctum')
        ->patchJson("/api/v1/vehicles/{$theirs->id}", ['status' => 'inactive'])
        ->assertForbidden();

    $this->actingAs($owner, 'sanctum')
        ->deleteJson("/api/v1/vehicles/{$theirs->id}")
        ->assertForbidden();

    // The refusal has to have *held*, not merely been reported. A 403 that
    // arrives after the write is the failure this test exists to catch.
    expect($theirs->fresh())->not->toBeNull()
        ->and($theirs->fresh()->status)->toBe($theirs->status);
});

it('refuses a rival fleet owner the right to edit or delete a competitor s driver', function () {
    $theirs = Driver::factory()->create(['operator_id' => $this->shanitah->id, 'status' => 'active']);
    $owner = User::factory()->create([
        'operator_id' => $this->rival->id, 'role' => UserRole::FLEET_OWNER,
    ]);

    $this->actingAs($owner, 'sanctum')
        ->patchJson("/api/v1/drivers/{$theirs->id}", ['status' => 'suspended'])
        ->assertForbidden();

    $this->actingAs($owner, 'sanctum')
        ->deleteJson("/api/v1/drivers/{$theirs->id}")
        ->assertForbidden();

    // Suspending somebody else's employee is the one that would not look like
    // a security failure from the inside — it would look like a driver whose
    // account stopped working for no reason anyone at their own fleet did.
    expect($theirs->fresh())->not->toBeNull()
        ->and($theirs->fresh()->status)->toBe('active');
});

it('still lets a fleet manage its own vehicle and its own driver', function () {
    // The other direction, and the reason it is here: every assertion above
    // passes just as well against a policy that refuses everybody. Four
    // refusals prove nothing on their own.
    $owner = User::factory()->create([
        'operator_id' => $this->rival->id, 'role' => UserRole::FLEET_OWNER,
    ]);
    $mine = Vehicle::factory()->create(['operator_id' => $this->rival->id]);
    $myDriver = Driver::factory()->create(['operator_id' => $this->rival->id]);

    $this->actingAs($owner, 'sanctum')
        ->getJson("/api/v1/vehicles/{$mine->id}")->assertOk();
    $this->actingAs($owner, 'sanctum')
        ->getJson("/api/v1/drivers/{$myDriver->id}")->assertOk();
});
