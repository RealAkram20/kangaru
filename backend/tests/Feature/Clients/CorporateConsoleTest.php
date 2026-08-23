<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Modules\Drivers\Models\Driver;
use Modules\Vehicles\Models\Vehicle;

/**
 * The corporate client's console — what a bank's transport officer sees.
 *
 * Two facts the web app's chrome and nav depend on, pinned here so they
 * cannot drift back:
 *
 * 1. `/auth/me` names the tenant. The Topbar reads "Centenary Bank", not
 *    "Tenant 1", and it does not learn that by fetching `/companies`.
 * 2. Neither corporate role can list the platform's drivers or vehicles.
 *    `DriverResource` carries every driver's phone, licence number and
 *    account; a client's user sees the driver *on their own trip*, nested
 *    in that trip, and nothing else (docs/security-gate.md F2). The
 *    dispatching roles keep the roster — that is what they are for.
 */

/**
 * @return array{tenant: Tenant, admin: User, employee: User}
 */
function corporateFixture(): array
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

it('names the tenant on /auth/me for a client user, and leaves it null for platform staff', function () {
    ['admin' => $admin] = corporateFixture();

    $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/auth/me')
        ->assertOk()
        ->assertJsonPath('data.tenant_name', 'Centenary Bank');

    $owner = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    $this->actingAs($owner, 'sanctum')
        ->getJson('/api/v1/auth/me')
        ->assertOk()
        ->assertJsonPath('data.tenant_id', null)
        ->assertJsonPath('data.tenant_name', null);
});

it('names the tenant on every row of the staff list', function () {
    ['admin' => $admin] = corporateFixture();

    $response = $this->actingAs($admin, 'sanctum')->getJson('/api/v1/users')->assertOk();

    expect(array_unique(array_column($response->json('data'), 'tenant_name')))->toBe(['Centenary Bank']);
});

it('refuses the driver roster to both corporate roles', function (string $role) {
    $fixture = corporateFixture();
    Driver::factory()->create();

    $this->actingAs($fixture[$role], 'sanctum')
        ->getJson('/api/v1/drivers')
        ->assertForbidden();
})->with(['admin', 'employee']);

it('refuses the vehicle register to both corporate roles', function (string $role) {
    $fixture = corporateFixture();
    Vehicle::factory()->create();

    $this->actingAs($fixture[$role], 'sanctum')
        ->getJson('/api/v1/vehicles')
        ->assertForbidden();
})->with(['admin', 'employee']);

it('still lets a corporate admin read their own company', function () {
    ['admin' => $admin] = corporateFixture();

    $this->actingAs($admin, 'sanctum')->getJson('/api/v1/companies')->assertOk();
});
