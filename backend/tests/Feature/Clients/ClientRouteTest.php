<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Modules\Clients\Models\ClientPlace;
use Modules\Clients\Models\ClientRoute;

/**
 * The client builds a circuit (ADR-0045 §1).
 *
 * What these tests are actually defending, beyond "the endpoint works":
 *
 * - **Order is the array's order.** A route whose stops come back in
 *   insertion order rather than the order the officer dragged them into is
 *   a different circuit, and it would pass every assertion that did not
 *   look at `sequence`.
 * - **Omitted is not empty.** A PATCH that renames a route must not wipe
 *   its stops. This is one `array_key_exists` in the service and it is the
 *   single most destructive thing on this surface if it regresses.
 * - **A refusal, not a filter.** A stop naming somebody else's place is
 *   refused by name; silently dropping it would hand back a shorter circuit
 *   with a success message on it.
 */

/**
 * @return array{tenant: Tenant, admin: User, employee: User}
 */
function routeFixture(): array
{
    $tenant = Tenant::factory()->create(['name' => 'Centenary Bank']);

    $admin = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);
    $employee = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
    ]);

    return compact('tenant', 'admin', 'employee');
}

it('pins a place and builds a route whose stops keep the order they were sent in', function () {
    ['tenant' => $tenant, 'admin' => $admin] = routeFixture();

    $places = collect(['Head Office', 'Nakawa ATM', 'Wandegeya ATM'])
        ->map(fn (string $name) => ClientPlace::factory()->forTenant($tenant)->create(['name' => $name]));

    $response = $this->actingAs($admin, 'sanctum')
        ->postJson('/api/v1/routes', [
            'name' => 'Kampala Central ATM Run',
            'reference' => 'CB/ATM/CENTRAL',
            'stops' => [
                ['client_place_id' => $places[2]->id],
                ['client_place_id' => $places[0]->id, 'expected_dwell_minutes' => 15],
                ['client_place_id' => $places[1]->id, 'driver_notes' => 'Use the rear entrance.'],
            ],
        ])
        ->assertCreated();

    // The order asked for, not the order the ids happen to sort in.
    expect($response->json('data.stops.*.place.name'))
        ->toBe(['Wandegeya ATM', 'Head Office', 'Nakawa ATM']);

    // Sequence is assigned by the server from the array position, so it is
    // dense and one-based no matter what the caller sent.
    expect($response->json('data.stops.*.sequence'))->toBe([1, 2, 3]);
    expect($response->json('data.stops.1.expected_dwell_minutes'))->toBe(15);
    expect($response->json('data.stop_count'))->toBe(3);
});

it('reorders a route by rewriting its stop list, and renumbers the sequence', function () {
    ['tenant' => $tenant, 'admin' => $admin] = routeFixture();

    $places = collect(range(1, 3))
        ->map(fn (int $n) => ClientPlace::factory()->forTenant($tenant)->create(['name' => "ATM {$n}"]));

    $route = ClientRoute::factory()->forTenant($tenant)->create();

    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/routes/{$route->id}", [
            'stops' => $places->map(fn ($p) => ['client_place_id' => $p->id])->all(),
        ])
        ->assertOk();

    // The drag: last stop to the front. The unique key on
    // (client_route_id, sequence) is why this cannot be done by updating
    // rows in place, and this is the assertion that would catch a
    // reintroduced shuffle.
    $reordered = $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/routes/{$route->id}", [
            'stops' => [
                ['client_place_id' => $places[2]->id],
                ['client_place_id' => $places[0]->id],
                ['client_place_id' => $places[1]->id],
            ],
        ])
        ->assertOk();

    expect($reordered->json('data.stops.*.place.name'))->toBe(['ATM 3', 'ATM 1', 'ATM 2']);
    expect($reordered->json('data.stops.*.sequence'))->toBe([1, 2, 3]);
});

it('leaves the stops alone when a patch does not mention them, and empties them when it sends an empty list', function () {
    ['tenant' => $tenant, 'admin' => $admin] = routeFixture();

    $place = ClientPlace::factory()->forTenant($tenant)->create();
    $route = ClientRoute::factory()->forTenant($tenant)->create(['name' => 'Monday run']);

    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/routes/{$route->id}", [
            'stops' => [['client_place_id' => $place->id]],
        ])
        ->assertOk();

    // Renaming must not be a delete. This is the `array_key_exists` guard.
    $renamed = $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/routes/{$route->id}", ['name' => 'Tuesday run'])
        ->assertOk();

    expect($renamed->json('data.name'))->toBe('Tuesday run');
    expect($renamed->json('data.stop_count'))->toBe(1);

    // Present-and-empty is the client saying so, and is honoured.
    $emptied = $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/routes/{$route->id}", ['stops' => []])
        ->assertOk();

    expect($emptied->json('data.stop_count'))->toBe(0);
});

it('refuses a route naming a place that belongs to another client, and names the refusal', function () {
    ['tenant' => $tenant, 'admin' => $admin] = routeFixture();

    $mine = ClientPlace::factory()->forTenant($tenant)->create();
    $theirs = ClientPlace::factory()->create();

    $this->actingAs($admin, 'sanctum')
        ->postJson('/api/v1/routes', [
            'name' => 'Borrowed circuit',
            'stops' => [
                ['client_place_id' => $mine->id],
                ['client_place_id' => $theirs->id],
            ],
        ])
        ->assertStatus(422)
        ->assertJsonPath('code', 'UNKNOWN_CLIENT_PLACE')
        // Keyed by the request field and stringified, because the envelope's
        // `errors` is the same string-list map Laravel validation uses — so
        // the builder highlights the offending stop with the branch it
        // already has.
        ->assertJsonPath('errors.stops', [(string) $theirs->id]);

    // Refused whole. A partially-saved circuit is the failure mode the
    // transaction exists to prevent.
    expect(ClientRoute::query()->where('name', 'Borrowed circuit')->exists())->toBeFalse();
});

it('refuses a route naming somebody outside the organisation', function () {
    ['tenant' => $tenant, 'admin' => $admin] = routeFixture();

    $colleague = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
    ]);
    $stranger = User::factory()->create(['role' => UserRole::CORPORATE_EMPLOYEE]);

    $this->actingAs($admin, 'sanctum')
        ->postJson('/api/v1/routes', [
            'name' => 'Borrowed team',
            'member_ids' => [$colleague->id, $stranger->id],
        ])
        ->assertStatus(422)
        ->assertJsonPath('code', 'UNKNOWN_ROUTE_MEMBER')
        ->assertJsonPath('errors.member_ids', [(string) $stranger->id]);
});

it('names the team who ride the route, and gives away nothing else about them', function () {
    ['tenant' => $tenant, 'admin' => $admin, 'employee' => $employee] = routeFixture();

    $response = $this->actingAs($admin, 'sanctum')
        ->postJson('/api/v1/routes', [
            'name' => 'Cash run',
            'member_ids' => [$employee->id],
        ])
        ->assertCreated();

    expect($response->json('data.members'))->toBe([
        ['id' => $employee->id, 'name' => $employee->name],
    ]);

    // The allow-list, asserted as an absence. `User` carries an email, a
    // phone and a role, and a payload about geography must not.
    expect($response->json('data.members.0'))->not->toHaveKey('email');
});

it('refuses to delete a place a route still visits, and names the routes', function () {
    ['tenant' => $tenant, 'admin' => $admin] = routeFixture();

    $place = ClientPlace::factory()->forTenant($tenant)->create(['name' => 'Nakawa ATM']);

    $this->actingAs($admin, 'sanctum')
        ->postJson('/api/v1/routes', [
            'name' => 'Monday circuit',
            'stops' => [['client_place_id' => $place->id]],
        ])
        ->assertCreated();

    $this->actingAs($admin, 'sanctum')
        ->deleteJson("/api/v1/places/{$place->id}")
        ->assertStatus(409)
        ->assertJsonPath('code', 'CLIENT_PLACE_IN_USE')
        ->assertJsonPath('errors.routes', ['Monday circuit']);

    expect(ClientPlace::query()->whereKey($place->id)->exists())->toBeTrue();
});

it('caps a route at what the mapping service will draw', function () {
    ['tenant' => $tenant, 'admin' => $admin] = routeFixture();

    $places = ClientPlace::factory()->forTenant($tenant)->count(26)->create();

    $this->actingAs($admin, 'sanctum')
        ->postJson('/api/v1/routes', [
            'name' => 'Everything at once',
            'stops' => $places->map(fn ($p) => ['client_place_id' => $p->id])->all(),
        ])
        ->assertStatus(422)
        ->assertJsonPath('code', 'VALIDATION_FAILED');
});

it('lets an employee read the routes they ride but not build one', function () {
    ['tenant' => $tenant, 'employee' => $employee] = routeFixture();

    ClientRoute::factory()->forTenant($tenant)->create(['name' => 'Monday circuit']);

    // `routes.view` rides on `$clientReads`, so both corporate roles read.
    $this->actingAs($employee, 'sanctum')
        ->getJson('/api/v1/routes')
        ->assertOk()
        ->assertJsonPath('data.0.name', 'Monday circuit');

    // Building is `routes.manage`, which the employee role does not hold.
    $this->actingAs($employee, 'sanctum')
        ->postJson('/api/v1/routes', ['name' => 'Mine now'])
        ->assertForbidden();
});

it('lets platform staff read a client route and refuses them the write half', function () {
    ['tenant' => $tenant] = routeFixture();

    ClientRoute::factory()->forTenant($tenant)->create(['name' => 'Monday circuit']);

    $dispatcher = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);

    // `forActor` drops the tenant scope for platform staff — a dispatcher
    // watching a multi-stop trip needs the circuit behind it.
    $this->actingAs($dispatcher, 'sanctum')
        ->getJson('/api/v1/routes')
        ->assertOk()
        ->assertJsonPath('data.0.name', 'Monday circuit');

    // A Super Admin holds `routes.manage` — every permission is theirs —
    // and is still refused, because they have no tenant for the row to
    // belong to. ADR-0045 §9, and `ClientRoutePolicy` for both halves.
    $owner = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    $this->actingAs($owner, 'sanctum')
        ->postJson('/api/v1/routes', ['name' => 'Drawn by Shanitah'])
        ->assertForbidden();
});
