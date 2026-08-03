<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Database\Seeders\RoleSeeder;
use Modules\Administration\Services\MfaService;
use OTPHP\TOTP;

use function Pest\Laravel\actingAs;
use function Pest\Laravel\postJson;

/**
 * ADR-0010: a second factor that is actually asked for, and one that can be
 * put down again.
 *
 * Before this, `POST /auth/mfa/enrol` was gated on authentication while
 * login challenged on the *role*, so an unprivileged user could enrol, read
 * `mfa_enabled: true` off their own account, file ten recovery codes, and
 * never once be asked for a code. The platform was not failing to protect
 * them — it was reporting protection it did not provide, which is the worse
 * of the two.
 */
beforeEach(function () {
    $this->seed(RoleSeeder::class);
    $this->tenant = Tenant::factory()->create();
    $this->mfa = app(MfaService::class);
});

/** Enrols a user for real, through the service, and returns their secret. */
function enrolFully(User $user): string
{
    $mfa = app(MfaService::class);
    $secret = $mfa->beginEnrolment($user)['secret'];
    $mfa->confirmEnrolment($user->refresh(), TOTP::createFromSecret($secret)->now());
    $user->refresh();

    return $secret;
}

function codeFor(string $secret): string
{
    return TOTP::createFromSecret($secret)->now();
}

describe('decision 1 — login honours the factor, not the role', function () {
    /**
     * The defect itself. A Corporate Admin does not *have* to hold a second
     * factor, but if they hold one it must be asked for.
     */
    it('challenges an unprivileged user who enrolled voluntarily', function () {
        $user = User::factory()->create([
            'tenant_id' => $this->tenant->id,
            'role' => UserRole::CORPORATE_ADMIN,
        ]);
        enrolFully($user);

        $response = postJson('/api/v1/auth/login', [
            'email' => $user->email,
            'password' => 'password',
        ]);

        $response->assertStatus(202)
            ->assertJsonPath('data.method', 'totp')
            ->assertJsonStructure(['data' => ['challenge_id']]);

        // And emphatically no token: a 202 that still handed one out would
        // be the same bug wearing a different status code.
        expect($response->json('data.token'))->toBeNull();
    });

    it('lets that user finish with a code, and only then issues a token', function () {
        $user = User::factory()->create([
            'tenant_id' => $this->tenant->id,
            'role' => UserRole::CORPORATE_ADMIN,
        ]);
        $secret = enrolFully($user);

        $challenge = postJson('/api/v1/auth/login', [
            'email' => $user->email,
            'password' => 'password',
        ])->json('data.challenge_id');

        postJson('/api/v1/auth/mfa/verify', [
            'challenge_id' => $challenge,
            'code' => codeFor($secret),
        ])->assertOk()->assertJsonStructure(['data' => ['token']]);
    });

    it('still signs an unenrolled unprivileged user straight in', function () {
        $user = User::factory()->notEnrolledInMfa()->create([
            'tenant_id' => $this->tenant->id,
            'role' => UserRole::CORPORATE_EMPLOYEE,
        ]);

        postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])
            ->assertOk()
            ->assertJsonStructure(['data' => ['token']]);
    });

    /**
     * `requiresMfa()` must keep driving forced enrolment. Decision 1 changes
     * who is *asked*, not who *must* set one up — if this went with it, an
     * unenrolled Finance officer would sail past the middleware.
     */
    it('still forces an unenrolled privileged user to enrol', function () {
        $user = User::factory()->notEnrolledInMfa()->create([
            'tenant_id' => null,
            'role' => UserRole::FINANCE,
        ]);

        $token = postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])
            ->assertOk()->json('data.token');

        expect($token)->not->toBeNull();

        // The token opens nothing but the enrolment pair.
        $this->withToken($token)->getJson('/api/v1/bookings')->assertStatus(403);
    });
});

describe('decision 2 — voluntary means voluntary in both directions', function () {
    it('lets an unprivileged user turn their factor off with a code', function () {
        $user = User::factory()->create([
            'tenant_id' => $this->tenant->id,
            'role' => UserRole::CORPORATE_ADMIN,
        ]);
        $secret = enrolFully($user);

        actingAs($user)
            ->deleteJson('/api/v1/auth/mfa', ['code' => codeFor($secret)])
            ->assertOk()
            ->assertJsonPath('data.mfa_enabled', false);

        $user->refresh();
        expect($user->hasMfaEnabled())->toBeFalse();
        // The sheet goes with the factor: a re-enrolment must not inherit
        // codes printed against a secret that no longer exists.
        expect($user->mfa_recovery_codes)->toBeNull();
    });

    it('refuses a role that requires a factor, even with a valid code', function () {
        // `notEnrolledInMfa()` then enrol by hand: UserFactory enrols
        // MFA-required roles already, but with a random secret nothing can
        // produce a code for — and this test needs a *valid* code, so that
        // the 403 is provably about the role rather than a rejected code.
        $user = User::factory()->notEnrolledInMfa()->create([
            'tenant_id' => null,
            'role' => UserRole::FINANCE,
        ]);
        $secret = enrolFully($user);

        actingAs($user)
            ->deleteJson('/api/v1/auth/mfa', ['code' => codeFor($secret)])
            ->assertStatus(403);

        expect($user->refresh()->hasMfaEnabled())->toBeTrue();
    });

    /**
     * The reason a code is demanded at all: an attacker holding a stolen
     * token must not be able to strip the protection the token was supposed
     * to be gated behind.
     */
    it('refuses a wrong code, so a stolen token cannot strip the factor', function () {
        $user = User::factory()->create([
            'tenant_id' => $this->tenant->id,
            'role' => UserRole::CORPORATE_ADMIN,
        ]);
        enrolFully($user);

        actingAs($user)
            ->deleteJson('/api/v1/auth/mfa', ['code' => '000000'])
            ->assertStatus(422)
            ->assertJsonPath('code', 'MFA_CODE_INVALID');

        expect($user->refresh()->hasMfaEnabled())->toBeTrue();
    });

    /**
     * Somebody turning MFA off after losing their phone is exactly the
     * person who cannot produce a TOTP code, and the person most in need of
     * this endpoint.
     */
    it('accepts a recovery code from a user who has lost their authenticator', function () {
        $user = User::factory()->create([
            'tenant_id' => $this->tenant->id,
            'role' => UserRole::CORPORATE_ADMIN,
        ]);
        $mfa = app(MfaService::class);
        $secret = $mfa->beginEnrolment($user)['secret'];
        $codes = $mfa->confirmEnrolment($user->refresh(), TOTP::createFromSecret($secret)->now());

        actingAs($user->refresh())
            ->deleteJson('/api/v1/auth/mfa', ['code' => $codes[0]])
            ->assertOk();

        expect($user->refresh()->hasMfaEnabled())->toBeFalse();
    });
});

describe('decision 3 — the low-water mark finally has a reader', function () {
    it('reports the remaining count and does not cry low at ten', function () {
        $user = User::factory()->create([
            'tenant_id' => $this->tenant->id,
            'role' => UserRole::CORPORATE_ADMIN,
        ]);
        enrolFully($user);

        actingAs($user)->getJson('/api/v1/auth/me')
            ->assertOk()
            ->assertJsonPath('data.mfa_recovery_codes_remaining', 10)
            ->assertJsonPath('data.mfa_recovery_codes_low', false);
    });

    it('flags low at the threshold, not one code later', function () {
        $user = User::factory()->create([
            'tenant_id' => $this->tenant->id,
            'role' => UserRole::CORPORATE_ADMIN,
        ]);
        enrolFully($user);

        // Exactly the low-water mark — the boundary the constant names.
        $user->forceFill([
            'mfa_recovery_codes' => array_slice($user->mfa_recovery_codes, 0, MfaService::RECOVERY_CODE_LOW_WATER_MARK),
        ])->save();

        actingAs($user->refresh())->getJson('/api/v1/auth/me')
            ->assertOk()
            ->assertJsonPath('data.mfa_recovery_codes_remaining', 3)
            ->assertJsonPath('data.mfa_recovery_codes_low', true);
    });

    it('says nothing about codes for an account with no factor', function () {
        $user = User::factory()->notEnrolledInMfa()->create([
            'tenant_id' => $this->tenant->id,
            'role' => UserRole::CORPORATE_EMPLOYEE,
        ]);

        $response = actingAs($user)->getJson('/api/v1/auth/me')->assertOk();

        // Absent rather than 0: "you have run out" is a different statement
        // from "you never had any".
        expect($response->json('data'))->not->toHaveKey('mfa_recovery_codes_remaining');
        expect($response->json('data.mfa_recovery_codes_low'))->toBeFalse();
    });
});
