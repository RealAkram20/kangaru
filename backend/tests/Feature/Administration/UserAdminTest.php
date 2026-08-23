<?php

use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\AuditLog;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;

/**
 * Staff administration.
 *
 * Until this module existed every account in the platform came from a
 * seeder: there was no way to onboard a colleague, change a role, or take
 * access away when somebody left.
 *
 * The tests that matter most here are not the CRUD ones. They are the
 * escalation boundary (nobody mints a Super Admin but a Super Admin), the
 * tenant boundary (`User` has no BelongsToTenant, so nothing scopes these
 * reads for us), and the fact that suspension actually reaches a session
 * that is already signed in.
 */

/**
 * @return array<string, mixed>
 */
function staffFixture(): array
{
    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $admin = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_ADMIN,
        'name' => 'Ada Nakato',
    ]);

    $staff = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
        'name' => 'Grace Amongin',
    ]);

    $superAdmin = User::factory()->create([
        'tenant_id' => null,
        'role' => UserRole::SUPER_ADMIN,
        'name' => 'Platform Owner',
    ]);

    return compact('tenant', 'admin', 'staff', 'superAdmin');
}

it('lists a tenant\'s staff for its administrator', function () {
    ['admin' => $admin] = staffFixture();

    $response = $this->actingAs($admin, 'sanctum')->getJson('/api/v1/users')->assertOk();

    expect($response->json('data'))->toHaveCount(2);
    expect(array_column($response->json('data'), 'name'))->toContain('Ada Nakato', 'Grace Amongin');
});

it('never shows a Corporate Admin the platform accounts or another tenant\'s', function () {
    ['admin' => $admin] = staffFixture();
    ['staff' => $otherTenantStaff] = staffFixture();

    // `User` deliberately has no BelongsToTenant — login must find an
    // account before any tenant is known — so nothing scopes this
    // automatically. A forgotten `where` here leaks names, emails and roles
    // across tenants, which ADR-0001 calls the worst bug this platform can
    // have.
    $response = $this->actingAs($admin, 'sanctum')->getJson('/api/v1/users')->assertOk();

    $emails = array_column($response->json('data'), 'email');

    expect($response->json('data'))->toHaveCount(2);
    expect($emails)->not->toContain($otherTenantStaff->email);
    // And no Super Admin, whose tenant_id is null.
    expect(array_column($response->json('data'), 'role'))->not->toContain('super_admin');
});

it('refuses a Corporate Admin another tenant\'s account directly', function () {
    ['admin' => $admin] = staffFixture();
    ['staff' => $otherTenantStaff] = staffFixture();

    $this->actingAs($admin, 'sanctum')
        ->getJson("/api/v1/users/{$otherTenantStaff->id}")
        ->assertForbidden();

    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/users/{$otherTenantStaff->id}", ['name' => 'Renamed'])
        ->assertForbidden();

    expect($otherTenantStaff->refresh()->name)->not->toBe('Renamed');
});

it('creates a colleague in the administrator\'s own tenant', function () {
    ['tenant' => $tenant, 'admin' => $admin] = staffFixture();
    $otherTenant = Tenant::factory()->create();

    $response = $this->actingAs($admin, 'sanctum')->postJson('/api/v1/users', [
        'name' => 'Peter Ochieng',
        'email' => 'peter@centenary-bank.test',
        // corporate_employee, not dispatcher: since ADR-0004 an
        // administrator may only assign roles contained by their own
        // permissions, and Dispatcher carries dispatch abilities a
        // Corporate Admin does not hold.
        'role' => 'corporate_employee',
        'phone' => '+256700000001',
        'password' => 'a-long-enough-password',
        // A real, existing tenant that is not theirs — so the assertion
        // below proves the field is *ignored* rather than merely rejected
        // by the `exists` rule. Planting a colleague in another tenant is
        // the interesting failure, and it has to be attemptable to be
        // tested.
        'tenant_id' => $otherTenant->id,
    ])->assertStatus(201);

    expect($response->json('data.tenant_id'))->toBe($tenant->id);
    expect($response->json('data.status'))->toBe('active');

    $created = User::where('email', 'peter@centenary-bank.test')->firstOrFail();
    expect($created->tenant_id)->toBe($tenant->id);
    // Stored hashed by the model's `hashed` cast, never in the clear.
    expect($created->password)->not->toBe('a-long-enough-password');
});

it('lets the new colleague sign in with the password they were given', function () {
    ['admin' => $admin] = staffFixture();

    $this->actingAs($admin, 'sanctum')->postJson('/api/v1/users', [
        'name' => 'Peter Ochieng',
        'email' => 'peter@centenary-bank.test',
        'role' => 'corporate_employee',
        'phone' => '+256700000002',
        'password' => 'a-long-enough-password',
    ])->assertStatus(201);

    // The whole point of the feature: an account that cannot be used is not
    // an onboarded colleague.
    $this->postJson('/api/v1/auth/login', [
        'email' => 'peter@centenary-bank.test',
        'password' => 'a-long-enough-password',
    ])->assertOk()->assertJsonPath('data.user.role', 'corporate_employee');
});

it('stops a Corporate Admin minting a Super Admin', function () {
    ['admin' => $admin] = staffFixture();

    // The escalation boundary. Without it a tenant administrator can create
    // a platform owner and leave their tenant entirely — privilege
    // escalation dressed up as a staff edit.
    $this->actingAs($admin, 'sanctum')->postJson('/api/v1/users', [
        'name' => 'Sneaky',
        'email' => 'sneaky@centenary-bank.test',
        'role' => 'super_admin',
        'phone' => '+256700000004',
        'password' => 'a-long-enough-password',
    ])->assertStatus(422)->assertJsonValidationErrors('role');

    expect(User::where('email', 'sneaky@centenary-bank.test')->exists())->toBeFalse();
});

it('stops a Corporate Admin promoting an existing colleague to Super Admin', function () {
    ['admin' => $admin, 'staff' => $staff] = staffFixture();

    // The same rule on the other path — otherwise the check is satisfied by
    // creating a user in a safe role and promoting them a second later.
    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/users/{$staff->id}", ['role' => 'super_admin'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('role');

    // A slug string since ADR-0004, not an enum case: users.role now
    // holds custom slugs too.
    expect($staff->refresh()->roleSlug())->toBe('corporate_employee');
});

it('lets a Super Admin appoint another Super Admin', function () {
    ['superAdmin' => $superAdmin] = staffFixture();

    $this->actingAs($superAdmin, 'sanctum')->postJson('/api/v1/users', [
        'name' => 'Second Owner',
        'email' => 'owner2@kangaruride.test',
        'role' => 'super_admin',
        'phone' => '+256700000005',
        'password' => 'a-long-enough-password',
    ])->assertStatus(201);
});

it('refuses to let an administrator change their own role or suspend themselves', function () {
    ['admin' => $admin] = staffFixture();

    // Self-promotion, and locking the tenant's last administrator out.
    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/users/{$admin->id}", ['role' => 'super_admin'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('role');

    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/users/{$admin->id}", ['status' => 'suspended'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('status');

    expect($admin->refresh()->status)->toBe(UserStatus::ACTIVE);
});

it('suspends an account, stamps the clock, and stops the sign-in', function () {
    ['admin' => $admin, 'staff' => $staff] = staffFixture();

    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/users/{$staff->id}", ['status' => 'suspended'])
        ->assertOk()
        ->assertJsonPath('data.is_active', false);

    $staff->refresh();
    expect($staff->status)->toBe(UserStatus::SUSPENDED);
    // AGENTS.md wants ex-employee accounts anonymised 90 days after
    // deactivation; that clock needs its own timestamp.
    expect($staff->deactivated_at)->not->toBeNull();

    // Refused with the same message a wrong password gets: saying "this
    // account is suspended" confirms the address is real and the password
    // correct, which is what a credential-stuffing run wants to learn.
    $this->postJson('/api/v1/auth/login', ['email' => $staff->email, 'password' => 'password'])
        ->assertStatus(401)
        ->assertJsonPath('code', 'INVALID_CREDENTIALS');
});

it('signs a suspended user out of sessions they already had', function () {
    ['admin' => $admin, 'staff' => $staff] = staffFixture();

    $staff->createToken('phone');
    $staff->createToken('laptop');
    expect($staff->tokens()->count())->toBe(2);

    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/users/{$staff->id}", ['status' => 'suspended'])
        ->assertOk();

    // Suspension that only blocks the login form is not suspension: a token
    // issued yesterday keeps working until it expires, so a dismissed
    // employee stays signed in on their phone while the staff list says
    // otherwise.
    //
    // Asserted on the token rows rather than by replaying a bearer header:
    // `actingAs` fixes the authenticated user for the rest of the test and
    // would answer 200 from the admin's session no matter what header the
    // request carried — a green test proving nothing.
    expect($staff->tokens()->count())->toBe(0);
});

it('leaves other people\'s sessions alone when one account is suspended', function () {
    ['admin' => $admin, 'staff' => $staff] = staffFixture();

    $staff->createToken('phone');
    $admin->createToken('laptop');

    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/users/{$staff->id}", ['status' => 'suspended'])
        ->assertOk();

    // Revocation is scoped to the account being suspended. Signing the
    // whole tenant out because one person left would be a memorable
    // afternoon.
    expect($staff->tokens()->count())->toBe(0);
    expect($admin->tokens()->count())->toBe(1);
});

it('clears the deactivation clock when an account is restored', function () {
    ['admin' => $admin, 'staff' => $staff] = staffFixture();

    $this->actingAs($admin, 'sanctum')->patchJson("/api/v1/users/{$staff->id}", ['status' => 'suspended']);
    $this->actingAs($admin, 'sanctum')->patchJson("/api/v1/users/{$staff->id}", ['status' => 'active'])->assertOk();

    // A reactivated account is not an ex-employee. Leaving the timestamp
    // would queue them for anonymisation while they are still working.
    expect($staff->refresh()->deactivated_at)->toBeNull();
    $this->postJson('/api/v1/auth/login', ['email' => $staff->email, 'password' => 'password'])->assertOk();
});

it('audits a role change with a before and after', function () {
    ['admin' => $admin, 'staff' => $staff] = staffFixture();

    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/users/{$staff->id}", ['role' => 'corporate_admin'])
        ->assertOk();

    // AGENTS.md requires an audit trail over "roles/permissions" changes.
    // User is Auditable, so this is the trait doing its job — asserted
    // because a role change that leaves no trace is the finding a bank
    // auditor is looking for.
    $entry = AuditLog::query()
        ->where('auditable_type', 'user')
        ->where('auditable_id', $staff->id)
        ->latest('id')
        ->first();

    expect($entry)->not->toBeNull();
    expect($entry->user_id)->toBe($admin->id);
    expect(json_encode($entry->changes))->toContain('corporate_admin');
});

it('forbids everyone who is not an administrator', function () {
    ['tenant' => $tenant, 'staff' => $staff] = staffFixture();

    foreach ([UserRole::DISPATCHER, UserRole::FINANCE, UserRole::OPERATIONS_MANAGER, UserRole::CORPORATE_EMPLOYEE] as $role) {
        $user = User::factory()->create(['tenant_id' => $tenant->id, 'role' => $role]);

        $this->actingAs($user, 'sanctum')->getJson('/api/v1/users')->assertForbidden();
        $this->actingAs($user, 'sanctum')->postJson('/api/v1/users', [
            'name' => 'X', 'email' => "x{$role->value}@t.test", 'phone' => '+256700000000', 'role' => 'driver', 'password' => 'a-long-enough-password',
        ])->assertForbidden();
        $this->actingAs($user, 'sanctum')
            ->patchJson("/api/v1/users/{$staff->id}", ['name' => 'Renamed'])
            ->assertForbidden();
    }
});

it('offers only the roles an administrator\'s own permissions contain', function () {
    ['admin' => $admin, 'superAdmin' => $superAdmin] = staffFixture();

    $forAdmin = array_column(
        $this->actingAs($admin, 'sanctum')->getJson('/api/v1/users')->json('meta.assignable_roles'),
        'value',
    );
    $forOwner = array_column(
        $this->actingAs($superAdmin, 'sanctum')->getJson('/api/v1/users')->json('meta.assignable_roles'),
        'value',
    );

    // ADR-0004's subset rule, and the one place it deliberately tightens
    // behaviour: a Corporate Admin used to be able to assign anything but
    // Super Admin. They set the new account's initial password, so being
    // able to assign a role is being able to *become* it — and Dispatcher
    // carries abilities they do not hold.
    expect($forAdmin)->toContain('corporate_employee', 'corporate_admin');
    expect($forAdmin)->not->toContain('dispatcher', 'finance', 'super_admin');

    // A Super Admin holds everything, so everything is assignable.
    expect($forOwner)->toHaveCount(count(UserRole::cases()));
    expect($forOwner)->toContain('super_admin');
});

it('refuses a role carrying permissions the administrator lacks', function () {
    ['admin' => $admin, 'staff' => $staff] = staffFixture();

    // Not an escalation to Super Admin — a lateral one. Dispatcher can
    // assign vehicles, which a Corporate Admin cannot, and an administrator
    // who sets the password could then sign in as them.
    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/users/{$staff->id}", ['role' => 'dispatcher'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('role');
});

it('rejects a filter the staff list does not accept', function () {
    ['admin' => $admin] = staffFixture();

    $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/users?tenant_id=2')
        ->assertStatus(422)
        ->assertJsonValidationErrors('tenant_id');
});

it('refuses a duplicate email rather than a 500', function () {
    ['admin' => $admin, 'staff' => $staff] = staffFixture();

    $this->actingAs($admin, 'sanctum')->postJson('/api/v1/users', [
        'name' => 'Clash',
        'email' => $staff->email,
        'role' => 'driver',
        'phone' => '+256700000006',
        'password' => 'a-long-enough-password',
    ])->assertStatus(422)->assertJsonValidationErrors('email');
});
