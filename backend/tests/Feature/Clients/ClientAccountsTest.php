<?php

declare(strict_types=1);

use App\Enums\AccessLevel;
use App\Enums\Permission;
use App\Enums\RoleAudience;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Operator;
use App\Models\Tenant;
use App\Models\User;
use Modules\Administration\Models\Role;
use Modules\Clients\Models\Company;

/**
 * Who head office can act as at a corporate client (ADR-0056).
 *
 * ADR-0056 quotes the owner on what head office's people actually do: *"can
 * log in as to any fleet, **corporate client**, walk-in client and drivers."*
 * The fleet half shipped with `OperatorAccountController`; this is the client
 * half, and the property worth more than the endpoint is the gate.
 *
 * `CompanyPolicy::view` is `companies.view` — a permission a **client's own**
 * administrator holds for their own profile. Borrowing it here would have
 * handed one client's administrator nothing (the tenant scope stops them at
 * the route binding) but would have handed every head-office reader with a
 * directory grant a roster of named employees at every client on the platform,
 * for no reason ADR-0062 recognises. So the test that matters is the third:
 * **head office without `support.act-as` is refused.**
 */
function clientRosterCompany(): Company
{
    return Company::factory()->forTenant(Tenant::factory()->create())->create([
        'legal_name' => 'Centenary Bank',
    ]);
}

function clientPerson(Company $company, string $name, UserRole $role = UserRole::CORPORATE_ADMIN): User
{
    return User::factory()->create([
        'name' => $name,
        'role' => $role,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => $company->tenant_id,
        'operator_id' => null,
        'access_level' => AccessLevel::CLIENT,
    ]);
}

function headOfficeHolding(Permission ...$permissions): User
{
    $role = Role::create([
        'slug' => 'kangaru-roster-'.fake()->unique()->numerify('###'),
        'name' => 'Head Office',
        'audience' => RoleAudience::KANGARU,
        'description' => 'Head office, for this test.',
        'permissions' => array_map(fn (Permission $p) => $p->value, $permissions),
        'requires_mfa' => false,
        'is_system' => false,
    ]);

    $user = new User([
        'name' => 'Head Office',
        'email' => 'hq-'.fake()->unique()->numerify('###').'@kangaruride.test',
        'password' => 'password',
        'role' => $role->slug,
    ]);
    $user->status = UserStatus::ACTIVE;
    $user->access_level = AccessLevel::KANGARU;
    $user->save();

    return $user;
}

it('gives head office somebody to name at a corporate client', function () {
    $company = clientRosterCompany();
    clientPerson($company, 'Achen Brenda');
    clientPerson($company, 'Zawedde Grace');

    $response = $this->actingAs(headOfficeHolding(Permission::SUPPORT_ACT_AS))
        ->getJson("/api/v1/companies/{$company->id}/accounts");

    $response->assertOk();

    // By name, because a picker sorted by insertion order is a picker somebody
    // scrolls twice.
    expect(array_column($response->json('data'), 'name'))
        ->toBe(['Achen Brenda', 'Zawedde Grace']);
});

it('never lists another client’s people', function () {
    $company = clientRosterCompany();
    clientPerson($company, 'Achen Brenda');

    $other = clientRosterCompany();
    clientPerson($other, 'Somebody Else');

    $response = $this->actingAs(headOfficeHolding(Permission::SUPPORT_ACT_AS))
        ->getJson("/api/v1/companies/{$company->id}/accounts");

    expect(array_column($response->json('data'), 'name'))->toBe(['Achen Brenda']);
});

it('refuses head office that can read the directory but cannot act as anybody', function () {
    $company = clientRosterCompany();
    clientPerson($company, 'Achen Brenda');

    // The whole point of the endpoint's own policy method. This reader can
    // open the client's record — `companies.view` — and must still not be
    // handed a list of that client's employees.
    $this->actingAs(headOfficeHolding(Permission::COMPANIES_VIEW))
        ->getJson("/api/v1/companies/{$company->id}/accounts")
        ->assertForbidden();
});

it('refuses the client’s own administrator, who has /users for this', function () {
    $company = clientRosterCompany();
    $admin = clientPerson($company, 'Achen Brenda');

    $this->actingAs($admin)
        ->getJson("/api/v1/companies/{$company->id}/accounts")
        ->assertForbidden();
});

it('refuses a fleet account, which cannot reach another organisation’s roster', function () {
    $company = clientRosterCompany();
    clientPerson($company, 'Achen Brenda');

    $dispatcher = User::factory()->create([
        'role' => UserRole::DISPATCHER,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => null,
        'operator_id' => Operator::query()->firstOrFail()->id,
        'access_level' => AccessLevel::FLEET,
    ]);

    $this->actingAs($dispatcher)
        ->getJson("/api/v1/companies/{$company->id}/accounts")
        ->assertForbidden();
});

/*
 * There is deliberately no test that a non-client row carrying this tenant is
 * filtered out.
 *
 * It was written, and the database refused to stage it: the CHECK constraint
 * `users_access_level_matches_columns` rejected the fixture with SQLSTATE
 * 45000, through `saveQuietly` and a raw update alike. `AccessLevel::permits()`
 * pins a FLEET row to no tenant, and the migration writes the same clause in
 * SQL — so a row that is both is not merely unwritten by the application, it
 * cannot exist.
 *
 * The controller's `access_level` filter therefore guards nothing today. It
 * stays because it makes the endpoint readable on its own terms — "client
 * accounts", not "whoever shares this tenant id" — and `AccessLevelInvariantTest`
 * is where the constraint that makes the two identical is actually proved.
 */
