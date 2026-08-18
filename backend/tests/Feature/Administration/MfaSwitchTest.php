<?php

use App\Enums\UserRole;
use App\Models\User;
use App\Support\Auth\MfaRequirement;
use Illuminate\Support\Facades\Config;

/**
 * The development switch over the second factor (config/mfa.php).
 *
 * AGENTS.md requires MFA for the roles that move money and ADR-0008 is the
 * decision behind it; neither is repealed here. What is under test is that
 * the switch does exactly two things in development — stops demanding
 * enrolment, stops asking for a code — **without touching anybody's secret**,
 * and that it cannot do any of it in production.
 */

/**
 * An enrolled Finance officer — one of the two roles AGENTS.md names, and
 * what `RoleSeeder` (seeded by `TestCase`) marks `requires_mfa`.
 *
 * The factory enrols an MFA-required role by default, which is why the
 * unenrolled case below has to ask for it.
 */
function financeUser(): User
{
    return User::factory()->create(['role' => UserRole::FINANCE, 'tenant_id' => null]);
}

/** The same officer before they have set a factor up. */
function unenrolledFinanceUser(): User
{
    return User::factory()->notEnrolledInMfa()->create([
        'role' => UserRole::FINANCE,
        'tenant_id' => null,
    ]);
}

it('demands enrolment and asks for a code while the switch is on', function () {
    Config::set('mfa.enabled', true);

    expect(unenrolledFinanceUser()->requiresMfa())->toBeTrue()
        ->and(unenrolledFinanceUser()->mustEnrolInMfa())->toBeTrue()
        ->and(financeUser()->mustPresentMfa())->toBeTrue();
});

it('stops demanding enrolment and stops asking for a code while it is off', function () {
    Config::set('mfa.enabled', false);

    expect(unenrolledFinanceUser()->requiresMfa())->toBeFalse()
        ->and(unenrolledFinanceUser()->mustEnrolInMfa())->toBeFalse()
        ->and(financeUser()->mustPresentMfa())->toBeFalse();
});

it('never forgets that an account is enrolled', function () {
    // The switch decides whether a code is *asked for*, never whether the
    // account has a factor. A profile screen that reported otherwise would
    // be lying about what protects the account the moment it goes back on —
    // and turning it on must restore exactly the accounts that were
    // protected, with the same secrets.
    // Enrolled while the switch was on — which is also the honest fixture:
    // `UserFactory` enrols an MFA-required role, and with the switch off the
    // role does not require one, so nothing would be enrolled to forget.
    Config::set('mfa.enabled', true);

    $user = financeUser();
    $secret = $user->mfa_secret;

    Config::set('mfa.enabled', false);

    expect($user->fresh()->hasMfaEnabled())->toBeTrue()
        ->and($secret)->not->toBeNull()
        ->and($user->mustPresentMfa())->toBeFalse();

    Config::set('mfa.enabled', true);

    expect($user->fresh()->mfa_secret)->toBe($secret)
        ->and($user->mustPresentMfa())->toBeTrue();
});

it('signs an enrolled user straight in with the switch off, and challenges them with it on', function () {
    Config::set('mfa.enabled', true);

    $user = financeUser();

    Config::set('mfa.enabled', false);

    // 200 with a token: the sign-in is finished, and the account keeps its
    // secret for the day the switch goes back on.
    $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])
        ->assertOk()
        ->assertJsonPath('data.must_enrol_mfa', false)
        ->assertJsonPath('data.token', fn ($token) => is_string($token) && $token !== '');

    Config::set('mfa.enabled', true);

    // 202 with a challenge and no token — ADR-0008 decision 2, unchanged.
    $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])
        ->assertStatus(202)
        ->assertJsonPath('data.method', 'totp')
        ->assertJsonPath('data.challenge_id', fn ($id) => is_string($id) && $id !== '');
});

it('is inert in production, whatever the environment file says', function () {
    // The property that makes the switch safe to have at all: a .env copied
    // to a live server cannot turn the factor off on the roles that move
    // money (AGENTS.md, ADR-0008).
    Config::set('mfa.enabled', false);

    expect(MfaRequirement::inForce())->toBeFalse();

    app()->detectEnvironment(fn () => 'production');

    expect(MfaRequirement::inForce())->toBeTrue()
        ->and(unenrolledFinanceUser()->requiresMfa())->toBeTrue();

    app()->detectEnvironment(fn () => 'testing');
});
