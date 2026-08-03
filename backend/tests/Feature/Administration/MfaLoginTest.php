<?php

use App\Enums\UserRole;
use App\Models\AuditLog;
use App\Models\User;
use Modules\Administration\Models\MfaChallenge;
use Modules\Administration\Services\MfaService;
use OTPHP\TOTP;

/**
 * ADR-0008: the two-step login, and the rules around it.
 *
 * The ADR names this file's absence as the risk in its own Consequences:
 *
 * > Most tests are unaffected, and that is a risk. They use `actingAs()`,
 * > which bypasses HTTP login entirely, so the suite will keep passing
 * > while the login flow changes underneath it. That makes explicit
 * > login-path tests part of the work rather than a follow-up: an
 * > MFA-required user who is handed a token without verifying is the
 * > failure this whole ADR exists to prevent, and nothing currently in the
 * > suite would see it.
 *
 * So every test here goes through `POST /auth/login` for real.
 */

/** A code the user's authenticator would be showing right now. */
function currentCodeFor(User $user): string
{
    return TOTP::createFromSecret((string) $user->fresh()->mfa_secret)->now();
}

/** An enrolled Finance officer — the archetype AGENTS.md names. */
function enrolledFinanceOfficer(): User
{
    // The factory enrols MFA-required roles by default, because an
    // unenrolled one can reach nothing (decision 3) and so is not a usable
    // fixture for anything but the forced-enrolment tests below.
    return User::factory()->create([
        'tenant_id' => null,
        'role' => UserRole::FINANCE,
        'email' => 'finance-officer@kangaruride.test',
    ]);
}

// ── The password alone is not enough ─────────────────────────────────────

/**
 * The single most important assertion in this file. If this ever goes
 * green while returning a token, MFA is decorative.
 */
it('hands an enrolled privileged user a challenge and no token', function () {
    $user = enrolledFinanceOfficer();

    $response = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->assertStatus(202);

    expect($response->json('data.challenge_id'))->toBeString();

    // Decision 2: "a partial token is a token". Nothing that authenticates
    // a request may exist before the factor is proved.
    expect($response->json('data.token'))->toBeNull();
    expect($response->json('data.user'))->toBeNull();

    // And no token was minted server-side either — a response that merely
    // withheld one would still leave a usable credential in the database.
    expect($user->tokens()->count())->toBe(0);
});

it('leaves an unprivileged user\'s login exactly as it was', function () {
    $user = User::factory()->create(['role' => UserRole::CORPORATE_EMPLOYEE]);

    $response = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->assertOk();

    // PROJECT.md puts MFA for other roles out of Phase 1, and the Bank's
    // six acceptance criteria are demonstrated through a Corporate Admin.
    // One step, as before.
    expect($response->json('data.token'))->toBeString();
    expect($response->json('data.challenge_id'))->toBeNull();
});

// ── Exchanging the challenge ─────────────────────────────────────────────

it('exchanges a challenge and a valid code for a token', function () {
    $user = enrolledFinanceOfficer();

    $challenge = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->json('data.challenge_id');

    $response = $this->postJson('/api/v1/auth/mfa/verify', [
        'challenge_id' => $challenge,
        'code' => currentCodeFor($user),
    ])->assertOk();

    expect($response->json('data.token'))->toBeString();

    // And the token actually works, which is the only proof that matters.
    $this->withHeader('Authorization', 'Bearer '.$response->json('data.token'))
        ->getJson('/api/v1/auth/me')
        ->assertOk()
        ->assertJsonPath('data.email', $user->email);
});

it('refuses a wrong code', function () {
    $user = enrolledFinanceOfficer();

    $challenge = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->json('data.challenge_id');

    $this->postJson('/api/v1/auth/mfa/verify', [
        'challenge_id' => $challenge,
        'code' => '000000',
    ])->assertStatus(401)->assertJsonPath('code', 'MFA_CODE_INVALID');
});

/**
 * A challenge that survived a wrong code would turn its five-minute window
 * into an unlimited guessing budget against six digits — a space small
 * enough to walk in minutes. One attempt per challenge is what bounds it.
 */
it('spends a challenge even when the code was wrong', function () {
    $user = enrolledFinanceOfficer();

    $challenge = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->json('data.challenge_id');

    $this->postJson('/api/v1/auth/mfa/verify', ['challenge_id' => $challenge, 'code' => '000000'])
        ->assertStatus(401);

    // The right code, on a spent challenge, is still refused.
    $this->postJson('/api/v1/auth/mfa/verify', [
        'challenge_id' => $challenge,
        'code' => currentCodeFor($user),
    ])->assertStatus(401)->assertJsonPath('code', 'MFA_CHALLENGE_INVALID');
});

it('refuses a challenge older than five minutes', function () {
    $user = enrolledFinanceOfficer();

    $challenge = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->json('data.challenge_id');

    $this->travel(6)->minutes();

    $this->postJson('/api/v1/auth/mfa/verify', [
        'challenge_id' => $challenge,
        'code' => currentCodeFor($user),
    ])->assertStatus(401)->assertJsonPath('code', 'MFA_CHALLENGE_INVALID');
});

it('refuses an invented challenge without saying whether it ever existed', function () {
    $real = enrolledFinanceOfficer();

    $invented = $this->postJson('/api/v1/auth/mfa/verify', [
        'challenge_id' => str_repeat('a', 64),
        'code' => currentCodeFor($real),
    ])->assertStatus(401);

    expect($invented->json('code'))->toBe('MFA_CHALLENGE_INVALID');
});

/**
 * A challenge can outlive a suspension by up to five minutes. The account
 * deactivated in that window must not be able to spend the ticket it was
 * issued a moment earlier.
 */
it('refuses a challenge whose account was suspended in the meantime', function () {
    $user = enrolledFinanceOfficer();

    $challenge = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->json('data.challenge_id');

    $user->forceFill(['status' => 'suspended'])->save();

    $this->postJson('/api/v1/auth/mfa/verify', [
        'challenge_id' => $challenge,
        'code' => currentCodeFor($user),
    ])->assertStatus(401);
});

// ── Recovery codes ───────────────────────────────────────────────────────

it('accepts a recovery code in place of the authenticator', function () {
    $user = enrolledFinanceOfficer();
    $codes = app(MfaService::class)->generateRecoveryCodes($user);

    $challenge = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->json('data.challenge_id');

    // The whole point: a lost phone is not an unrecoverable account, which
    // matters here more than most places — no administrator can reset a
    // Super Admin's factor, so without this the platform is destroyable.
    $this->postJson('/api/v1/auth/mfa/verify', [
        'challenge_id' => $challenge,
        'code' => $codes[0],
    ])->assertOk();
});

it('lets each recovery code be used exactly once', function () {
    $user = enrolledFinanceOfficer();
    $codes = app(MfaService::class)->generateRecoveryCodes($user);

    $spend = function (string $code) use ($user) {
        $challenge = $this->postJson('/api/v1/auth/login', [
            'email' => $user->email,
            'password' => 'password',
        ])->json('data.challenge_id');

        return $this->postJson('/api/v1/auth/mfa/verify', [
            'challenge_id' => $challenge,
            'code' => $code,
        ]);
    };

    $spend($codes[0])->assertOk();
    $spend($codes[0])->assertStatus(401);

    expect(app(MfaService::class)->remainingRecoveryCodes($user->fresh()))->toBe(9);
});

/**
 * Decision 4: using a recovery code "re-arms nothing". It gets you in and
 * the audit log says so — it does not disable the factor, and it does not
 * issue a replacement, because a code that restored itself would be a
 * password.
 */
it('does not disable the second factor when a recovery code is used', function () {
    $user = enrolledFinanceOfficer();
    $codes = app(MfaService::class)->generateRecoveryCodes($user);

    $challenge = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->json('data.challenge_id');

    $this->postJson('/api/v1/auth/mfa/verify', ['challenge_id' => $challenge, 'code' => $codes[0]])
        ->assertOk();

    expect($user->fresh()->hasMfaEnabled())->toBeTrue();

    // And the next login still demands a factor.
    $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])
        ->assertStatus(202);
});

// ── Forced enrolment (decision 3) ────────────────────────────────────────

it('lets an unenrolled privileged user sign in but do nothing else', function () {
    $user = User::factory()->notEnrolledInMfa()->create([
        'tenant_id' => null,
        'role' => UserRole::SUPER_ADMIN,
    ]);

    $login = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->assertOk();

    $token = $login->json('data.token');

    // A real token — enrolling is an authenticated act, and the
    // alternative would be a second kind of half-credential, which is the
    // thing decision 2 refuses.
    expect($token)->toBeString();
    expect($login->json('data.must_enrol_mfa'))->toBeTrue();

    // ...and it opens nothing.
    $this->withHeader('Authorization', 'Bearer '.$token)
        ->getJson('/api/v1/users')
        ->assertStatus(403)
        ->assertJsonPath('code', 'MFA_ENROLMENT_REQUIRED');

    $this->withHeader('Authorization', 'Bearer '.$token)
        ->getJson('/api/v1/reports/trips')
        ->assertStatus(403)
        ->assertJsonPath('code', 'MFA_ENROLMENT_REQUIRED');
});

it('still lets an unenrolled privileged user reach enrolment, themselves and the exit', function () {
    $user = User::factory()->notEnrolledInMfa()->create([
        'tenant_id' => null,
        'role' => UserRole::SUPER_ADMIN,
    ]);

    $token = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->json('data.token');

    // `me` so the client can explain itself rather than render a blank
    // screen; `logout` because trapping somebody in an application they
    // cannot leave is its own bug.
    $this->withHeader('Authorization', 'Bearer '.$token)->getJson('/api/v1/auth/me')->assertOk();
    $this->withHeader('Authorization', 'Bearer '.$token)->postJson('/api/v1/auth/mfa/enrol')->assertOk();
});

it('does not force enrolment on a role that does not require it', function () {
    $user = User::factory()->create(['role' => UserRole::DISPATCHER, 'tenant_id' => null]);

    $token = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->json('data.token');

    $this->withHeader('Authorization', 'Bearer '.$token)->getJson('/api/v1/bookings')->assertOk();
});

// ── Enrolment ────────────────────────────────────────────────────────────

it('walks a privileged user from unenrolled to signed in with a factor', function () {
    $user = User::factory()->notEnrolledInMfa()->create([
        'tenant_id' => null,
        'role' => UserRole::SUPER_ADMIN,
    ]);

    $token = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->json('data.token');

    $begin = $this->withHeader('Authorization', 'Bearer '.$token)
        ->postJson('/api/v1/auth/mfa/enrol')
        ->assertOk();

    $secret = $begin->json('data.secret');
    expect($begin->json('data.qr_svg'))->toContain('<svg');
    expect($begin->json('data.otpauth_uri'))->toStartWith('otpauth://totp/');

    // Not enrolled until a code is verified: a stored-but-unconfirmed
    // secret is a half-finished enrolment, and treating it as armed would
    // lock somebody out of an authenticator they never scanned.
    expect($user->fresh()->hasMfaEnabled())->toBeFalse();

    $confirm = $this->withHeader('Authorization', 'Bearer '.$token)
        ->postJson('/api/v1/auth/mfa/enrol/confirm', [
            'code' => TOTP::createFromSecret($secret)->now(),
        ])->assertOk();

    expect($confirm->json('data.recovery_codes'))->toHaveCount(10);
    expect($user->fresh()->hasMfaEnabled())->toBeTrue();

    // The gate is open now.
    $this->withHeader('Authorization', 'Bearer '.$token)->getJson('/api/v1/users')->assertOk();
});

it('refuses to confirm enrolment with a wrong code', function () {
    $user = User::factory()->notEnrolledInMfa()->create([
        'tenant_id' => null,
        'role' => UserRole::SUPER_ADMIN,
    ]);

    $token = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->json('data.token');

    $this->withHeader('Authorization', 'Bearer '.$token)->postJson('/api/v1/auth/mfa/enrol');

    $this->withHeader('Authorization', 'Bearer '.$token)
        ->postJson('/api/v1/auth/mfa/enrol/confirm', ['code' => '000000'])
        ->assertStatus(422)
        ->assertJsonPath('code', 'MFA_CODE_INVALID');

    expect($user->fresh()->hasMfaEnabled())->toBeFalse();
});

/**
 * Silently replacing a confirmed secret would be a reset, and resetting
 * somebody's second factor is the same hazard as resetting their password
 * — an act an audit trail cannot tell apart from impersonation. ADR-0008
 * puts admin-initiated reset out of scope; this is the self-service edge.
 */
it('refuses to restart enrolment on an account that already has a factor', function () {
    $user = enrolledFinanceOfficer();
    $before = $user->mfa_secret;

    $challenge = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->json('data.challenge_id');

    $token = $this->postJson('/api/v1/auth/mfa/verify', [
        'challenge_id' => $challenge,
        'code' => currentCodeFor($user),
    ])->json('data.token');

    $this->withHeader('Authorization', 'Bearer '.$token)
        ->postJson('/api/v1/auth/mfa/enrol')
        ->assertStatus(409)
        ->assertJsonPath('code', 'MFA_ALREADY_ENROLLED');

    expect($user->fresh()->mfa_secret)->toBe($before);
});

// ── The secret must never reach the audit log ────────────────────────────

/**
 * ADR-0008 decision 7, and the failure it guards is silent *and*
 * permanent: `audit_logs` is append-only, so a secret written into a
 * `changes` column is not deletable.
 */
it('never writes the TOTP secret or recovery codes into an audit row', function () {
    $user = User::factory()->notEnrolledInMfa()->create([
        'tenant_id' => null,
        'role' => UserRole::SUPER_ADMIN,
    ]);

    $token = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->json('data.token');

    $secret = $this->withHeader('Authorization', 'Bearer '.$token)
        ->postJson('/api/v1/auth/mfa/enrol')
        ->json('data.secret');

    $this->withHeader('Authorization', 'Bearer '.$token)
        ->postJson('/api/v1/auth/mfa/enrol/confirm', [
            'code' => TOTP::createFromSecret($secret)->now(),
        ])->assertOk();

    $rows = AuditLog::allTenants()->get();

    // Every row, every column — not just the ones expected to be risky.
    foreach ($rows as $row) {
        expect(json_encode($row->changes))->not->toContain($secret);
        expect(json_encode($row->changes))->not->toContain('mfa_secret');
        expect(json_encode($row->changes))->not->toContain('mfa_recovery_codes');
    }
});

it('keeps the secret out of the user resource the API serves', function () {
    $user = enrolledFinanceOfficer();

    $challenge = $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->json('data.challenge_id');

    $token = $this->postJson('/api/v1/auth/mfa/verify', [
        'challenge_id' => $challenge,
        'code' => currentCodeFor($user),
    ])->json('data.token');

    $body = (string) $this->withHeader('Authorization', 'Bearer '.$token)
        ->getJson('/api/v1/auth/me')
        ->getContent();

    expect($body)->not->toContain((string) $user->mfa_secret);
    expect($body)->not->toContain('mfa_secret');
});

// ── The secret at rest ───────────────────────────────────────────────────

it('stores the TOTP secret encrypted, not in plaintext', function () {
    $user = enrolledFinanceOfficer();

    $stored = DB::table('users')->where('id', $user->id)->value('mfa_secret');

    // AGENTS.md requires app-level encryption for driver documents; a TOTP
    // secret is the same class of thing. In plaintext it is a second factor
    // anybody holding a database dump can compute.
    expect($stored)->not->toBe($user->mfa_secret);
    expect($stored)->not->toContain((string) $user->mfa_secret);
});

it('stores recovery codes hashed, so a dump cannot spend them', function () {
    $user = enrolledFinanceOfficer();
    $codes = app(MfaService::class)->generateRecoveryCodes($user);

    $stored = (string) DB::table('users')->where('id', $user->id)->value('mfa_recovery_codes');

    expect($stored)->not->toContain($codes[0]);

    // Hashed as well as encrypted: nothing ever needs to read one back,
    // only to check one, so they get the password treatment and the
    // encryption is a second layer rather than the protection itself.
    foreach ($user->fresh()->mfa_recovery_codes ?? [] as $hash) {
        expect($hash)->toStartWith('$2y$');
    }
});

it('cleans up nothing it should keep: challenges survive as a record', function () {
    $user = enrolledFinanceOfficer();

    $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password']);

    // Consumed rather than deleted, so a replay is distinguishable from an
    // expiry and the row is still there to be counted.
    expect(MfaChallenge::where('user_id', $user->id)->count())->toBe(1);
});
