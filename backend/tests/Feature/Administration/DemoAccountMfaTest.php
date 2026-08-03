
<?php

use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use OTPHP\TOTP;

/**
 * The demo still works (ADR-0008 Consequences).
 *
 * The ADR names this as the thing enforcement breaks:
 *
 * > `superadmin@kangaruride.test` and `finance@kangaruride.test` are both
 * > MFA-required under this decision, and `migrate:fresh --seed` currently
 * > produces accounts anyone can sign into with `password`.
 *
 * The chosen answer was a fixed, documented secret rather than an
 * enforcement bypass, because a bypass that is wrong in production fails
 * *silently* — the system simply stops asking. This file is what stops the
 * chosen answer failing silently in the other direction: a demo account
 * enrolled against a secret nobody holds is an account nobody can sign into,
 * and no administrator can reset it.
 *
 * Slow, because it runs the real seeder. Worth it: this is the login the
 * owner performs in front of a bank.
 */
beforeEach(function () {
    $this->seed(DatabaseSeeder::class);
});

it('signs the demo Super Admin in with a code from the documented secret', function () {
    $user = User::where('email', 'superadmin@kangaruride.test')->firstOrFail();

    // Enrolled by the seeder, not by the factory's random secret — the
    // factory's would be valid and unusable, which is the failure this
    // test exists to catch.
    expect($user->hasMfaEnabled())->toBeTrue();

    $challenge = $this->postJson('/api/v1/auth/login', [
        'email' => 'superadmin@kangaruride.test',
        'password' => 'password',
    ])->assertStatus(202)->json('data.challenge_id');

    $token = $this->postJson('/api/v1/auth/mfa/verify', [
        'challenge_id' => $challenge,
        'code' => TOTP::createFromSecret((string) $user->mfa_secret)->now(),
    ])->assertOk()->json('data.token');

    // And the account actually works afterwards — not merely authenticates.
    $this->withHeader('Authorization', 'Bearer '.$token)
        ->getJson('/api/v1/users')
        ->assertOk();
});

it('signs the demo Finance officer in the same way', function () {
    $user = User::where('email', 'finance@kangaruride.test')->firstOrFail();

    $challenge = $this->postJson('/api/v1/auth/login', [
        'email' => 'finance@kangaruride.test',
        'password' => 'password',
    ])->assertStatus(202)->json('data.challenge_id');

    $this->postJson('/api/v1/auth/mfa/verify', [
        'challenge_id' => $challenge,
        'code' => TOTP::createFromSecret((string) $user->mfa_secret)->now(),
    ])->assertOk();
});

/**
 * The Bank demo path is unaffected, which ADR-0008 states as a consequence
 * and this asserts. PROJECT.md's six acceptance criteria are demonstrated
 * through a Corporate Admin, and that account must stay one step.
 */
it('leaves the Centenary Bank demo login as a single step', function () {
    $this->postJson('/api/v1/auth/login', [
        'email' => 'admin@centenarybank.test',
        'password' => 'password',
    ])->assertOk()->assertJsonPath('data.must_enrol_mfa', false);
});

it('leaves the platform dispatcher a single step too', function () {
    // Dispatch holds no `invoices.*` permission and moves no money, so
    // PROJECT.md does not require a factor for it. A dispatcher stopped at
    // a code prompt would be the requirement spreading past its scope.
    $this->postJson('/api/v1/auth/login', [
        'email' => 'dispatch@kangaruride.test',
        'password' => 'password',
    ])->assertOk();
});

/**
 * The two roles AGENTS.md names, and only those. If a third ever gains the
 * flag it should be a decision somebody took, not a seeder edit nobody
 * noticed.
 */
it('requires a factor for exactly the roles the standards name', function () {
    $requiring = DB::table('roles')->where('requires_mfa', true)->pluck('slug')->sort()->values();

    expect($requiring->all())->toBe(['finance', 'super_admin']);
});
