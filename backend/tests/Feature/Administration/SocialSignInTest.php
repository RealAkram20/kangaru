<?php

use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Modules\Administration\Models\SocialIdentity;
use Modules\Drivers\Models\Driver;

/**
 * ADR-0028 §3 — "Continue with Google / Facebook".
 *
 * The providers are faked at the HTTP layer, because that is the trust
 * boundary: everything below it — audience checks, the resolution ladder,
 * what gets created and what pointedly does not — is ours and is what these
 * tests defend. Costliest mistake first: a stranger must never come out of
 * this endpoint owning a principal, and a staff account must never come out
 * of it holding a driver token.
 */
const GOOGLE_CLIENT = '1234-android.apps.googleusercontent.com';

function enableGoogle(): void
{
    $admin = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    test()->actingAs($admin, 'sanctum')->patchJson('/api/v1/settings/auth', [
        'google_enabled' => true,
        'google_client_ids' => GOOGLE_CLIENT.' , some-other-client.apps.googleusercontent.com',
    ])->assertOk();

    app('auth')->forgetGuards();
}

function fakeGoogleToken(array $overrides = []): void
{
    Http::fake([
        'oauth2.googleapis.com/tokeninfo*' => Http::response(array_merge([
            'aud' => GOOGLE_CLIENT,
            'sub' => 'google-sub-1',
            'email' => 'musa@kangaruride.test',
            'email_verified' => 'true',
            'name' => 'Musa Kiwanuka',
            'exp' => time() + 3600,
        ], $overrides)),
    ]);
}

/** A user whose account can actually drive: linked to a driver profile's role. */
function driverAccount(string $email): User
{
    $user = User::factory()->create(['tenant_id' => null, 'role' => 'driver', 'email' => $email]);
    Driver::factory()->create(['user_id' => $user->id, 'email' => $email]);

    return $user;
}

it('refuses while the owner has the provider off', function () {
    $this->postJson('/api/v1/auth/social', [
        'provider' => 'google',
        'token' => 'anything',
        'client' => 'driver',
    ])->assertStatus(409)->assertJsonPath('code', 'AUTH_METHOD_DISABLED');
});

/**
 * The audience check is the one that matters most: a perfectly valid Google
 * token minted for somebody else's app is somebody else's sign-in.
 * Mutation check — drop the `aud` comparison and this fails.
 */
it('refuses a valid Google token minted for another app', function () {
    enableGoogle();
    fakeGoogleToken(['aud' => 'attacker.apps.googleusercontent.com']);

    $this->postJson('/api/v1/auth/social', [
        'provider' => 'google',
        'token' => 'stolen-but-valid',
        'client' => 'driver',
    ])->assertStatus(401)->assertJsonPath('code', 'SOCIAL_TOKEN_INVALID');
});

it('refuses a token Google itself refuses', function () {
    enableGoogle();
    Http::fake(['oauth2.googleapis.com/tokeninfo*' => Http::response(['error' => 'invalid'], 400)]);

    $this->postJson('/api/v1/auth/social', [
        'provider' => 'google',
        'token' => 'garbage',
        'client' => 'driver',
    ])->assertStatus(401)->assertJsonPath('code', 'SOCIAL_TOKEN_INVALID');
});

it('signs in a driver whose verified email matches, and links the identity', function () {
    enableGoogle();
    fakeGoogleToken();
    driverAccount('musa@kangaruride.test');

    $response = $this->postJson('/api/v1/auth/social', [
        'provider' => 'google',
        'token' => 'good-token',
        'client' => 'driver',
    ])->assertOk();

    expect($response->json('data.status'))->toBe('signed_in');
    expect($response->json('data.token'))->toBeString();

    $identity = SocialIdentity::sole();
    expect($identity->provider_id)->toBe('google-sub-1');
    expect($identity->email_at_link)->toBe('musa@kangaruride.test');
});

/**
 * The driver-surface guarantee, end to end: the minted token must reach the
 * driver's own routes and be refused everywhere else (ADR-0022). Driven
 * through real requests rather than asserted against abilities, for the
 * same reason DriverAccountTest does it this way.
 */
it('mints a token scoped to the driver surface, not the console', function () {
    enableGoogle();
    fakeGoogleToken();
    driverAccount('musa@kangaruride.test');

    $token = $this->postJson('/api/v1/auth/social', [
        'provider' => 'google',
        'token' => 'good-token',
        'client' => 'driver',
    ])->json('data.token');

    $this->getJson('/api/v1/auth/me', ['Authorization' => "Bearer {$token}"])->assertOk();
    $this->getJson('/api/v1/users', ['Authorization' => "Bearer {$token}"])->assertStatus(403);
});

it('signs a linked identity in even after its provider email changed', function () {
    enableGoogle();
    $user = driverAccount('old-address@kangaruride.test');
    SocialIdentity::create([
        'user_id' => $user->id,
        'provider' => 'google',
        'provider_id' => 'google-sub-1',
        'email_at_link' => 'old-address@kangaruride.test',
    ]);

    // Google now asserts a different email for the same sub.
    fakeGoogleToken(['email' => 'new-address@gmail.test']);

    $response = $this->postJson('/api/v1/auth/social', [
        'provider' => 'google',
        'token' => 'good-token',
        'client' => 'driver',
    ])->assertOk();

    expect($response->json('data.user.id'))->toBe($user->id);
    // And no second identity or account appeared.
    expect(SocialIdentity::count())->toBe(1);
    expect(User::query()->where('email', 'new-address@gmail.test')->exists())->toBeFalse();
});

/**
 * ADR-0027 §1 through the OAuth door: a stranger gets their two verified
 * fields back and NOTHING is created. Mutation check — create the user or
 * the identity here and this fails.
 */
it('hands a stranger to the application form and creates nothing', function () {
    enableGoogle();
    fakeGoogleToken(['email' => 'stranger@gmail.test', 'sub' => 'google-sub-9']);

    $response = $this->postJson('/api/v1/auth/social', [
        'provider' => 'google',
        'token' => 'good-token',
        'client' => 'driver',
    ])->assertStatus(202);

    expect($response->json('data'))->toBe([
        'status' => 'sign_up',
        'name' => 'Musa Kiwanuka',
        'email' => 'stranger@gmail.test',
    ]);

    expect(User::query()->where('email', 'stranger@gmail.test')->exists())->toBeFalse();
    expect(SocialIdentity::count())->toBe(0);
});

/**
 * An unverified email assertion is an account-takeover kit: anyone can make
 * a social profile claiming a driver's address. Mutation check — honour the
 * match without the verified flag and this fails.
 */
it('refuses to match on an email the provider has not verified', function () {
    enableGoogle();
    fakeGoogleToken(['email_verified' => 'false']);
    driverAccount('musa@kangaruride.test');

    $this->postJson('/api/v1/auth/social', [
        'provider' => 'google',
        'token' => 'good-token',
        'client' => 'driver',
    ])->assertStatus(202)->assertJsonPath('data.status', 'sign_up');

    expect(SocialIdentity::count())->toBe(0);
});

it('refuses a staff account: this door only opens onto the driver surface', function () {
    enableGoogle();
    fakeGoogleToken(['email' => 'dispatch@kangaruride.test']);
    // A dispatcher, not Finance: the factory auto-enrols MFA-required roles,
    // and Finance would (correctly) be refused one rung earlier as
    // MFA_REQUIRED — which the enrolled-factor test already covers.
    User::factory()->create([
        'tenant_id' => null,
        'role' => UserRole::DISPATCHER,
        'email' => 'dispatch@kangaruride.test',
    ]);

    $this->postJson('/api/v1/auth/social', [
        'provider' => 'google',
        'token' => 'good-token',
        'client' => 'driver',
    ])->assertStatus(403)->assertJsonPath('code', 'NOT_A_DRIVER');

    expect(SocialIdentity::count())->toBe(0);
});

/**
 * Social has no second factor, so it must not open a door that requires
 * one. Mutation check — skip the MFA test in the ladder and this fails.
 */
it('refuses an account that has enrolled a second factor', function () {
    enableGoogle();
    fakeGoogleToken();
    $user = driverAccount('musa@kangaruride.test');
    $user->forceFill([
        'mfa_secret' => encrypt('AAAABBBBCCCCDDDD'),
        'mfa_confirmed_at' => now(),
    ])->save();

    $this->postJson('/api/v1/auth/social', [
        'provider' => 'google',
        'token' => 'good-token',
        'client' => 'driver',
    ])->assertStatus(409)->assertJsonPath('code', 'MFA_REQUIRED');
});

it('treats a suspended account exactly like no account', function () {
    enableGoogle();
    fakeGoogleToken();
    driverAccount('musa@kangaruride.test')->forceFill([
        'status' => UserStatus::SUSPENDED,
    ])->save();

    $this->postJson('/api/v1/auth/social', [
        'provider' => 'google',
        'token' => 'good-token',
        'client' => 'driver',
    ])->assertStatus(202)->assertJsonPath('data.status', 'sign_up');
});

it('verifies Facebook tokens against the stored app credentials', function () {
    $admin = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
    $this->actingAs($admin, 'sanctum')->patchJson('/api/v1/settings/auth', [
        'facebook_enabled' => true,
        'facebook_app_id' => 'fb-app-1',
        'facebook_app_secret' => 'fb-secret',
    ])->assertOk();
    app('auth')->forgetGuards();

    Http::fake([
        'graph.facebook.com/debug_token*' => Http::response([
            'data' => ['is_valid' => true, 'app_id' => 'fb-app-1'],
        ]),
        'graph.facebook.com/*/me*' => Http::response([
            'id' => 'fb-user-7',
            'name' => 'Musa Kiwanuka',
            'email' => 'musa@kangaruride.test',
        ]),
    ]);

    driverAccount('musa@kangaruride.test');

    $response = $this->postJson('/api/v1/auth/social', [
        'provider' => 'facebook',
        'token' => 'fb-access-token',
        'client' => 'driver',
    ])->assertOk();

    expect($response->json('data.status'))->toBe('signed_in');
    expect(SocialIdentity::sole()->provider)->toBe('facebook');
});

it('refuses a Facebook token minted for another app', function () {
    $admin = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);
    $this->actingAs($admin, 'sanctum')->patchJson('/api/v1/settings/auth', [
        'facebook_enabled' => true,
        'facebook_app_id' => 'fb-app-1',
        'facebook_app_secret' => 'fb-secret',
    ])->assertOk();
    app('auth')->forgetGuards();

    Http::fake([
        'graph.facebook.com/debug_token*' => Http::response([
            'data' => ['is_valid' => true, 'app_id' => 'somebody-elses-app'],
        ]),
    ]);

    $this->postJson('/api/v1/auth/social', [
        'provider' => 'facebook',
        'token' => 'fb-access-token',
        'client' => 'driver',
    ])->assertStatus(401)->assertJsonPath('code', 'SOCIAL_TOKEN_INVALID');
});
