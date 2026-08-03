<?php

use App\Enums\UserRole;
use App\Models\User;
use Laravel\Sanctum\PersonalAccessToken;
use Modules\Administration\Services\MfaService;
use OTPHP\TOTP;

/**
 * The three endpoints the Settings page calls, asserted as that page uses
 * them.
 *
 * All three existed before the page did — `PATCH /auth/password` since
 * staff administration shipped, the two MFA ones since ADR-0008 — and none
 * had anything calling it. An endpoint with no caller is an endpoint whose
 * contract nobody has checked from the outside, which is why these assert
 * the *shape the screen depends on* rather than only the status code.
 */

/** Signs a privileged user all the way in, past the second factor. */
function tokenForEnrolled(User $user): string
{
    $challenge = test()->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->json('data.challenge_id');

    return test()->postJson('/api/v1/auth/mfa/verify', [
        'challenge_id' => $challenge,
        'code' => TOTP::createFromSecret((string) $user->fresh()->mfa_secret)->now(),
    ])->json('data.token');
}

it('changes your own password and signs every device out', function () {
    $user = User::factory()->create(['role' => UserRole::CORPORATE_ADMIN]);

    $first = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->json('data.token');

    $second = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->json('data.token');

    $this->withHeader('Authorization', 'Bearer '.$first)
        ->patchJson('/api/v1/auth/password', [
            'current_password' => 'password',
            'password' => 'a-considerably-longer-one',
            'password_confirmation' => 'a-considerably-longer-one',
        ])->assertOk();

    // Both sessions, not just the one that asked. This is what the Settings
    // page's "you have been signed out on every device" claim rests on — if
    // it were only the caller's, that message would be a lie.
    //
    // Asserted against the credential rather than by replaying the token
    // over HTTP. Sanctum's guard memoises the resolved user for the
    // container, so a second request *inside the same test process* answers
    // 200 from cache even though the row is gone — a test artifact, not a
    // surviving session. `findToken()` reads the table, which is the thing
    // a real second request would consult.
    expect($user->tokens()->count())->toBe(0);
    expect(PersonalAccessToken::findToken($first))->toBeNull();
    expect(PersonalAccessToken::findToken($second))->toBeNull();

    // And the new password works.
    $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'a-considerably-longer-one',
    ])->assertOk();
});

it('returns a wrong current password on the field, so the form can mark it', function () {
    $user = User::factory()->create(['role' => UserRole::CORPORATE_ADMIN]);

    $token = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->json('data.token');

    $this->withHeader('Authorization', 'Bearer '.$token)
        ->patchJson('/api/v1/auth/password', [
            'current_password' => 'not-the-password',
            'password' => 'a-considerably-longer-one',
            'password_confirmation' => 'a-considerably-longer-one',
        ])
        ->assertStatus(422)
        // The Settings page reads `errors.current_password` to put the
        // message under the right box. A bare top-level message would send
        // the user hunting.
        ->assertJsonStructure(['errors' => ['current_password']]);
});

it('tells /auth/me whether a factor is on, without leaking the secret', function () {
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::FINANCE]);
    $token = tokenForEnrolled($user);

    $response = $this->withHeader('Authorization', 'Bearer '.$token)
        ->getJson('/api/v1/auth/me')
        ->assertOk();

    // The Settings page's On/Off badge reads this. It must come from the
    // server: the client working out which roles need a factor would be a
    // UI deciding whether a control is enforced.
    expect($response->json('data.mfa_enabled'))->toBeTrue();
    expect($response->json('data.must_enrol_mfa'))->toBeFalse();

    expect((string) $response->getContent())->not->toContain((string) $user->fresh()->mfa_secret);
});

it('reports no factor for a role that does not need one', function () {
    $user = User::factory()->create(['role' => UserRole::CORPORATE_ADMIN]);

    $token = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->json('data.token');

    $this->withHeader('Authorization', 'Bearer '.$token)
        ->getJson('/api/v1/auth/me')
        ->assertOk()
        ->assertJsonPath('data.mfa_enabled', false)
        ->assertJsonPath('data.must_enrol_mfa', false);
});

it('regenerates recovery codes and invalidates the previous set', function () {
    $user = User::factory()->create(['tenant_id' => null, 'role' => UserRole::FINANCE]);
    $old = app(MfaService::class)->generateRecoveryCodes($user);

    $token = tokenForEnrolled($user);

    $fresh = $this->withHeader('Authorization', 'Bearer '.$token)
        ->postJson('/api/v1/auth/mfa/recovery-codes')
        ->assertOk()
        ->json('data.recovery_codes');

    expect($fresh)->toHaveCount(10);
    expect($fresh)->not->toContain($old[0]);

    // The old set is dead, which is the whole point of the button — it is
    // reached by somebody who thinks another person has seen their codes.
    $challenge = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->json('data.challenge_id');

    $this->postJson('/api/v1/auth/mfa/verify', [
        'challenge_id' => $challenge,
        'code' => $old[0],
    ])->assertStatus(401);
});

it('refuses recovery codes to somebody with no factor', function () {
    $user = User::factory()->create(['role' => UserRole::CORPORATE_ADMIN]);

    $token = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->json('data.token');

    // There is nothing to recover *to*. The Settings page never offers the
    // button in this state, and the server does not depend on that.
    $this->withHeader('Authorization', 'Bearer '.$token)
        ->postJson('/api/v1/auth/mfa/recovery-codes')
        ->assertStatus(403)
        ->assertJsonPath('code', 'MFA_ENROLMENT_REQUIRED');
});
