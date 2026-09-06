<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Modules\Clients\Models\ClientPlace;
use Modules\Clients\Models\ClientRoute;

/**
 * ADR-0001's mandatory suite, for the three tables ADR-0045 added.
 *
 * A client's saved places **are** their ATM estate — where the cash is, and
 * in which order somebody drives to it. The corporate panel plan calls a
 * leak between clients the one bug that ends this platform, and this is the
 * data that sentence is about most literally.
 *
 * Both halves, as ADR-0006 requires: that a client sees only their own, and
 * the mirror — that a platform user without the permission sees none of it
 * either, rather than having no tenant quietly become a permission.
 */

/**
 * @return array{tenant: Tenant, admin: User}
 */
function isolatedClient(string $name): array
{
    $tenant = Tenant::factory()->create(['name' => $name]);

    $admin = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    return compact('tenant', 'admin');
}

it('shows a client only their own places and routes', function () {
    ['tenant' => $mine, 'admin' => $admin] = isolatedClient('Centenary Bank');
    ['tenant' => $theirs] = isolatedClient('Stanbic Bank');

    ClientPlace::factory()->forTenant($mine)->create(['name' => 'Nakawa ATM']);
    ClientPlace::factory()->forTenant($theirs)->create(['name' => 'Garden City ATM']);

    ClientRoute::factory()->forTenant($mine)->create(['name' => 'Monday circuit']);
    ClientRoute::factory()->forTenant($theirs)->create(['name' => 'Their circuit']);

    $places = $this->actingAs($admin, 'sanctum')->getJson('/api/v1/places')->assertOk();
    expect($places->json('data.*.name'))->toBe(['Nakawa ATM']);

    $routes = $this->actingAs($admin, 'sanctum')->getJson('/api/v1/routes')->assertOk();
    expect($routes->json('data.*.name'))->toBe(['Monday circuit']);
});

it('answers 404, not 403, when a client reaches for another client by id', function () {
    ['admin' => $admin] = isolatedClient('Centenary Bank');
    ['tenant' => $theirs] = isolatedClient('Stanbic Bank');

    $place = ClientPlace::factory()->forTenant($theirs)->create();
    $route = ClientRoute::factory()->forTenant($theirs)->create();

    // AGENTS.md: "404 also masks cross-tenant IDs; never return 403 for
    // another tenant's resource." A 403 here would confirm the row exists,
    // which is how one bank enumerates another's estate one id at a time.
    $this->actingAs($admin, 'sanctum')
        ->getJson("/api/v1/places/{$place->id}")
        ->assertNotFound();

    $this->actingAs($admin, 'sanctum')
        ->getJson("/api/v1/routes/{$route->id}")
        ->assertNotFound();
});

it('refuses a client editing another client route by id', function () {
    ['admin' => $admin] = isolatedClient('Centenary Bank');
    ['tenant' => $theirs] = isolatedClient('Stanbic Bank');

    $route = ClientRoute::factory()->forTenant($theirs)->create(['name' => 'Their circuit']);

    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/routes/{$route->id}", ['name' => 'Mine now'])
        ->assertNotFound();

    expect($route->refresh()->name)->toBe('Their circuit');
});

it('shows a platform user with the permission every client, and one without it none', function () {
    ['tenant' => $one] = isolatedClient('Centenary Bank');
    ['tenant' => $two] = isolatedClient('Stanbic Bank');

    ClientRoute::factory()->forTenant($one)->create(['name' => 'Centenary circuit']);
    ClientRoute::factory()->forTenant($two)->create(['name' => 'Stanbic circuit']);

    // A Dispatcher holds `routes.view` since ADR-0045 and reads across all
    // clients, which is what makes a multi-stop trip legible on the map.
    $dispatcher = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DISPATCHER]);

    $seen = $this->actingAs($dispatcher, 'sanctum')->getJson('/api/v1/routes')->assertOk();
    expect($seen->json('data.*.name'))
        ->toContain('Centenary circuit')
        ->toContain('Stanbic circuit');

    // The mirror ADR-0006 insists on. A Driver has no tenant either, and
    // that must not become a permission: `routes.view` is deliberately not
    // on `$everyoneReads`, so a driver reads no client's estate at all.
    $driver = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);

    $this->actingAs($driver, 'sanctum')
        ->getJson('/api/v1/routes')
        ->assertForbidden();

    $this->actingAs($driver, 'sanctum')
        ->getJson('/api/v1/places')
        ->assertForbidden();
});
