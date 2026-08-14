<?php

use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Modules\Administration\Services\PasswordResetService;
use Modules\Administration\Services\SettingsService;

/**
 * ADR-0028 §2 — the emailed reset code.
 *
 * The claims worth defending, costliest mistake first: the endpoints are
 * not an oracle (identical answers for known and unknown emails); the code
 * is hashed at rest and dies on abuse; success revokes every session; and
 * the whole flow is inert until the owner turns it on AND mail works.
 *
 * SMTP points at a dead address throughout — the mail send is best-effort
 * by design, and these tests prove the flow, not the transport. The
 * plaintext code is pinned through a partial mock because the stored copy
 * is hashed: a test that cannot know the code cannot walk the reset half.
 */
function enableReset(): void
{
    $admin = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    test()->actingAs($admin, 'sanctum')
        ->patchJson('/api/v1/settings/mail', [
            'enabled' => true,
            'host' => '127.0.0.1',
            'port' => 2, // nothing listens here; the send fails and is swallowed
            'from_address' => 'no-reply@kangaruride.test',
        ])->assertOk();

    test()->actingAs($admin, 'sanctum')
        ->patchJson('/api/v1/settings/auth', ['password_reset_enabled' => true])
        ->assertOk();

    // actingAs() pins the admin on the guard for the rest of the test —
    // every later "unauthenticated" request would quietly run as them, and
    // the revocation assertion would pass against the wrong user. The flow
    // under test is a stranger's; make the app forget the admin.
    app('auth')->forgetGuards();
}

function pinResetCode(string $code): void
{
    // A classic partial ('Class[method]' with constructor args), not
    // partialMock(): the pinned method is called internally by request(),
    // and only a subclassing partial intercepts $this-calls. It also runs
    // the real constructor, which the typed $settings property requires.
    $mock = Mockery::mock(
        PasswordResetService::class.'[generateCode]',
        [app(SettingsService::class)],
    );
    $mock->shouldReceive('generateCode')->andReturn($code);

    app()->instance(PasswordResetService::class, $mock);
}

it('refuses both endpoints while the owner has the method off', function () {
    $this->postJson('/api/v1/auth/password/forgot', ['email' => 'musa@kangaruride.test'])
        ->assertStatus(409)
        ->assertJsonPath('code', 'AUTH_METHOD_DISABLED');

    $this->postJson('/api/v1/auth/password/reset', [
        'email' => 'musa@kangaruride.test',
        'code' => '123456',
        'password' => 'a-brand-new-password',
        'password_confirmation' => 'a-brand-new-password',
    ])->assertStatus(409)->assertJsonPath('code', 'AUTH_METHOD_DISABLED');
});

/**
 * The flag alone is not enough: reset without a mail transport is a promise
 * the platform cannot keep. Mutation check — drop `mailConfigured()` from
 * `enabled()` and this fails.
 */
it('stays off while the flag is on but mail is not configured', function () {
    $admin = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    $this->actingAs($admin, 'sanctum')
        ->patchJson('/api/v1/settings/auth', ['password_reset_enabled' => true])
        ->assertOk();

    $this->postJson('/api/v1/auth/password/forgot', ['email' => 'musa@kangaruride.test'])
        ->assertStatus(409)
        ->assertJsonPath('code', 'AUTH_METHOD_DISABLED');
});

/**
 * ADR-0028 §2's oracle refusal. Mutation check — answer 404 for an unknown
 * email, or vary the message, and this fails.
 */
it('answers identically whether or not the email belongs to anybody', function () {
    enableReset();
    User::factory()->create(['email' => 'known@kangaruride.test']);

    $known = $this->postJson('/api/v1/auth/password/forgot', ['email' => 'known@kangaruride.test']);
    $unknown = $this->postJson('/api/v1/auth/password/forgot', ['email' => 'ghost@kangaruride.test']);

    $known->assertStatus(202);
    $unknown->assertStatus(202);
    expect($unknown->json('message'))->toBe($known->json('message'));
});

it('stores the code hashed, never as the six digits', function () {
    enableReset();
    pinResetCode('123456');
    User::factory()->create(['email' => 'musa@kangaruride.test']);

    $this->postJson('/api/v1/auth/password/forgot', ['email' => 'musa@kangaruride.test'])
        ->assertStatus(202);

    $row = DB::table('password_reset_tokens')->where('email', 'musa@kangaruride.test')->first();

    expect($row)->not->toBeNull();
    expect($row->token)->not->toBe('123456');
    expect(Hash::check('123456', $row->token))->toBeTrue();
});

it('resets the password and revokes every session', function () {
    enableReset();
    pinResetCode('123456');
    $user = User::factory()->create(['email' => 'musa@kangaruride.test']);
    $oldToken = $user->createToken('driver')->plainTextToken;

    $this->postJson('/api/v1/auth/password/forgot', ['email' => 'musa@kangaruride.test'])
        ->assertStatus(202);

    $this->postJson('/api/v1/auth/password/reset', [
        'email' => 'musa@kangaruride.test',
        'code' => '123456',
        'password' => 'chosen-after-the-reset',
        'password_confirmation' => 'chosen-after-the-reset',
    ])->assertOk();

    // The stolen-phone session is dead — checked before the login below,
    // because a successful login authenticates the guard and Laravel's test
    // app keeps that state for the rest of the test, which would turn this
    // assertion into a rubber stamp.
    $this->getJson('/api/v1/auth/me', ['Authorization' => "Bearer {$oldToken}"])
        ->assertStatus(401);

    // The new password works…
    $this->postJson('/api/v1/auth/login', [
        'email' => 'musa@kangaruride.test',
        'password' => 'chosen-after-the-reset',
    ])->assertOk();

    // …and the code is spent.
    expect(DB::table('password_reset_tokens')->where('email', 'musa@kangaruride.test')->exists())
        ->toBeFalse();
});

it('refuses a wrong code with the same sentence as an unknown email', function () {
    enableReset();
    pinResetCode('123456');
    User::factory()->create(['email' => 'musa@kangaruride.test']);

    $this->postJson('/api/v1/auth/password/forgot', ['email' => 'musa@kangaruride.test'])
        ->assertStatus(202);

    $payload = fn (string $email) => [
        'email' => $email,
        'code' => '999999',
        'password' => 'a-brand-new-password',
        'password_confirmation' => 'a-brand-new-password',
    ];

    $wrongCode = $this->postJson('/api/v1/auth/password/reset', $payload('musa@kangaruride.test'));
    $ghost = $this->postJson('/api/v1/auth/password/reset', $payload('ghost@kangaruride.test'));

    $wrongCode->assertStatus(422);
    $ghost->assertStatus(422);
    expect($ghost->json('message'))->toBe($wrongCode->json('message'));
});

/**
 * The attempts column earning its migration. Mutation check — stop counting
 * and the fifth-wrong-then-right sequence succeeds, and this fails.
 */
it('burns the code after five wrong guesses', function () {
    // Six requests against a 5/min route throttle: the throttle is not what
    // is under test here — the attempts counter behind it is, and it must
    // hold even for an attacker with addresses to burn.
    $this->withoutMiddleware(ThrottleRequests::class);

    enableReset();
    pinResetCode('123456');
    User::factory()->create(['email' => 'musa@kangaruride.test']);

    $this->postJson('/api/v1/auth/password/forgot', ['email' => 'musa@kangaruride.test'])
        ->assertStatus(202);

    foreach (range(1, 5) as $i) {
        $this->postJson('/api/v1/auth/password/reset', [
            'email' => 'musa@kangaruride.test',
            'code' => '000000',
            'password' => 'a-brand-new-password',
            'password_confirmation' => 'a-brand-new-password',
        ])->assertStatus(422);
    }

    // The right code, one guess too late.
    $this->postJson('/api/v1/auth/password/reset', [
        'email' => 'musa@kangaruride.test',
        'code' => '123456',
        'password' => 'a-brand-new-password',
        'password_confirmation' => 'a-brand-new-password',
    ])->assertStatus(422);
});

it('refuses a code past its fifteen minutes', function () {
    enableReset();
    pinResetCode('123456');
    User::factory()->create(['email' => 'musa@kangaruride.test']);

    $this->postJson('/api/v1/auth/password/forgot', ['email' => 'musa@kangaruride.test'])
        ->assertStatus(202);

    $this->travel(16)->minutes();

    $this->postJson('/api/v1/auth/password/reset', [
        'email' => 'musa@kangaruride.test',
        'code' => '123456',
        'password' => 'a-brand-new-password',
        'password_confirmation' => 'a-brand-new-password',
    ])->assertStatus(422);
});

it('holds the same twelve-character floor as every other password door', function () {
    enableReset();
    pinResetCode('123456');
    User::factory()->create(['email' => 'musa@kangaruride.test']);

    $this->postJson('/api/v1/auth/password/forgot', ['email' => 'musa@kangaruride.test'])
        ->assertStatus(202);

    $this->postJson('/api/v1/auth/password/reset', [
        'email' => 'musa@kangaruride.test',
        'code' => '123456',
        'password' => 'elevenchars',
        'password_confirmation' => 'elevenchars',
    ])->assertStatus(422)->assertJsonValidationErrors('password');
});

/**
 * The per-email cooldown: a second ask inside a minute is 202 and a no-op,
 * so nobody's inbox can be rung all day from rotating IPs. Mutation check —
 * drop the cooldown and the second request rewrites the row, and the first
 * code stops matching.
 */
it('does not reissue while the first code is fresh', function () {
    enableReset();
    User::factory()->create(['email' => 'musa@kangaruride.test']);

    $this->postJson('/api/v1/auth/password/forgot', ['email' => 'musa@kangaruride.test'])
        ->assertStatus(202);

    $first = DB::table('password_reset_tokens')->where('email', 'musa@kangaruride.test')->first();

    $this->postJson('/api/v1/auth/password/forgot', ['email' => 'musa@kangaruride.test'])
        ->assertStatus(202);

    $second = DB::table('password_reset_tokens')->where('email', 'musa@kangaruride.test')->first();

    expect($second->token)->toBe($first->token);
});

it('quietly does nothing for a suspended account', function () {
    enableReset();
    User::factory()->create([
        'email' => 'benched@kangaruride.test',
        'status' => UserStatus::SUSPENDED,
    ]);

    $this->postJson('/api/v1/auth/password/forgot', ['email' => 'benched@kangaruride.test'])
        ->assertStatus(202);

    expect(DB::table('password_reset_tokens')->where('email', 'benched@kangaruride.test')->exists())
        ->toBeFalse();
});
