<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Drivers\Models\Driver;

/**
 * AGENTS.md-mandated and non-skippable — but **repointed** by ADR-0005,
 * not removed. See VehicleCrossTenantIsolationTest for the full reasoning;
 * a driver works for Shanitah, not for a client, so "another tenant's
 * driver" no longer names anything.
 *
 * What it proves now: the roster is deliberately shared, asserted so that
 * re-scoping drivers to a tenant fails loudly; and the confidential surface
 * — which trips a client can see — is covered by the vehicle file's final
 * case and by EmployeeTripVisibilityTest.
 */
function seedTwoTenantsWithDrivers(): array
{
    $tenantA = Tenant::factory()->create();
    $tenantB = Tenant::factory()->create();

    $driverA = Driver::factory()->create(['name' => 'Driver A']);
    $driverB = Driver::factory()->create(['name' => 'Driver B']);

    $userA = User::factory()->create([
        'tenant_id' => $tenantA->id,
        'role' => UserRole::FLEET_OWNER,
    ]);

    // The fleet the roster actually belongs to. `DriverFactory` puts every
    // driver on Shanitah, and since ADR-0055 the roster is *theirs* — so
    // reading it is a fleet act, and this is who performs it.
    $fleetUser = User::factory()->create(['role' => UserRole::FLEET_OWNER]);

    return compact('tenantA', 'tenantB', 'driverA', 'driverB', 'userA', 'fleetUser');
}

it('shows a fleet the whole roster, undivided by which client it is driving for', function () {
    ['driverA' => $driverA, 'driverB' => $driverB, 'fleetUser' => $fleetUser] = seedTwoTenantsWithDrivers();

    $ids = collect(
        $this->actingAs($fleetUser, 'sanctum')->getJson('/api/v1/drivers')->assertOk()->json('data')
    )->pluck('id');

    // Both, deliberately (ADR-0005). A failure here means drivers have been
    // re-scoped to tenants, and dispatch can no longer reach most of them.
    expect($ids)->toContain($driverA->id);
    expect($ids)->toContain($driverB->id);
});

/*
 * ## Why the test above changed hands, and what it had quietly become
 *
 * It used to act as `$userA` — and `$userA` has a `tenant_id`, which
 * `UserFactory` turns into `operator_id => null`, which `User::saving` turns
 * into `access_level: client`. So from ADR-0055 until this commit, an
 * AGENTS.md-mandated isolation test was asserting that **a corporate client
 * reads Shanitah's entire driver roster**, with every phone number and licence
 * number on it — the precise disclosure `docs/security-gate.md` F2 exists to
 * prevent.
 *
 * It passed because `DriverService::list()` ignored the actor it was handed.
 * `CrossFleetIsolationTest` asserted the exact opposite — a client sees none —
 * and passed too, because it called the scope directly and the endpoint never
 * did. Two mandated suites in flat contradiction, both green, for a fortnight.
 *
 * ADR-0005's point survives intact and is what the repointed test says: the
 * roster is not divided up by *client*. It was never a claim that a client may
 * read it.
 */
it('shows a client none of the roster, phone numbers and licences included', function () {
    ['driverA' => $driverA, 'userA' => $userA] = seedTwoTenantsWithDrivers();

    $body = $this->actingAs($userA, 'sanctum')->getJson('/api/v1/drivers')->assertOk()->json('data');

    // Empty, not filtered-down: a client owns no drivers at any fleet, so
    // there is no subset that would be correct to show them.
    expect($body)->toHaveCount(0)
        ->and(collect($body)->pluck('id'))->not->toContain($driverA->id);
});

it('lets any tenant open any driver in the roster', function () {
    ['driverB' => $driverB, 'userA' => $userA] = seedTwoTenantsWithDrivers();

    $this->actingAs($userA, 'sanctum')
        ->getJson("/api/v1/drivers/{$driverB->id}")
        ->assertOk()
        ->assertJsonPath('data.id', $driverB->id);
});

it('no longer hides a driver at the model level', function () {
    ['tenantA' => $tenantA, 'driverB' => $driverB] = seedTwoTenantsWithDrivers();

    app(TenantContext::class)->set($tenantA->id);

    // Driver has no BelongsToTenant since ADR-0005. Asserted so that adding
    // it back is a failing test rather than a silent halving of the roster.
    expect(Driver::find($driverB->id))->not->toBeNull();
});

it('allows fetching and updating your own tenant\'s driver', function () {
    ['driverA' => $driverA, 'userA' => $userA] = seedTwoTenantsWithDrivers();

    $this->actingAs($userA, 'sanctum')
        ->getJson("/api/v1/drivers/{$driverA->id}")
        ->assertOk()
        ->assertJsonPath('data.id', $driverA->id);

    $this->actingAs($userA, 'sanctum')
        ->patchJson("/api/v1/drivers/{$driverA->id}", ['status' => 'suspended'])
        ->assertOk()
        ->assertJsonPath('data.status', 'suspended');
});
