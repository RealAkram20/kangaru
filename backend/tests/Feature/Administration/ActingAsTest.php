<?php

use App\Enums\AccessLevel;
use App\Enums\Permission;
use App\Enums\RoleAudience;
use App\Enums\UserRole;
use App\Models\AuditLog;
use App\Models\ImpersonationSession;
use App\Models\Operator;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Access\ImpersonationContext;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Notification;
use Illuminate\Validation\ValidationException;
use Modules\Administration\Models\Role;
use Modules\Administration\Services\ImpersonationService;
use Modules\Drivers\Models\Driver;
use Modules\Notifications\Notifications\AccountAccessedBySupportNotification;

/**
 * Acting as somebody else (ADR-0056).
 *
 * The ADR reverses a position this codebase states twice — *"no password
 * reset, no impersonation"* — and it does so on one condition: that the audit
 * trail can tell a borrowed identity apart from the person's own hand. These
 * tests are that condition, and the one that matters most is the last: **a
 * denied act stays denied while acting as somebody who holds the permission.**
 * Nobody writes that test by habit, and without it §3 is a comment.
 */
function kangaruWith(Permission ...$permissions): User
{
    $role = Role::create([
        'slug' => 'kangaru-support-'.fake()->unique()->numerify('###'),
        'name' => 'Kangaru Support',
        'audience' => RoleAudience::KANGARU,
        'description' => 'Head office support.',
        'permissions' => array_map(fn (Permission $p) => $p->value, $permissions),
        'requires_mfa' => false,
        'is_system' => false,
    ]);

    $user = new User([
        'name' => 'Head Office',
        'email' => 'hq-'.fake()->unique()->numerify('###').'@kangaruride.test',
        'password' => 'password',
        'role' => $role->slug,
    ]);
    $user->access_level = AccessLevel::KANGARU;
    $user->save();

    return $user;
}

it('records the session, and the start of it, not only what happens inside', function () {
    $actor = kangaruWith(Permission::SUPPORT_ACT_AS);
    $subject = User::factory()->create(['tenant_id' => Tenant::factory()->create()->id]);

    $session = app(ImpersonationService::class)
        ->begin($actor, $subject, 'Ticket 4021 — cannot see their March invoice');

    // ADR-0056 §2: "a session that opened, looked, and changed nothing must
    // still leave a record — reading a bank's trip history is the act."
    $audit = AuditLog::allTenants()
        ->where('auditable_type', $session->getMorphClass())
        ->where('auditable_id', $session->getKey())
        ->sole();

    expect($session->isLive())->toBeTrue()
        ->and($session->expires_at->diffInMinutes($session->started_at, true))
        ->toBe((float) ImpersonationSession::LIFETIME_MINUTES)
        ->and($audit->user_id)->toBe($actor->id)
        ->and($audit->changes['after']['reason'])->toContain('Ticket 4021');
});

it('names both hands on anything done while acting', function () {
    $actor = kangaruWith(Permission::SUPPORT_ACT_AS);
    $subject = User::factory()->create(['tenant_id' => Tenant::factory()->create()->id]);

    $session = app(ImpersonationService::class)->begin($actor, $subject, 'Ticket 4021');
    app(ImpersonationContext::class)->begin($session);

    $this->actingAs($subject, 'sanctum');
    $subject->forceFill(['name' => 'Corrected By Support'])->save();

    $row = AuditLog::allTenants()
        ->where('auditable_type', $subject->getMorphClass())
        ->where('auditable_id', $subject->getKey())
        ->latest('id')
        ->first();

    // `user_id` stays the **subject** so the client's own trail reads
    // chronologically; `impersonator_id` names who was holding the account.
    // Never one without the other (ADR-0056 §2).
    expect($row->user_id)->toBe($subject->id)
        ->and($row->impersonator_id)->toBe($actor->id);
});

it('refuses an account that is not head office', function () {
    $fleetAdmin = User::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'role' => UserRole::SUPER_ADMIN,
    ]);
    $subject = User::factory()->create(['tenant_id' => Tenant::factory()->create()->id]);

    expect(fn () => app(ImpersonationService::class)->begin($fleetAdmin, $subject, 'why'))
        ->toThrow(AuthorizationException::class);
});

it('refuses head office without the permission, which no role implies', function () {
    // A head-office account whose role does **not** carry the grant.
    //
    // Super Admin *does* carry it, with every other permission — excluding it
    // from that catalogue was tried and reverted the same hour, because
    // `StoreRoleRequest` refuses to let anybody author a role granting a
    // permission they do not hold, which made it ungrantable by any screen.
    // What keeps the grant narrow is the **level**, not the catalogue: a fleet
    // Super Admin holds this permission and cannot use it (asserted above).
    //
    // So this uses a purpose-made role holding one unrelated permission, which
    // is what proves the check is on `support.act-as` specifically rather than
    // on being head office.
    $actor = kangaruWith(Permission::STAFF_MANAGE);
    $subject = User::factory()->create(['tenant_id' => Tenant::factory()->create()->id]);

    expect(fn () => app(ImpersonationService::class)->begin($actor, $subject, 'why'))
        ->toThrow(AuthorizationException::class);
});

it('refuses to chain, so a session cannot reach another head office account', function () {
    $actor = kangaruWith(Permission::SUPPORT_ACT_AS);
    $otherHeadOffice = kangaruWith(Permission::SUPPORT_ACT_AS);

    // Chaining is how an agent would reach `support.act-as` itself and become
    // anybody a second time, with the trail naming the wrong person at each hop.
    expect(fn () => app(ImpersonationService::class)->begin($actor, $otherHeadOffice, 'why'))
        ->toThrow(ValidationException::class);
});

it('refuses a second session while one is open', function () {
    $actor = kangaruWith(Permission::SUPPORT_ACT_AS);
    $first = User::factory()->create(['tenant_id' => Tenant::factory()->create()->id]);
    $second = User::factory()->create(['tenant_id' => Tenant::factory()->create()->id]);

    app(ImpersonationService::class)->begin($actor, $first, 'Ticket 1');

    // Two live sessions would make "who is this request" depend on which row
    // the middleware happened to pick — so the second would be silently
    // ignored rather than refused.
    expect(fn () => app(ImpersonationService::class)->begin($actor, $second, 'Ticket 2'))
        ->toThrow(ValidationException::class);
});

it('stops being live once it is ended', function () {
    $actor = kangaruWith(Permission::SUPPORT_ACT_AS);
    $subject = User::factory()->create(['tenant_id' => Tenant::factory()->create()->id]);

    $session = app(ImpersonationService::class)->begin($actor, $subject, 'Ticket 1');
    app(ImpersonationService::class)->end($session);

    expect($session->fresh()->isLive())->toBeFalse()
        ->and(ImpersonationSession::query()->live()->count())->toBe(0);
});

it('stops being live once it times out, with nothing sweeping the table', function () {
    $actor = kangaruWith(Permission::SUPPORT_ACT_AS);
    $subject = User::factory()->create(['tenant_id' => Tenant::factory()->create()->id]);

    $session = app(ImpersonationService::class)->begin($actor, $subject, 'Ticket 1');

    // Expiry is a predicate, not a cron. A scheduler that stops running cannot
    // leave a session standing, which is the silent failure the master plan
    // names as the one it most fears.
    $this->travel(ImpersonationSession::LIFETIME_MINUTES + 1)->minutes();

    expect(ImpersonationSession::query()->live()->count())->toBe(0)
        ->and($session->fresh()->ended_at)->toBeNull();
});

/**
 * The test nobody writes by habit, and the one that makes §3 real.
 */
it('keeps a denied act denied while acting as somebody who may do it', function () {
    $actor = kangaruWith(Permission::SUPPORT_ACT_AS);

    // A Finance officer who genuinely holds the permission to settle.
    $finance = User::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'role' => UserRole::FINANCE,
    ]);

    $session = app(ImpersonationService::class)->begin($actor, $finance, 'Ticket 4021');
    app(ImpersonationContext::class)->begin($session);

    // Money leaving the platform on a borrowed identity is the classic fraud
    // path. The subject may do this; the person holding their account may not.
    $this->actingAs($finance, 'sanctum')
        ->postJson('/api/v1/settlement-requests/1/confirm')
        ->assertForbidden()
        ->assertJsonPath('code', 'FORBIDDEN');
});

it('leaves the same act available to the person themselves', function () {
    $finance = User::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'role' => UserRole::FINANCE,
    ]);

    // The control. Without it the test above proves only that the endpoint
    // refuses somebody — not that *acting as* is what refused them. A missing
    // settlement request is a 404; what matters is that it is not our 403.
    $this->actingAs($finance, 'sanctum')
        ->postJson('/api/v1/settlement-requests/1/confirm')
        ->assertStatus(404);
});

/* -------------------------------------------------------- the endpoints --- */

it('starts and stops a session over the wire', function () {
    $actor = kangaruWith(Permission::SUPPORT_ACT_AS);
    $subject = User::factory()->create(['tenant_id' => Tenant::factory()->create()->id]);

    $this->actingAs($actor, 'sanctum')
        ->postJson('/api/v1/support/act-as', [
            'subject_id' => $subject->id,
            'reason' => 'Ticket 4021 — cannot see their March invoice',
        ])
        ->assertCreated()
        ->assertJsonPath('data.subject_id', $subject->id);

    expect(ImpersonationSession::query()->live()->count())->toBe(1);

    // The **actor's** token is what is presented, throughout. `ActAsSubject`
    // swaps the *user* downstream so scopes and policies see the subject, but
    // the session is found by the token's own owner — which is why
    // `ImpersonationContext` carries the session rather than just a boolean,
    // and why `destroy()` reads it instead of `$request->user()`.
    //
    // The first version of this test signed the DELETE as the subject and left
    // the session open: the middleware found nothing to swap, so there was
    // nothing to end.
    $this->actingAs($actor, 'sanctum')
        ->deleteJson('/api/v1/support/act-as')
        ->assertNoContent();

    expect(ImpersonationSession::query()->live()->count())->toBe(0);
});

it('refuses to start without a reason worth recording', function () {
    $actor = kangaruWith(Permission::SUPPORT_ACT_AS);
    $subject = User::factory()->create(['tenant_id' => Tenant::factory()->create()->id]);

    $this->actingAs($actor, 'sanctum')
        ->postJson('/api/v1/support/act-as', ['subject_id' => $subject->id, 'reason' => 'x'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('reason');
});

it('refuses an actor who holds no grant, without being told who they meant', function () {
    $actor = kangaruWith(Permission::STAFF_MANAGE);
    $subject = User::factory()->create(['tenant_id' => Tenant::factory()->create()->id]);

    // 403 from the Gate in `authorize()`, before the rules run — so an agent
    // without the grant never learns whether the subject they named exists.
    $this->actingAs($actor, 'sanctum')
        ->postJson('/api/v1/support/act-as', [
            'subject_id' => $subject->id,
            'reason' => 'Ticket 4021 — trying anyway',
        ])
        ->assertForbidden();

    expect(ImpersonationSession::query()->count())->toBe(0);
});

it('lets stopping succeed even when there is nothing to stop', function () {
    $someone = User::factory()->create(['tenant_id' => Tenant::factory()->create()->id]);

    // Idempotent by design: a support agent pressing "stop" twice, or after
    // the thirty minutes ran out, has got what they wanted either way. An
    // error there would teach them the button is unreliable.
    $this->actingAs($someone, 'sanctum')
        ->deleteJson('/api/v1/support/act-as')
        ->assertNoContent();
});

it('tells the console it is being borrowed, and until when', function () {
    $actor = kangaruWith(Permission::SUPPORT_ACT_AS);
    $subject = User::factory()->create(['tenant_id' => Tenant::factory()->create()->id]);

    $this->actingAs($actor, 'sanctum')->postJson('/api/v1/support/act-as', [
        'subject_id' => $subject->id,
        'reason' => 'Ticket 4021 — cannot see their March invoice',
    ])->assertCreated();

    // The console cannot work this out for itself: by the time it asks, the
    // middleware has already swapped the user, so `auth/me` answers as the
    // subject. Without this the browser renders as that person with nothing to
    // say it is not really them — the exact failure the banner prevents.
    $this->actingAs($actor, 'sanctum')
        ->getJson('/api/v1/support/act-as')
        ->assertOk()
        ->assertJsonPath('data.subject_name', $subject->name);
});

it('tells everybody else that they are simply themselves', function () {
    $someone = User::factory()->create(['tenant_id' => Tenant::factory()->create()->id]);

    $this->actingAs($someone, 'sanctum')
        ->getJson('/api/v1/support/act-as')
        ->assertOk()
        ->assertJsonPath('data', null);
});

/* ------------------------------------------- telling the person (§5) --- */

it('tells a driver that support opened their account', function () {
    Notification::fake();

    $actor = kangaruWith(Permission::SUPPORT_ACT_AS);
    $driverAccount = User::factory()->create(['role' => UserRole::DRIVER]);
    Driver::factory()->create(['user_id' => $driverAccount->id]);

    app(ImpersonationService::class)->begin($actor, $driverAccount, 'Ticket 4021');

    // The audit trail already records it. A trail nobody is told to look at
    // deters nothing, and ADR-0056 reversed a refusal on the strength of the
    // trail being meaningful — which it only is if the person knows.
    Notification::assertSentTo($driverAccount, AccountAccessedBySupportNotification::class);
});

it('does not send the reason the agent typed', function () {
    Notification::fake();

    $actor = kangaruWith(Permission::SUPPORT_ACT_AS);
    $driverAccount = User::factory()->create(['role' => UserRole::DRIVER]);
    Driver::factory()->create(['user_id' => $driverAccount->id]);

    app(ImpersonationService::class)
        ->begin($actor, $driverAccount, 'Ticket 4021 — caller says Musa took the cash');

    // The reason is written for the office and an auditor: ticket numbers,
    // internal shorthand, sometimes a third party's name. Forwarding it to the
    // person the session was *about* would leak the support desk's own notes.
    Notification::assertSentTo(
        $driverAccount,
        AccountAccessedBySupportNotification::class,
        fn (AccountAccessedBySupportNotification $n) => ! str_contains($n->body(), 'Musa')
            && ! str_contains($n->body(), 'Ticket 4021'),
    );
});

it('does not notify a corporate user, whose organisation reads the same event', function () {
    Notification::fake();

    $actor = kangaruWith(Permission::SUPPORT_ACT_AS);
    $clientUser = User::factory()->create(['tenant_id' => Tenant::factory()->create()->id]);

    app(ImpersonationService::class)->begin($actor, $clientUser, 'Ticket 4021');

    // ADR-0056 §5 asks for this for *individuals*. A corporate user's own
    // organisation reads the same event in its audit log; a driver has nobody
    // reading anything on their behalf. Widening it is a decision, not a
    // tidy-up — so the narrower reading is asserted rather than assumed.
    Notification::assertNothingSentTo($clientUser);
});
