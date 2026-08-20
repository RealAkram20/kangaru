<?php

use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Tenant;
use App\Models\User;
use Modules\Bookings\Models\Booking;
use Modules\Clients\Models\ClientRoute;

/**
 * A client's own staff, and the bookings they raise for each other.
 *
 * Three changes are proved here, and they are one feature: a colleague has a
 * work number and a route roster, both set where the colleague is created;
 * and a booking a client raises names one of that client's own people
 * rather than whatever was typed into a box.
 *
 * The isolation assertions are the point of the file. `User` deliberately
 * carries no tenant scope (see the model), so **every** cross-tenant guard
 * in this area is a hand-written `where` that a refactor can silently drop:
 * the colleague lookup, the route roster, and the passenger field each get
 * their own "another client's" case here, proved by 422 or by absence
 * rather than by reading the code.
 */

/**
 * @return array{bank: Tenant, admin: User, employee: User, rival: Tenant, outsider: User}
 */
function colleagueFixture(): array
{
    $bank = Tenant::factory()->create(['name' => 'Centenary Bank']);
    $admin = User::factory()->create([
        'tenant_id' => $bank->id,
        'role' => UserRole::CORPORATE_ADMIN,
        'name' => 'Sarah Nabwire',
    ]);
    $employee = User::factory()->create([
        'tenant_id' => $bank->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
        'name' => 'Joseph Mukasa',
        'phone' => '+256700111222',
    ]);

    $rival = Tenant::factory()->create(['name' => 'Stanbic']);
    $outsider = User::factory()->create([
        'tenant_id' => $rival->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
        'name' => 'Someone Else',
    ]);

    return compact('bank', 'admin', 'employee', 'rival', 'outsider');
}

/*
|--------------------------------------------------------------------------
| The colleague, with a number and a roster
|--------------------------------------------------------------------------
*/

it('creates a colleague with a work number and the routes they ride', function () {
    ['bank' => $bank, 'admin' => $admin] = colleagueFixture();

    $monday = ClientRoute::factory()->forTenant($bank)->create(['name' => 'Monday ATM run']);
    $friday = ClientRoute::factory()->forTenant($bank)->create(['name' => 'Friday cash run']);

    $this->actingAs($admin, 'sanctum')->postJson('/api/v1/users', [
        'name' => 'Peter Ochieng',
        'email' => 'peter@centenary-bank.test',
        'phone' => '+256700333444',
        'role' => 'corporate_employee',
        'password' => 'a-long-enough-password',
        'route_ids' => [$monday->id, $friday->id],
    ])
        ->assertCreated()
        ->assertJsonPath('data.phone', '+256700333444')
        ->assertJsonPath('data.route_ids', [$monday->id, $friday->id]);

    $created = User::where('email', 'peter@centenary-bank.test')->firstOrFail();

    expect($created->clientRoutes()->pluck('client_routes.id')->all())
        ->toEqualCanonicalizing([$monday->id, $friday->id]);

    // Asserted against the table rather than the relation, because the
    // relation does not carry the pivot column and so cannot answer this:
    // `client_route_members.tenant_id` is NOT NULL (ADR-0001 covers join
    // tables too) and `sync()` will not invent it. A row with the wrong
    // tenant is the shape a cross-client roster would take.
    $this->assertDatabaseHas('client_route_members', [
        'user_id' => $created->id,
        'client_route_id' => $monday->id,
        'tenant_id' => $bank->id,
    ]);
});

it('replaces the roster whole rather than adding to it', function () {
    ['bank' => $bank, 'admin' => $admin, 'employee' => $employee] = colleagueFixture();

    $monday = ClientRoute::factory()->forTenant($bank)->create();
    $friday = ClientRoute::factory()->forTenant($bank)->create();

    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/users/{$employee->id}", ['route_ids' => [$monday->id, $friday->id]])
        ->assertOk();

    // Taken off the Monday run. A roster edited one entry at a time could
    // not express this, which is why it is saved whole like `capabilities`.
    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/users/{$employee->id}", ['route_ids' => [$friday->id]])
        ->assertOk()
        ->assertJsonPath('data.route_ids', [$friday->id]);

    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/users/{$employee->id}", ['route_ids' => []])
        ->assertOk()
        ->assertJsonPath('data.route_ids', []);
});

it('refuses to pin another client route to a colleague', function () {
    ['rival' => $rival, 'admin' => $admin, 'employee' => $employee] = colleagueFixture();

    $theirs = ClientRoute::factory()->forTenant($rival)->create();

    // Refused, not silently filtered: a roster that saves as nothing when
    // one route was named is a lie noticed a month later by a driver.
    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/users/{$employee->id}", ['route_ids' => [$theirs->id]])
        ->assertStatus(422)
        ->assertJsonValidationErrors('route_ids');

    expect($employee->clientRoutes()->count())->toBe(0);
});

it('offers only this client own routes to put people on', function () {
    ['bank' => $bank, 'rival' => $rival, 'admin' => $admin] = colleagueFixture();

    $ours = ClientRoute::factory()->forTenant($bank)->create(['name' => 'Monday ATM run']);
    ClientRoute::factory()->forTenant($rival)->create(['name' => 'Their run']);
    ClientRoute::factory()->forTenant($bank)->create(['name' => 'Retired run', 'is_active' => false]);

    $routes = $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/users')->assertOk()->json('meta.routes');

    expect($routes)->toBe([['id' => $ours->id, 'name' => 'Monday ATM run']]);
});

/*
|--------------------------------------------------------------------------
| The passenger picker
|--------------------------------------------------------------------------
*/

it('finds a colleague by name, and never anybody else', function () {
    ['admin' => $admin, 'employee' => $employee] = colleagueFixture();

    User::factory()->create([
        'tenant_id' => $employee->tenant_id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
        'name' => 'Joseph Otim',
    ]);

    $data = $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/colleagues?q=Joseph')->assertOk()->json('data');

    expect(collect($data)->pluck('name')->all())->toBe(['Joseph Mukasa', 'Joseph Otim']);
    // Three fields and no more — roles, capabilities and MFA state do not
    // belong behind `bookings.create`.
    expect(array_keys($data[0]))->toBe(['id', 'name', 'phone']);
    expect($data[0]['phone'])->toBe('+256700111222');
});

it('never returns another client staff, however exactly they are named', function () {
    ['admin' => $admin, 'outsider' => $outsider] = colleagueFixture();

    $data = $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/colleagues?q='.urlencode($outsider->name))->assertOk()->json('data');

    expect($data)->toBe([]);
});

it('does not offer a suspended colleague to send a car to', function () {
    ['admin' => $admin, 'employee' => $employee] = colleagueFixture();

    $employee->forceFill(['status' => UserStatus::SUSPENDED, 'deactivated_at' => now()])->save();

    expect($this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/colleagues?q=Joseph')->assertOk()->json('data'))->toBe([]);
});

it('refuses a lookup with no search term, so it cannot become a directory dump', function () {
    ['admin' => $admin] = colleagueFixture();

    $this->actingAs($admin, 'sanctum')->getJson('/api/v1/colleagues')
        ->assertStatus(422)->assertJsonValidationErrors('q');

    $this->actingAs($admin, 'sanctum')->getJson('/api/v1/colleagues?q=J')
        ->assertStatus(422)->assertJsonValidationErrors('q');
});

it('has no colleagues to offer platform staff, who belong to no client', function () {
    colleagueFixture();

    $dispatcher = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);

    // The interesting failure is not a 403 — it is `forActor` dropping the
    // scope for an actor with no tenant and handing back every client's
    // directory to somebody who only needed a picker.
    expect($this->actingAs($dispatcher, 'sanctum')
        ->getJson('/api/v1/colleagues?q=Joseph')->assertOk()->json('data'))->toBe([]);
});

/*
|--------------------------------------------------------------------------
| The booking that names one
|--------------------------------------------------------------------------
*/

it('takes the passenger name off the account, not out of the payload', function () {
    ['admin' => $admin, 'employee' => $employee] = colleagueFixture();

    $this->actingAs($admin, 'sanctum')->postJson('/api/v1/bookings', [
        'passenger_user_id' => $employee->id,
        // Half the point of naming a colleague is that this stops being
        // three spellings of one person.
        'passenger_name' => 'J. Mukasa',
        'passenger_phone' => '+256700999888',
        'origin' => 'Kampala',
        'destination' => 'Entebbe Airport',
    ])
        ->assertCreated()
        ->assertJsonPath('data.passenger_user_id', $employee->id)
        ->assertJsonPath('data.passenger_name', 'Joseph Mukasa')
        // The number is still the caller's to set: the account's is
        // prefilled on the form, and the person raising it may know a
        // better one for today.
        ->assertJsonPath('data.passenger_phone', '+256700999888');
});

it('refuses a client booking that names nobody', function () {
    ['employee' => $employee] = colleagueFixture();

    $this->actingAs($employee, 'sanctum')->postJson('/api/v1/bookings', [
        'passenger_name' => 'Grace Nakato',
        'passenger_phone' => '+256700111222',
        'origin' => 'Kampala',
        'destination' => 'Entebbe Airport',
    ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('passenger_user_id');

    expect(Booking::allTenants()->count())->toBe(0);
});

it('refuses a booking that names another client employee', function () {
    ['employee' => $employee, 'outsider' => $outsider] = colleagueFixture();

    $this->actingAs($employee, 'sanctum')->postJson('/api/v1/bookings', [
        'passenger_user_id' => $outsider->id,
        'passenger_name' => 'Someone Else',
        'passenger_phone' => '+256700111222',
        'origin' => 'Kampala',
        'destination' => 'Entebbe Airport',
    ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('passenger_user_id');

    expect(Booking::allTenants()->count())->toBe(0);
});

it('does not ask platform staff to name a colleague, having none to name', function () {
    colleagueFixture();

    $dispatcher = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);

    $response = $this->actingAs($dispatcher, 'sanctum')->postJson('/api/v1/bookings', [
        'passenger_name' => 'A Passer By',
        'passenger_phone' => '+256700111222',
        'origin' => 'Kampala',
        'destination' => 'Entebbe Airport',
    ]);

    // Deliberately not asserted as a 201, and the reason is worth writing
    // down rather than papering over: `bookings.tenant_id` is NOT NULL and
    // a platform actor has no tenant to fill it, so this endpoint has never
    // served them — Shanitah's desk works the walk-in queue (ADR-0012)
    // instead. That gap predates this rule and is not this rule's to fix.
    //
    // What is asserted is that the colleague requirement is not what stops
    // them: it is a rule about a *client's* booking being for a client's
    // own person, and somebody with no colleagues cannot be held to it.
    expect($response->json('errors.passenger_user_id'))->toBeNull();
});
