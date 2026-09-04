<?php

use App\Enums\AccessLevel;
use App\Enums\Permission;
use App\Enums\RoleAudience;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Customer;
use App\Models\ImpersonationSession;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Facades\Notification;
use Modules\Administration\Models\Role;
use Modules\Notifications\Notifications\AccountAccessedBySupportNotification;

/**
 * Acting as a walk-in client (ADR-0066).
 *
 * ADR-0056 built acting-as for `users` rows and left this half unimplemented,
 * because ADR-0013 made a walk-in a second principal on a second guard with a
 * tripwire test around the boundary. This file is what makes cutting through
 * that boundary safe to have done.
 *
 * The tests that matter are the ones nobody writes by habit, and they are the
 * same shape as ADR-0056's own: not "the feature works", but **the thing it
 * would be easy to leave open is shut.** Three of those here — a staff token
 * with no session is still refused, the session expiring closes the door
 * again, and the actor's own console does not come along for the ride.
 */
function supportAgent(Permission ...$permissions): User
{
    $role = Role::create([
        'slug' => 'kangaru-walkin-'.fake()->unique()->numerify('###'),
        'name' => 'Kangaru Support',
        'audience' => RoleAudience::KANGARU,
        'description' => 'Head office support.',
        'permissions' => array_map(fn (Permission $p) => $p->value, $permissions),
        'requires_mfa' => false,
        'is_system' => false,
    ]);

    $user = new User([
        'name' => 'Nakato Sarah',
        'email' => 'sarah-'.fake()->unique()->numerify('###').'@kangaruride.test',
        'password' => 'password',
        'role' => $role->slug,
    ]);
    $user->status = UserStatus::ACTIVE;
    $user->access_level = AccessLevel::KANGARU;
    $user->save();

    return $user;
}

/** The support agent's own console token, and a live session against a walk-in. */
function holding(Customer $walkIn, ?User $agent = null): array
{
    $agent ??= supportAgent(Permission::SUPPORT_ACT_AS);
    $token = $agent->createToken('api')->plainTextToken;

    $session = ImpersonationSession::create([
        'actor_user_id' => $agent->getKey(),
        'subject_type' => $walkIn->getMorphClass(),
        'subject_id' => $walkIn->getKey(),
        'reason' => 'Ticket 918 — their car never arrived',
        'started_at' => now(),
        'expires_at' => now()->addMinutes(ImpersonationSession::LIFETIME_MINUTES),
    ]);

    return [$agent, $token, $session];
}

// ── Starting one ────────────────────────────────────────────────────────────

it('starts a session against a walk-in, who is not a users row at all', function () {
    Notification::fake();

    $walkIn = Customer::factory()->create(['email' => 'brenda@walkin.test']);
    $agent = supportAgent(Permission::SUPPORT_ACT_AS);

    $response = $this->actingAs($agent)->postJson('/api/v1/support/act-as', [
        'subject_type' => 'customer',
        'subject_id' => $walkIn->id,
        'reason' => 'Ticket 918 — their car never arrived',
    ]);

    $response->assertCreated();
    expect($response->json('data.subject_kind'))->toBe('customer');

    $session = ImpersonationSession::query()->latest('id')->firstOrFail();
    expect($session->subject_type)->toBe($walkIn->getMorphClass())
        ->and($session->subject_id)->toBe($walkIn->id);
});

/**
 * The half of the disclosure the person actually reads (ADR-0056 §5, ADR-0066
 * §6). It named drivers *and walk-in customers*, and the shipped service did
 * drivers only — a walk-in is the more individual of the two by any reading,
 * since no employer reads their log.
 */
it('tells the walk-in by email that their account was opened', function () {
    Notification::fake();

    $walkIn = Customer::factory()->create(['email' => 'brenda@walkin.test']);

    $this->actingAs(supportAgent(Permission::SUPPORT_ACT_AS))
        ->postJson('/api/v1/support/act-as', [
            'subject_type' => 'customer',
            'subject_id' => $walkIn->id,
            'reason' => 'Ticket 918 — their car never arrived',
        ])
        ->assertCreated();

    // Routed by address, not sent to the model: `Customer` is not `Notifiable`
    // and has no in-app inbox for the database channel to write to.
    Notification::assertSentOnDemand(
        AccountAccessedBySupportNotification::class,
        fn ($notification, $channels, $notifiable) => $notifiable->routes['mail'] === 'brenda@walkin.test',
    );
});

it('refuses an agent without the act-as grant, walk-in or not', function () {
    $walkIn = Customer::factory()->create();

    $this->actingAs(supportAgent(Permission::CUSTOMERS_VIEW))
        ->postJson('/api/v1/support/act-as', [
            'subject_type' => 'customer',
            'subject_id' => $walkIn->id,
            'reason' => 'Ticket 918 — their car never arrived',
        ])
        ->assertForbidden();
});

/**
 * The two id spaces overlap, so `exists:users,id` on a walk-in's id would pass
 * whenever the tables happened to share a number — and the agent would become
 * an entirely different person than the one they named.
 */
it('resolves the subject in the table the kind names, not whichever has the id', function () {
    Notification::fake();

    $collision = User::factory()->create([
        'name' => 'Not This Person',
        'tenant_id' => Tenant::factory()->create()->id,
        'access_level' => AccessLevel::CLIENT,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    // The collision is **staged**, not avoided. `customers` and `users` are
    // independent sequences, so one number names two different people, and a
    // rule of `exists:users,id` on a walk-in's id would have passed here and
    // made a support agent somebody they never named. Walking the sequence up
    // to the user's id is what makes this deterministic rather than a test
    // that passes on the days the numbers happen to line up.
    $walkIn = null;
    while ($walkIn === null || $walkIn->id < $collision->id) {
        $walkIn = Customer::factory()->create();
    }

    expect($walkIn->id)->toBe($collision->id)
        ->and($walkIn->name)->not->toBe($collision->name);

    $response = $this->actingAs(supportAgent(Permission::SUPPORT_ACT_AS))
        ->postJson('/api/v1/support/act-as', [
            'subject_type' => 'customer',
            'subject_id' => $walkIn->id,
            'reason' => 'Ticket 918 — their car never arrived',
        ]);

    expect($response->json('data.subject_name'))->toBe($walkIn->name)
        ->and($response->json('data.subject_kind'))->toBe('customer');
});

// ── The guard exception (ADR-0066 §3) ───────────────────────────────────────

it('lets a support agent read the walk-in’s own orders, on the walk-in’s surface', function () {
    $walkIn = Customer::factory()->create();
    [, $token] = holding($walkIn);

    $this->withToken($token)
        ->getJson('/api/v1/customer/auth/me')
        ->assertOk()
        ->assertJsonPath('data.id', $walkIn->id);
});

/**
 * **The tripwire, in its conditional form.**
 *
 * `CustomerGuardIsolationTest` proved a staff token could never reach here.
 * That claim is no longer unconditional, so the conditional version has to be
 * proved or ADR-0013 §2 has quietly become a comment: refused without a
 * session, permitted with one, refused again once it lapses.
 */
it('refuses the same staff token when no session is open', function () {
    $agent = supportAgent(Permission::SUPPORT_ACT_AS);
    $token = $agent->createToken('api')->plainTextToken;

    $this->withToken($token)->getJson('/api/v1/customer/auth/me')->assertStatus(401);
});

it('refuses the same staff token once the session has lapsed', function () {
    $walkIn = Customer::factory()->create();
    [, $token, $session] = holding($walkIn);

    // The time-box is a predicate, not a sweeper: nothing has to run for it to
    // bite, which is why this is expressed as travel rather than as a job.
    $session->forceFill(['expires_at' => now()->subMinute()])->save();

    $this->withToken($token)->getJson('/api/v1/customer/auth/me')->assertStatus(401);
});

it('refuses a staff token whose live session names a staff subject', function () {
    $agent = supportAgent(Permission::SUPPORT_ACT_AS);
    $token = $agent->createToken('api')->plainTextToken;

    $staffSubject = User::factory()->create([
        'tenant_id' => Tenant::factory()->create()->id,
        'access_level' => AccessLevel::CLIENT,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    ImpersonationSession::create([
        'actor_user_id' => $agent->getKey(),
        'subject_type' => $staffSubject->getMorphClass(),
        'subject_id' => $staffSubject->getKey(),
        'reason' => 'Ticket 4021 — cannot see their invoice',
        'started_at' => now(),
        'expires_at' => now()->addMinutes(30),
    ]);

    // That session's reach is on the staff surface, where `ActAsSubject`
    // applies it. It buys nothing here, and must not.
    $this->withToken($token)->getJson('/api/v1/customer/auth/me')->assertStatus(401);
});

it('still refuses an ordinary staff token with no session, which is the old promise', function () {
    $ordinary = User::factory()->create([
        'tenant_id' => Tenant::factory()->create()->id,
        'access_level' => AccessLevel::CLIENT,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    $this->withToken($ordinary->createToken('api')->plainTextToken)
        ->getJson('/api/v1/customer/auth/me')
        ->assertStatus(401);
});

it('leaves a walk-in’s own token working exactly as it did', function () {
    $walkIn = Customer::factory()->create();

    $this->withToken($walkIn->createToken('customer')->plainTextToken)
        ->getJson('/api/v1/customer/auth/me')
        ->assertOk()
        ->assertJsonPath('data.id', $walkIn->id);
});

// ── What stays denied (ADR-0066 §4) ─────────────────────────────────────────

/**
 * Mechanical rather than moral: `logout` revokes `currentAccessToken()`, which
 * under a session is the **support agent's own staff token**. Without this the
 * agent signs themselves out of the console and revokes the credential the
 * session runs on.
 */
it('refuses to sign the walk-in out, because that token is the agent’s own', function () {
    $walkIn = Customer::factory()->create();
    [$agent, $token] = holding($walkIn);

    $this->withToken($token)
        ->postJson('/api/v1/customer/auth/logout')
        ->assertForbidden();

    // The proof that matters is not the status — it is that the agent can
    // still use their own console token afterwards.
    expect($agent->tokens()->count())->toBe(1);
});

it('lets a walk-in sign themselves out, which is not the same act', function () {
    $walkIn = Customer::factory()->create();

    $this->withToken($walkIn->createToken('customer')->plainTextToken)
        ->postJson('/api/v1/customer/auth/logout')
        ->assertSuccessful();
});

// ── The staff console is closed (ADR-0066 §5) ───────────────────────────────

/**
 * ADR-0056 §1: *"the actor's own `kangaru` reach is set aside entirely while
 * the session is open."* For a `User` subject the swap makes that structural.
 * A `Customer` has no staff identity to be replaced by, so without this it
 * would be the one session that kept its own powers — held by the one account
 * that can become anybody.
 */
it('shuts the staff console while a walk-in is being held', function () {
    $walkIn = Customer::factory()->create();
    [, $token] = holding($walkIn);

    $this->withToken($token)->getJson('/api/v1/companies')->assertForbidden();
    $this->withToken($token)->getJson('/api/v1/customers')->assertForbidden();
    $this->withToken($token)->getJson('/api/v1/audit-logs')->assertForbidden();
});

it('keeps open the four routes that draw the banner and the way out', function () {
    $walkIn = Customer::factory()->create();
    [, $token] = holding($walkIn);

    // The shell, so the banner has something to render inside.
    $this->withToken($token)->getJson('/api/v1/auth/me')->assertOk();

    // How the banner learns it should be drawn, and what it says.
    $this->withToken($token)
        ->getJson('/api/v1/support/act-as')
        ->assertOk()
        ->assertJsonPath('data.subject_kind', 'customer')
        ->assertJsonPath('data.subject_name', $walkIn->name);

    // The way out, and it must never be the thing that is shut.
    $this->withToken($token)->deleteJson('/api/v1/support/act-as')->assertSuccessful();
});

it('gives the console back the moment the session ends', function () {
    $walkIn = Customer::factory()->create();
    [, $token] = holding($walkIn);

    $this->withToken($token)->getJson('/api/v1/companies')->assertForbidden();
    $this->withToken($token)->deleteJson('/api/v1/support/act-as')->assertSuccessful();

    // Not a 403 any more. Whether it is a 200 or a 403-for-permissions is the
    // ordinary policy's business; what this asserts is that the *session's*
    // refusal has lifted.
    $this->withToken($token)->getJson('/api/v1/customer/auth/me')->assertStatus(401);
});
