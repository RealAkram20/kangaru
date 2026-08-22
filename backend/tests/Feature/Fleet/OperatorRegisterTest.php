<?php

declare(strict_types=1);

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Operator;
use App\Models\Plan;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Modules\Fleet\Services\OperatorService;

/**
 * The register of fleet companies (`K2`, ADR-0055, ADR-0059).
 *
 * This package removes a rail that was put up on purpose. `Operator`'s own
 * docblock said *"There is deliberately no way to create a second one"* —
 * because between `F0` and `F2` the operational tables carried `operator_id`
 * and nothing filtered on it. `F2` closed that and `K0` proved the schema on
 * MySQL, so creation is offered here.
 *
 * **The refusals are the deliverable, not the endpoints.** A test that head
 * office can onboard a fleet proves nothing about who else can.
 */
function headOffice(): User
{
    return User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => null,
        'operator_id' => null,
        'access_level' => AccessLevel::KANGARU,
    ]);
}

function fleetSuperAdmin(): User
{
    return User::factory()->create([
        'role' => UserRole::SUPER_ADMIN,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => null,
        'operator_id' => Operator::SHANITAH,
        'access_level' => AccessLevel::FLEET,
    ]);
}

it('lets head office onboard a fleet, and creates its first account in the same act', function () {
    $response = $this->actingAs(headOffice(), 'sanctum')
        ->postJson('/api/v1/operators', [
            'name' => 'Second Fleet Ltd',
            'owner_name' => 'Miriam Achieng',
            'owner_email' => 'miriam@secondfleet.test',
        ])
        ->assertCreated();

    $id = $response->json('data.id');

    // ADR-0059 §5: you act as a person, not an organisation, so a fleet with
    // no account is unreachable to support forever.
    $owner = User::query()->where('operator_id', $id)->sole();

    expect($owner->email)->toBe('miriam@secondfleet.test')
        ->and($owner->access_level)->toBe(AccessLevel::FLEET)
        ->and($owner->tenant_id)->toBeNull()
        ->and($response->json('data.users_count'))->toBe(1);
});

/**
 * The failure mode ADR-0059 §5 exists to prevent, checked at the door rather
 * than trusted to the caller.
 */
it('refuses to create a fleet nobody can sign in to', function () {
    $this->actingAs(headOffice(), 'sanctum')
        ->postJson('/api/v1/operators', ['name' => 'Nobody Home Ltd'])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['owner_name', 'owner_email']);

    expect(Operator::query()->where('name', 'Nobody Home Ltd')->exists())->toBeFalse();
});

/**
 * ADR-0058 §1: creation FAILS when nothing is flagged default. It does not
 * fall back to free and it does not fall back to unlimited — an unpriced
 * fleet is a configuration error that should say so at the door, not at the
 * first billing run months later.
 */
it('refuses to onboard a fleet it cannot price', function () {
    Plan::query()->update(['is_default' => false]);

    expect(fn () => app(OperatorService::class)->onboard([
        'name' => 'Unpriced Ltd',
        'owner_name' => 'Someone',
        'owner_email' => 'someone@unpriced.test',
    ]))->toThrow(RuntimeException::class, 'default');

    expect(Operator::query()->where('name', 'Unpriced Ltd')->exists())->toBeFalse();
});

it('gives every fleet a plan, including the one that already existed', function () {
    expect(Operator::query()->whereNull('plan_id')->count())->toBe(0);

    // ADR-0058 §3: Shanitah is grandfathered by a NAMED plan, never by being
    // row 1. Nothing in a billing path should ever need to know an id.
    expect(Operator::query()->find(Operator::SHANITAH)?->plan?->slug)->toBe('founding-fleet');
});

/**
 * The whole point of the level check in `OperatorPolicy`. A fleet's Super
 * Admin holds `fleets.manage` — `StoreRoleRequest` makes an ungrantable
 * permission impossible — and must still be refused every one of these.
 */
it("refuses a fleet's own super admin the register, every method", function () {
    $fleetAdmin = fleetSuperAdmin();
    $operator = Operator::query()->findOrFail(Operator::SHANITAH);

    $this->actingAs($fleetAdmin, 'sanctum')->getJson('/api/v1/operators')->assertForbidden();
    $this->actingAs($fleetAdmin, 'sanctum')->getJson("/api/v1/operators/{$operator->id}")->assertForbidden();
    $this->actingAs($fleetAdmin, 'sanctum')->patchJson("/api/v1/operators/{$operator->id}", ['name' => 'Renamed'])->assertForbidden();
    $this->actingAs($fleetAdmin, 'sanctum')
        ->postJson('/api/v1/operators', [
            'name' => 'Sneaky Ltd',
            'owner_name' => 'A',
            'owner_email' => 'a@sneaky.test',
        ])
        ->assertForbidden();

    expect(Operator::query()->where('name', 'Sneaky Ltd')->exists())->toBeFalse();
    expect($operator->refresh()->name)->not->toBe('Renamed');
});

it("refuses a corporate client's administrator the register", function () {
    $tenant = Tenant::factory()->create();

    $clientAdmin = User::factory()->create([
        'role' => UserRole::CORPORATE_ADMIN,
        'status' => UserStatus::ACTIVE,
        'tenant_id' => $tenant->id,
        'operator_id' => null,
        'access_level' => AccessLevel::CLIENT,
    ]);

    $this->actingAs($clientAdmin, 'sanctum')->getJson('/api/v1/operators')->assertForbidden();
});

/**
 * `OperatorPolicy::delete()` is `false` and no route exists. Six operational
 * tables carry `operator_id` and `operator_client` restricts on delete, so a
 * removal would either fail against its own history or orphan it.
 */
it('offers no way to delete a fleet, only to suspend one', function () {
    $operator = Operator::query()->findOrFail(Operator::SHANITAH);

    $this->actingAs(headOffice(), 'sanctum')
        ->deleteJson("/api/v1/operators/{$operator->id}")
        ->assertStatus(405);

    $this->actingAs(headOffice(), 'sanctum')
        ->patchJson("/api/v1/operators/{$operator->id}", ['status' => 'suspended'])
        ->assertOk()
        ->assertJsonPath('data.status', 'suspended')
        ->assertJsonPath('data.is_active', false);

    // Suspending is commercial, not destructive: the fleet and everything
    // that explains its past survive it.
    expect(Operator::query()->find($operator->id))->not->toBeNull();
});

/**
 * ADR-0055 §2: head office counts what a fleet has and reads none of it. The
 * easiest way to cross that line is to add "one more useful field" to
 * `OperatorResource`, so this pins the shape rather than trusting review.
 */
it('shows head office counts, never a fleet\'s operational data', function () {
    $body = $this->actingAs(headOffice(), 'sanctum')
        ->getJson('/api/v1/operators')
        ->assertOk()
        ->json('data.0');

    expect(array_keys($body))->toEqualCanonicalizing([
        'id', 'name', 'slug', 'status', 'is_active', 'plan',
        'users_count', 'drivers_count', 'vehicles_count', 'clients_count', 'created_at',
    ]);
});

/**
 * The onboarding is one act. A half-created fleet — a row with no account —
 * is the exact state ADR-0059 §5 forbids, so the transaction has to hold.
 *
 * **Driven through the service, not the endpoint, and that is the point.**
 * The first version of this test posted a duplicate email and asserted 422.
 * It passed against a deliberately broken transaction, because
 * `StoreOperatorRequest` rejects the duplicate before the service is ever
 * called — so it proved the validation rule and said nothing about the
 * rollback. Mutation is what caught that; the endpoint can never reach the
 * failure this guards.
 *
 * Calling the service directly reproduces what validation cannot see: the
 * race where two onboardings pass validation and the second loses to the
 * unique index.
 */
it('creates neither the fleet nor the account when the account cannot be made', function () {
    $existing = User::factory()->create(['email' => 'taken@secondfleet.test']);

    $before = Operator::query()->count();

    expect(fn () => app(OperatorService::class)->onboard([
        'name' => 'Half Made Ltd',
        'owner_name' => 'Duplicate',
        'owner_email' => $existing->email,
    ]))->toThrow(QueryException::class);

    expect(Operator::query()->count())->toBe($before)
        ->and(Operator::query()->where('name', 'Half Made Ltd')->exists())->toBeFalse();
});

/**
 * The endpoint's half of the same protection, which is a different rule
 * living in a different layer. Kept beside the rollback test so neither is
 * mistaken for the other.
 */
it('refuses at the door when the owner email is already taken', function () {
    $existing = User::factory()->create(['email' => 'already@secondfleet.test']);

    $this->actingAs(headOffice(), 'sanctum')
        ->postJson('/api/v1/operators', [
            'name' => 'Duplicate Owner Ltd',
            'owner_name' => 'Duplicate',
            'owner_email' => $existing->email,
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['owner_email']);
});

it('keeps the slug unique so two fleets cannot share an address', function () {
    DB::table('operators')->where('id', Operator::SHANITAH)->update(['slug' => 'taken-name']);

    $this->actingAs(headOffice(), 'sanctum')
        ->postJson('/api/v1/operators', [
            'name' => 'Taken Name',
            'slug' => 'taken-name',
            'owner_name' => 'Someone',
            'owner_email' => 'someone@taken.test',
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['slug']);
});
