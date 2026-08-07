<?php

use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Tenant;
use App\Models\User;
use Modules\Drivers\Models\Driver;
use Modules\Trips\Models\Trip;

/**
 * ADR-0016 — the driver's sign-in account.
 *
 * The gap this closes was the largest in Phase 1: `drivers.user_id` was
 * read by `TripPolicy` and writable by nothing but a seeder, so a driver
 * onboarded through the API could not sign in, and therefore could not
 * record the odometer readings the Bank's acceptance criteria are made of.
 *
 * These cover the four things that can go wrong: authority (who may mint a
 * login), exclusivity (one profile, one account), revocation (a detached or
 * suspended driver stops being able to act *now*, not at token expiry), and
 * the end-to-end proof that the account can actually drive.
 */
function platformAdminForDriverAccounts(): User
{
    return User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
}

function attachDriverAccount(User $actor, Driver $driver, array $payload)
{
    return test()->actingAs($actor, 'sanctum')
        ->postJson("/api/v1/drivers/{$driver->id}/account", $payload);
}

it('gives a driver a login they can actually sign in with', function () {
    $driver = Driver::factory()->create(['name' => 'Musa Kirya']);

    attachDriverAccount(platformAdminForDriverAccounts(), $driver, [
        'email' => 'musa.kirya@kangaruride.test',
        'password' => 'a-very-long-passphrase',
    ])->assertCreated()->assertJsonPath('data.account.email', 'musa.kirya@kangaruride.test');

    // The whole point of the feature: the credentials work.
    $this->postJson('/api/v1/auth/login', [
        'email' => 'musa.kirya@kangaruride.test',
        'password' => 'a-very-long-passphrase',
    ])->assertOk();

    $driver->refresh();
    expect($driver->user_id)->not->toBeNull();
    // Platform-level, per ADR-0005: a driver is Shanitah's, not a client's.
    expect($driver->user->tenant_id)->toBeNull();
    expect($driver->user->roleSlug())->toBe('driver');
});

it('lets the new account accept its own trip, which is the whole point', function () {
    $driver = Driver::factory()->create();

    attachDriverAccount(platformAdminForDriverAccounts(), $driver, [
        'email' => 'relief@kangaruride.test',
        'password' => 'a-very-long-passphrase',
    ])->assertCreated();

    $trip = Trip::factory()->forDriver($driver)->create();

    // Driven through the endpoint rather than asserted against the policy:
    // before ADR-0016 there was no account to act as at all, and the claim
    // worth proving is that a real request from the new login moves a real
    // trip — not that a policy method returns true.
    $this->actingAs($driver->fresh()->user, 'sanctum')
        ->postJson("/api/v1/trips/{$trip->id}/transitions", ['to' => 'accepted'])
        ->assertOk();

    expect($trip->fresh()->status->value)->toBe('accepted');
});

it('refuses that same transition on somebody else\'s trip', function () {
    $driver = Driver::factory()->create();

    attachDriverAccount(platformAdminForDriverAccounts(), $driver, [
        'email' => 'nosy@kangaruride.test',
        'password' => 'a-very-long-passphrase',
    ])->assertCreated();

    // `trips.transition.own` has to mean *own*. A driver account that could
    // move any trip would be a far worse bug than the one ADR-0016 fixed.
    $someoneElses = Trip::factory()->forDriver(Driver::factory()->create())->create();

    $this->actingAs($driver->fresh()->user, 'sanctum')
        ->postJson("/api/v1/trips/{$someoneElses->id}/transitions", ['to' => 'accepted'])
        ->assertForbidden();
});

it('refuses to mint a login for somebody who may not create accounts', function () {
    // Holds drivers.manage and not staff.manage — the exact shape ADR-0004's
    // escalation rule exists to stop. Without DriverPolicy::manageAccount
    // requiring both, the fleet screen becomes a side door to account
    // creation in any role.
    $depotManager = User::factory()->create([
        'tenant_id' => null,
        'role' => UserRole::DEPOT_MANAGER,
    ]);

    attachDriverAccount($depotManager, Driver::factory()->create(), [
        'email' => 'sneaky@kangaruride.test',
        'password' => 'a-very-long-passphrase',
    ])->assertForbidden();

    expect(User::where('email', 'sneaky@kangaruride.test')->exists())->toBeFalse();
});

it('refuses to grant a role the actor does not hold themselves', function () {
    $corporateAdmin = User::factory()->create([
        'tenant_id' => Tenant::factory()->create()->id,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    attachDriverAccount($corporateAdmin, Driver::factory()->create(), [
        'email' => 'escalated@kangaruride.test',
        'password' => 'a-very-long-passphrase',
        'role' => UserRole::SUPER_ADMIN->value,
    ])->assertStatus(422)->assertJsonPath('code', 'VALIDATION_FAILED');

    expect(User::where('email', 'escalated@kangaruride.test')->exists())->toBeFalse();
});

it('refuses a second account for a driver who already has one', function () {
    $driver = Driver::factory()->create();
    $admin = platformAdminForDriverAccounts();

    attachDriverAccount($admin, $driver, [
        'email' => 'first@kangaruride.test',
        'password' => 'a-very-long-passphrase',
    ])->assertCreated();

    attachDriverAccount($admin, $driver, [
        'email' => 'second@kangaruride.test',
        'password' => 'a-very-long-passphrase',
    ])->assertStatus(409)->assertJsonPath('code', 'DRIVER_ACCOUNT_CONFLICT');

    // And the losing request left nothing behind.
    expect(User::where('email', 'second@kangaruride.test')->exists())->toBeFalse();
});

it('refuses to point one account at two drivers', function () {
    $admin = platformAdminForDriverAccounts();
    $first = Driver::factory()->create();

    attachDriverAccount($admin, $first, [
        'email' => 'shared@kangaruride.test',
        'password' => 'a-very-long-passphrase',
    ])->assertCreated();

    // Sharing an account across profiles would let one phone move both
    // drivers' trips — including recording one driver's odometer against
    // the other's trip.
    attachDriverAccount($admin, Driver::factory()->create(), [
        'user_id' => $first->fresh()->user_id,
    ])->assertStatus(409)->assertJsonPath('code', 'DRIVER_ACCOUNT_CONFLICT');
});

it('adopts an existing unlinked account, the way back for hand-made rows', function () {
    $orphan = User::factory()->create([
        'tenant_id' => null,
        'role' => UserRole::DRIVER,
    ]);
    $driver = Driver::factory()->create();

    attachDriverAccount(platformAdminForDriverAccounts(), $driver, ['user_id' => $orphan->id])
        ->assertCreated()
        ->assertJsonPath('data.account.id', $orphan->id);

    expect($driver->fresh()->user_id)->toBe($orphan->id);
});

it('refuses to adopt an account that could never record a trip', function () {
    $accountant = User::factory()->create(['tenant_id' => null, 'role' => UserRole::FINANCE]);

    attachDriverAccount(platformAdminForDriverAccounts(), Driver::factory()->create(), ['user_id' => $accountant->id])
        ->assertStatus(422);
});

it('rejects a request that tries to be both shapes at once', function () {
    $existing = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);

    attachDriverAccount(platformAdminForDriverAccounts(), Driver::factory()->create(), [
        'user_id' => $existing->id,
        'email' => 'ambiguous@kangaruride.test',
        'password' => 'a-very-long-passphrase',
    ])->assertStatus(422);
});

it('closes live sessions when the login is taken away', function () {
    $driver = Driver::factory()->create();
    $admin = platformAdminForDriverAccounts();

    attachDriverAccount($admin, $driver, [
        'email' => 'leaver@kangaruride.test',
        'password' => 'a-very-long-passphrase',
    ])->assertCreated();

    $account = $driver->fresh()->user;
    $account->createToken('phone-in-the-cab');
    expect($account->tokens()->count())->toBe(1);

    $this->actingAs($admin, 'sanctum')
        ->deleteJson("/api/v1/drivers/{$driver->id}/account")
        ->assertOk()
        ->assertJsonPath('data.account', null);

    // Detaching without this leaves the phone signed in and still passing
    // TripPolicy until the token's own 24-hour expiry.
    expect($account->fresh()->tokens()->count())->toBe(0);
    expect($driver->fresh()->user_id)->toBeNull();
});

it('is idempotent when a driver has no login to remove', function () {
    $this->actingAs(platformAdminForDriverAccounts(), 'sanctum')
        ->deleteJson('/api/v1/drivers/'.Driver::factory()->create()->id.'/account')
        ->assertOk();
});

it('suspends the login when the driver is suspended', function () {
    $driver = Driver::factory()->create();
    $admin = platformAdminForDriverAccounts();

    attachDriverAccount($admin, $driver, [
        'email' => 'grounded@kangaruride.test',
        'password' => 'a-very-long-passphrase',
    ])->assertCreated();

    $account = $driver->fresh()->user;
    $account->createToken('phone-in-the-cab');

    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/drivers/{$driver->id}", ['status' => 'suspended'])
        ->assertOk();

    // A driver suspended on the fleet screen who can still sign in is
    // suspended on paper only.
    expect($account->fresh()->status)->toBe(UserStatus::SUSPENDED);
    expect($account->fresh()->tokens()->count())->toBe(0);
});

it('does not hand the login back when the driver is reactivated', function () {
    $driver = Driver::factory()->create();
    $admin = platformAdminForDriverAccounts();

    attachDriverAccount($admin, $driver, [
        'email' => 'returning@kangaruride.test',
        'password' => 'a-very-long-passphrase',
    ])->assertCreated();

    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/drivers/{$driver->id}", ['status' => 'suspended'])->assertOk();
    $this->actingAs($admin, 'sanctum')
        ->patchJson("/api/v1/drivers/{$driver->id}", ['status' => 'active'])->assertOk();

    // Deliberate. The account may have been suspended separately — a lapsed
    // visa, a suspected compromise — and un-suspending it from a fleet
    // screen would silently reverse that decision.
    expect($driver->fresh()->user->status)->toBe(UserStatus::SUSPENDED);
});

it('frees the account when the driver profile is deleted', function () {
    $driver = Driver::factory()->create();
    $admin = platformAdminForDriverAccounts();

    attachDriverAccount($admin, $driver, [
        'email' => 'rehire@kangaruride.test',
        'password' => 'a-very-long-passphrase',
    ])->assertCreated();

    $accountId = $driver->fresh()->user_id;

    $this->actingAs($admin, 'sanctum')
        ->deleteJson("/api/v1/drivers/{$driver->id}")
        ->assertNoContent();

    // A soft delete keeps the row, so without detaching, the unique index
    // would reserve this account against a profile nobody can see — and
    // re-hiring would fail with a conflict naming a driver who appears not
    // to exist.
    attachDriverAccount($admin, Driver::factory()->create(), ['user_id' => $accountId])->assertCreated();
});

it('reports whether each driver can sign in, without leaking credentials', function () {
    $withAccount = Driver::factory()->create();
    Driver::factory()->create();

    $admin = platformAdminForDriverAccounts();
    attachDriverAccount($admin, $withAccount, [
        'email' => 'listed@kangaruride.test',
        'password' => 'a-very-long-passphrase',
    ])->assertCreated();

    $rows = $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/drivers')->assertOk()->json('data');

    // Present on every row, null where there is no account — a key that
    // appeared only sometimes could not tell "none" from "not asked for".
    foreach ($rows as $row) {
        expect($row)->toHaveKey('account');
    }

    $linked = collect($rows)->firstWhere('id', $withAccount->id);
    expect($linked['account']['email'])->toBe('listed@kangaruride.test');
    expect($linked['account'])->not->toHaveKey('password');
});
