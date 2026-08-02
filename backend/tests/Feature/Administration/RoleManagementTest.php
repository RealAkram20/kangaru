<?php

use App\Enums\Permission;
use App\Enums\UserRole;
use App\Models\AuditLog;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Modules\Administration\Models\Role;

/**
 * The role catalogue (ADR-0004).
 *
 * Roles are data now, and this is where a Super Admin composes them. The
 * tests that matter are the two escalation points — a role cannot be
 * *defined* with permissions its author lacks, and cannot be *assigned* to
 * somebody by an administrator who lacks them — plus the refusal to delete
 * a role people still hold, which would fail closed and silently strip
 * their access.
 */

/**
 * @return array{owner: User, admin: User, tenant: Tenant}
 */
function roleFixture(): array
{
    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $owner = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
    $admin = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_ADMIN]);

    return compact('owner', 'admin', 'tenant');
}

it('seeds the ten roles from PROJECT.md as system roles', function () {
    expect(Role::query()->count())->toBe(count(UserRole::cases()));
    expect(Role::query()->where('is_system', true)->count())->toBe(count(UserRole::cases()));

    // The Super Admin holds the whole catalogue — that is what makes the
    // subset rule work at the top.
    $owner = Role::query()->where('slug', 'super_admin')->firstOrFail();
    expect($owner->permissions)->toEqualCanonicalizing(Permission::allValues());
});

it('lets a Super Admin create a custom role', function () {
    ['owner' => $owner] = roleFixture();

    $response = $this->actingAs($owner, 'sanctum')->postJson('/api/v1/roles', [
        'name' => 'Regional Auditor',
        'description' => 'Reads everything, changes nothing.',
        'permissions' => [
            Permission::AUDIT_VIEW->value,
            Permission::REPORTS_VIEW->value,
            Permission::TRIPS_VIEW_ALL->value,
            Permission::INVOICES_VIEW->value,
        ],
    ])->assertStatus(201);

    expect($response->json('data.slug'))->toBe('regional_auditor');
    expect($response->json('data.is_system'))->toBeFalse();

    // And it is immediately usable: a role is only real once somebody can
    // hold it.
    $auditor = User::factory()->create(['tenant_id' => null, 'role' => 'regional_auditor']);

    expect($auditor->hasPermission(Permission::AUDIT_VIEW))->toBeTrue();
    expect($auditor->hasPermission(Permission::INVOICES_CREATE))->toBeFalse();
});

it('gives a custom role exactly the access it was granted, and no more', function () {
    ['owner' => $owner, 'tenant' => $tenant] = roleFixture();

    $this->actingAs($owner, 'sanctum')->postJson('/api/v1/roles', [
        'name' => 'Read Only Ops',
        'permissions' => [Permission::TRIPS_VIEW_ALL->value, Permission::REPORTS_VIEW->value],
    ])->assertStatus(201);

    $user = User::factory()->create(['tenant_id' => $tenant->id, 'role' => 'read_only_ops']);

    // The whole point of the feature: this combination was not expressible
    // before, and it is enforced by the same policies as everything else.
    $this->actingAs($user, 'sanctum')->getJson('/api/v1/trips')->assertOk();
    $this->actingAs($user, 'sanctum')->getJson('/api/v1/reports/trips')->assertOk();
    $this->actingAs($user, 'sanctum')->getJson('/api/v1/invoices')->assertForbidden();
    $this->actingAs($user, 'sanctum')->getJson('/api/v1/users')->assertForbidden();

    // This line used to assert 200 on the *financial* report, which
    // contradicted the test's own name: the role holds `reports.view` and
    // not `invoices.view`, so a report of invoiced, credited and
    // outstanding totals is more than it was granted. `reports.view` gated
    // all four reports at the time, so the assertion recorded the gap
    // rather than the intent. See ReportAuthorizationTest.
    $this->actingAs($user, 'sanctum')->getJson('/api/v1/reports/financial')->assertForbidden();

    // A complete payload on purpose: an empty one would 422 on validation
    // before the policy ever ran, and a test that accepts 422 as proof of
    // refusal would keep passing if the permission check disappeared.
    $this->actingAs($user, 'sanctum')->postJson('/api/v1/vehicles', [
        'registration_number' => 'UAA 999Z',
        'make' => 'Toyota',
        'model' => 'Hiace',
        'year' => 2021,
        'category' => 'van',
        'seating_capacity' => 12,
    ])->assertForbidden();
});

it('refuses to define a role granting more than its author holds', function () {
    ['admin' => $admin] = roleFixture();

    // A Corporate Admin does not hold `roles.manage`, so they are refused
    // outright — but the check that matters is the one below it, for
    // somebody who *can* author roles.
    $this->actingAs($admin, 'sanctum')->postJson('/api/v1/roles', [
        'name' => 'Anything',
        'permissions' => [Permission::REPORTS_VIEW->value],
    ])->assertForbidden();
});

it('refuses a role that grants permissions the author lacks', function () {
    ['tenant' => $tenant] = roleFixture();

    // A curator who can manage roles but cannot invoice. Without the check
    // at definition time they could author a role carrying
    // `invoices.create`, assign it to themselves-by-proxy, and the
    // assignment-time subset check would then pass because by then they
    // would hold it.
    Role::create([
        'slug' => 'role_curator',
        'name' => 'Role Curator',
        'is_system' => false,
        'permissions' => [Permission::ROLES_MANAGE->value, Permission::STAFF_MANAGE->value],
    ]);

    $curator = User::factory()->create(['tenant_id' => $tenant->id, 'role' => 'role_curator']);

    $this->actingAs($curator, 'sanctum')->postJson('/api/v1/roles', [
        'name' => 'Sneaky Biller',
        'permissions' => [Permission::INVOICES_CREATE->value],
    ])->assertStatus(422)->assertJsonValidationErrors('permissions');

    expect(Role::query()->where('slug', 'sneaky_biller')->exists())->toBeFalse();
});

it('refuses an invented permission', function () {
    ['owner' => $owner] = roleFixture();

    // The catalogue lives in code. A role granting a string no policy
    // checks would confer nothing while appearing to confer something.
    $this->actingAs($owner, 'sanctum')->postJson('/api/v1/roles', [
        'name' => 'Wishful',
        'permissions' => ['everything.always'],
    ])->assertStatus(422)->assertJsonValidationErrors('permissions.0');
});

it('refuses a role that grants nothing', function () {
    ['owner' => $owner] = roleFixture();

    $this->actingAs($owner, 'sanctum')->postJson('/api/v1/roles', [
        'name' => 'Useless',
        'permissions' => [],
    ])->assertStatus(422)->assertJsonValidationErrors('permissions');
});

it('lets a system role\'s permissions be edited but not its name', function () {
    ['owner' => $owner] = roleFixture();

    // The point of the feature: a client who wants Dispatchers to stop
    // seeing rate cards should not need a release.
    $this->actingAs($owner, 'sanctum')->patchJson('/api/v1/roles/dispatcher', [
        'permissions' => [Permission::TRIPS_VIEW_ALL->value, Permission::BOOKINGS_DISPATCH->value],
    ])->assertOk();

    expect(Role::query()->where('slug', 'dispatcher')->firstOrFail()->permissions)
        ->toEqualCanonicalizing([Permission::TRIPS_VIEW_ALL->value, Permission::BOOKINGS_DISPATCH->value]);

    // But renaming it would orphan every account holding the slug.
    $this->actingAs($owner, 'sanctum')->patchJson('/api/v1/roles/dispatcher', [
        'name' => 'Traffic Controller',
    ])->assertStatus(422)->assertJsonValidationErrors('name');
});

it('stops a Super Admin removing role management from their own role', function () {
    ['owner' => $owner] = roleFixture();

    // One click from a console-only recovery if they are the sole holder.
    $this->actingAs($owner, 'sanctum')->patchJson('/api/v1/roles/super_admin', [
        'permissions' => [Permission::REPORTS_VIEW->value],
    ])->assertStatus(422)->assertJsonValidationErrors('permissions');
});

it('refuses to delete a role people still hold', function () {
    ['owner' => $owner, 'tenant' => $tenant] = roleFixture();

    $this->actingAs($owner, 'sanctum')->postJson('/api/v1/roles', [
        'name' => 'Temp Staff',
        'permissions' => [Permission::BOOKINGS_CREATE->value],
    ])->assertStatus(201);

    User::factory()->create(['tenant_id' => $tenant->id, 'role' => 'temp_staff']);

    // Deleting it would leave that account resolving to no permissions —
    // which fails closed, so a silent and total loss of access rather than
    // an error anybody can read.
    $this->actingAs($owner, 'sanctum')
        ->deleteJson('/api/v1/roles/temp_staff')
        ->assertStatus(409)
        ->assertJsonPath('code', 'ROLE_IN_USE');

    expect(Role::query()->where('slug', 'temp_staff')->exists())->toBeTrue();
});

it('deletes an unused custom role but never a system one', function () {
    ['owner' => $owner] = roleFixture();

    $this->actingAs($owner, 'sanctum')->postJson('/api/v1/roles', [
        'name' => 'Unused',
        'permissions' => [Permission::BOOKINGS_CREATE->value],
    ])->assertStatus(201);

    $this->actingAs($owner, 'sanctum')->deleteJson('/api/v1/roles/unused')->assertOk();
    expect(Role::query()->where('slug', 'unused')->exists())->toBeFalse();

    // System roles are referred to by slug from seeders, tests and every
    // existing users.role value.
    $this->actingAs($owner, 'sanctum')->deleteJson('/api/v1/roles/dispatcher')->assertForbidden();
    expect(Role::query()->where('slug', 'dispatcher')->exists())->toBeTrue();
});

it('audits a permission change with a before and after', function () {
    ['owner' => $owner] = roleFixture();

    $this->actingAs($owner, 'sanctum')->patchJson('/api/v1/roles/driver', [
        'permissions' => [Permission::TRIPS_TRANSITION_OWN->value],
    ])->assertOk();

    // AGENTS.md requires an audit trail over "roles/permissions". Since
    // this pass that is literally this model.
    //
    // allTenants(), because a Role has no tenant — the catalogue is
    // platform-wide (ADR-0004) — so its audit row carries a null tenant_id
    // and TenantScope hides it from any tenant-bound query. Worth knowing:
    // a Corporate Admin's audit log will never show role changes. That is
    // right, since they cannot make them, but it means the platform's own
    // audit trail needs a reader that is not tenant-scoped.
    $entry = AuditLog::allTenants()
        ->where('auditable_type', 'role')
        ->latest('id')
        ->first();

    expect($entry)->not->toBeNull();
    expect($entry->user_id)->toBe($owner->id);
});

it('forbids everyone without roles.manage from writing, and shows the catalogue to staff admins', function () {
    ['owner' => $owner, 'admin' => $admin, 'tenant' => $tenant] = roleFixture();

    // A Corporate Admin assigns roles, so they must be able to read them —
    // but they may not author them.
    $this->actingAs($admin, 'sanctum')->getJson('/api/v1/roles')->assertOk();
    $this->actingAs($admin, 'sanctum')->postJson('/api/v1/roles', [
        'name' => 'X', 'permissions' => [Permission::BOOKINGS_CREATE->value],
    ])->assertForbidden();

    // Somebody with neither sees nothing at all.
    $employee = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_EMPLOYEE]);
    $this->actingAs($employee, 'sanctum')->getJson('/api/v1/roles')->assertForbidden();

    // The catalogue travels with the listing so the editor holds no copy.
    $meta = $this->actingAs($owner, 'sanctum')->getJson('/api/v1/roles')->json('meta');
    expect($meta['catalogue'])->toHaveKey('Billing');
    expect($meta['can_manage'])->toBeTrue();
});
