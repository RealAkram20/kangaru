<?php

use App\Models\User;
use Illuminate\Support\Facades\Schedule;

/**
 * ADR-0008 decision 5: Sanctum tokens expire after 24 hours.
 *
 * AGENTS.md has required "Sanctum tokens with expiry" since the project
 * started. `config/sanctum.php` carried `'expiration' => null` until
 * 3 August 2026, which meant every token ever issued was valid forever and
 * one leaked from one machine was a permanent grant on that account.
 *
 * These tests exist because the setting is a single line of configuration
 * that is easy to revert and impossible to notice reverting: nothing else
 * in the suite would fail if it went back to `null`. The suite authenticates
 * with `actingAs()`, which bypasses token validation entirely, so this file
 * is the only place the token lifetime is exercised at all.
 */

/** A real bearer token for a real user, as `POST /auth/login` would mint. */
function issueToken(User $user): string
{
    return $user->createToken('api')->plainTextToken;
}

it('accepts a token issued just now', function () {
    $user = User::factory()->create();

    $this->withHeader('Authorization', 'Bearer '.issueToken($user))
        ->getJson('/api/v1/auth/me')
        ->assertOk();
});

it('accepts a token still inside the 24-hour window', function () {
    $user = User::factory()->create();
    $token = issueToken($user);

    // A dispatcher part-way through a long shift. The window has to survive
    // this or the number is wrong for the job it was chosen for.
    $this->travel(23)->hours();

    $this->withHeader('Authorization', 'Bearer '.$token)
        ->getJson('/api/v1/auth/me')
        ->assertOk();
});

/**
 * The test the whole decision rests on. Remove `'expiration'` from
 * `config/sanctum.php` — or set it back to null — and this goes green
 * again while nothing else in the suite notices.
 */
it('refuses a token older than the window', function () {
    $user = User::factory()->create();
    $token = issueToken($user);

    $this->travel(25)->hours();

    $this->withHeader('Authorization', 'Bearer '.$token)
        ->getJson('/api/v1/auth/me')
        ->assertUnauthorized();
});

/**
 * ADR-0008's implementation note, and the reason this belongs in the deploy
 * runbook rather than only in a config file.
 *
 * Sanctum compares a token's `created_at` against the window rather than
 * storing an expiry on the row, so the setting applies to tokens that
 * already exist. Lowering it signs out every older session at the moment of
 * deploy — a non-event at seven users, a support incident at fifty tenants.
 */
it('applies to tokens minted before the setting existed', function () {
    $user = User::factory()->create();
    $token = issueToken($user);

    // Backdated directly, standing in for a token issued while expiration
    // was still null. No re-issue, no migration — the row is untouched and
    // the guard's arithmetic is what changes its fate.
    $user->tokens()->update(['created_at' => now()->subDays(30)]);

    $this->withHeader('Authorization', 'Bearer '.$token)
        ->getJson('/api/v1/auth/me')
        ->assertUnauthorized();
});

it('expires every role alike, including the privileged ones', function () {
    // Decision 5 is deliberately one number for everybody. A shorter window
    // for Super Admin and Finance was rejected: without refresh tokens it
    // is a mid-shift interruption for the users with the most access, which
    // is how account sharing starts.
    foreach (['super_admin', 'finance', 'corporate_admin', 'dispatcher'] as $role) {
        $user = User::factory()->create(['role' => $role]);
        $token = issueToken($user);

        $this->travel(25)->hours();

        $this->withHeader('Authorization', 'Bearer '.$token)
            ->getJson('/api/v1/auth/me')
            ->assertUnauthorized();

        $this->travelBack();
    }
});

/**
 * Expiry makes a token invalid; it does not delete the row. Without a prune
 * the table accumulates dead credentials indefinitely — a growth problem,
 * and every hash ever issued still sitting in a database that might one day
 * be disclosed.
 */
it('schedules the expired-token prune', function () {
    $commands = collect(Schedule::events())->map(fn ($event) => $event->command ?? '');

    expect($commands->contains(fn (string $command) => str_contains($command, 'sanctum:prune-expired')))
        ->toBeTrue();
});
