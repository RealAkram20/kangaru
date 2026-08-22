<?php

use App\Enums\UserRole;
use App\Models\User;
use App\Support\Auth\ClientScope;
use Illuminate\Support\Facades\Route;
use Modules\Drivers\Models\Driver;
use OTPHP\TOTP;

/**
 * ADR-0022 — a token issued to the Driver's Application cannot reach the
 * staff console.
 *
 * Every assertion here goes through a **real** token: sign in, take the
 * string, send it as a bearer. `Sanctum::actingAs()` fakes the token with a
 * Mockery double that has no `abilities` column, so a test written that way
 * would be asserting against a mock rather than against the thing that will
 * be sitting in a phone's keychain.
 */
function tokenScopeSignIn(User $user, ?string $client = null): string
{
    $body = ['email' => $user->email, 'password' => 'password'];

    if ($client !== null) {
        $body['client'] = $client;
    }

    $response = test()->postJson('/api/v1/auth/login', $body);

    // A staff account in an MFA-required role gets a challenge and no token
    // (ADR-0008 decision 2). Finishing the second step here, rather than
    // reaching for a role that skips MFA, is deliberate: `verifyMfa` is the
    // *other* place a token is minted, and if it forgot to carry the client
    // then every MFA-protected person signing in on the driver app would
    // quietly receive a console token — the exact failure this feature
    // exists to prevent, arriving through the back door.
    if ($response->status() === 202) {
        $user->refresh();

        return test()->postJson('/api/v1/auth/mfa/verify', array_filter([
            'challenge_id' => $response->json('data.challenge_id'),
            'code' => TOTP::createFromSecret($user->mfa_secret)->now(),
            'client' => $client,
        ]))->assertOk()->json('data.token');
    }

    return $response->assertOk()->json('data.token');
}

function tokenScopeDriver(): array
{
    $account = User::factory()->create(['tenant_id' => null, 'role' => UserRole::DRIVER]);
    Driver::factory()->forUser($account)->create();

    return [$account, tokenScopeSignIn($account, 'driver')];
}

function tokenScopeGet(string $token, string $path)
{
    return test()->withHeader('Authorization', "Bearer {$token}")->getJson($path);
}

// ── The driver app reaches its own surface ───────────────────────────────

it('lets a driver token reach the work it exists to do', function () {
    [, $token] = tokenScopeDriver();

    tokenScopeGet($token, '/api/v1/trips')->assertOk();
    tokenScopeGet($token, '/api/v1/me/availability-requests')->assertOk();
    tokenScopeGet($token, '/api/v1/auth/me')->assertOk();
});

// ── And nothing else ─────────────────────────────────────────────────────

it('refuses a driver token the staff console', function (string $path) {
    [, $token] = tokenScopeDriver();

    tokenScopeGet($token, $path)
        ->assertForbidden()
        ->assertJsonPath('code', 'TOKEN_SCOPE_EXCEEDED');
})->with([
    '/api/v1/users',
    '/api/v1/customers',
    '/api/v1/availability-blocks',
    '/api/v1/invoices',
]);

it('refuses on the app, not on the person', function () {
    // A super admin who signs in *on the driver app*. Their permissions are
    // total; the token's reach is not. If this came back
    // INSUFFICIENT_PERMISSIONS instead, the scope would be doing nothing and
    // the role would be doing all the work — a false green invisible from a
    // driver-role test alone.
    $admin = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    tokenScopeGet(tokenScopeSignIn($admin, 'driver'), '/api/v1/users')
        ->assertForbidden()
        ->assertJsonPath('code', 'TOKEN_SCOPE_EXCEEDED');
});

it('closes a route nobody has named on the list, without anybody deciding to', function () {
    // The fail-closed property, asserted rather than described. `/roles` is
    // an ordinary staff endpoint that nothing in ClientScope mentions —
    // exactly the state every future endpoint starts in.
    [, $token] = tokenScopeDriver();

    tokenScopeGet($token, '/api/v1/roles')
        ->assertForbidden()
        ->assertJsonPath('code', 'TOKEN_SCOPE_EXCEEDED');
});

/**
 * The guard for the mistake this list keeps making.
 *
 * **Seven endpoints have shipped 403 to the only client that draws them.**
 * Earnings, the ledger, promotions and trips were the first four; the payout
 * account, the closure request and the driver's own profile edit were found
 * the same way months later — with `curl` against a running server, because
 * nothing else looks. Every backend test signs in without a `client` and gets
 * an unscoped console token, so an endpoint's own suite is green while its
 * screen is dead, and the app's tests mock the client and are green too.
 *
 * `/me` is the driver's own surface *by construction*: no id in any path, the
 * token is the subject. So a `me.*` route that is not on the driver's list is
 * either an omission or a decision nobody wrote down — and this makes the
 * second one cost a line of code, which is the right price.
 *
 * The office's own routes over a driver's row (`drivers.*`) are deliberately
 * out of scope here: a driver may correct two fields on their own record, not
 * seven on anybody's, and `drivers.documents.*` is absent so that nobody can
 * verify their own licence.
 */
it('leaves no me route unreachable by the app that owns it', function () {
    $names = collect(Route::getRoutes()->getRoutes())
        ->map(fn ($route): ?string => $route->getName())
        ->filter(fn (?string $name): bool => $name !== null && str_starts_with($name, 'me.'))
        ->values();

    // A guard that found nothing because it looked at nothing is the failure
    // mode of every reflective test. This one has 35 routes to look at.
    expect($names)->not->toBeEmpty();

    $unreachable = $names
        ->reject(fn (string $name): bool => ClientScope::permits([ClientScope::DRIVER], $name))
        ->values()
        ->all();

    expect($unreachable)->toBe([]);
});

it('names the stop routes on the driver scope, so add-a-drop-off is not the eighth dead screen', function () {
    // `trips.*`, so the reflective `me.*` guard above cannot see them —
    // pinned by name instead (ADR-0045 §4, §10).
    expect(ClientScope::permits([ClientScope::DRIVER], 'trips.stops.store'))->toBeTrue();
    expect(ClientScope::permits([ClientScope::DRIVER], 'trips.stop-candidates.index'))->toBeTrue();
});

// ── The console is untouched ─────────────────────────────────────────────

it('leaves a console token holding everything it held before', function () {
    $admin = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    $token = tokenScopeSignIn($admin, 'console');

    tokenScopeGet($token, '/api/v1/users')->assertOk();
    tokenScopeGet($token, '/api/v1/customers')->assertOk();
});

it('treats a login that names no client as the console', function () {
    // Every client that predates ADR-0022 — including the shipped web app —
    // sends no `client` field. They must keep working untouched, or this is
    // a breaking change dressed as a security improvement.
    $admin = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    tokenScopeGet(tokenScopeSignIn($admin), '/api/v1/users')->assertOk();
});

// ── What the token actually carries ──────────────────────────────────────

it('carries the client through the second step of an MFA login', function () {
    // A super admin is MFA-required, so their token is minted by `verifyMfa`
    // and not by `login`. Signing in on the driver app must still produce a
    // driver-scoped token.
    $admin = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    $token = tokenScopeSignIn($admin, 'driver');

    expect($admin->tokens()->latest('id')->first()->abilities)->toBe(['driver']);

    tokenScopeGet($token, '/api/v1/users')
        ->assertForbidden()
        ->assertJsonPath('code', 'TOKEN_SCOPE_EXCEEDED');
});

it('stores the client as the token name, so an incident can tell devices apart', function () {
    [$account] = tokenScopeDriver();

    $token = $account->tokens()->latest('id')->first();

    // Every token used to be called "api". During an incident the question
    // is which device a row belongs to.
    expect($token->name)->toBe('driver');
    expect($token->abilities)->toBe(['driver']);
});

it('refuses a client nobody has defined', function () {
    $admin = User::factory()->create(['tenant_id' => null, 'role' => UserRole::SUPER_ADMIN]);

    test()->postJson('/api/v1/auth/login', [
        'email' => $admin->email,
        'password' => 'password',
        'client' => 'dispatcher-watch',
    ])->assertStatus(422)->assertJsonValidationErrors('client');
});
