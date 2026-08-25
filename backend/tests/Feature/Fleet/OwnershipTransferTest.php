<?php

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Operator;
use App\Models\Plan;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Modules\Administration\Services\SettingsService;
use Modules\Fleet\Models\OwnershipTransfer;
use Modules\Notifications\Models\MailDelivery;

/**
 * A fleet changing hands (owner's decision, 24 August).
 *
 * *"if the email not comfirmed then we keep the old email"* — so half of
 * these tests assert that **nothing happened**: no account, no suspension,
 * no change of owner, for every path short of the new owner setting their
 * password. The other half assert the one path where everything happens,
 * happens atomically.
 *
 * Helpers carry a `handover` prefix because Pest files share one global
 * function namespace, and `CompanySuperAdminScopeTest` has already paid for
 * assuming a sibling file would be loaded alongside it.
 */
function handoverMailOn(): void
{
    app(SettingsService::class)->setGroup('mail', [
        'enabled' => true,
        'host' => 'smtp.example.test',
        'port' => 587,
        'username' => '',
        'password' => 'secret',
        'encryption' => 'tls',
        'from_address' => 'operations@kangaruride.test',
        'from_name' => 'KangaruRide',
    ]);
}

function handoverHeadOffice(): User
{
    return User::factory()->create([
        'tenant_id' => null,
        'operator_id' => null,
        'access_level' => AccessLevel::KANGARU,
        'role' => UserRole::SUPER_ADMIN,
        'status' => UserStatus::ACTIVE,
    ]);
}

/** @return array{operator: Operator, owner: User} */
function handoverFleet(): array
{
    $operator = Operator::create([
        'name' => 'Second Fleet Ltd',
        'slug' => 'second-fleet-handover',
        'status' => 'active',
    ]);

    $owner = User::factory()->create([
        'tenant_id' => null,
        'operator_id' => $operator->id,
        'access_level' => AccessLevel::FLEET,
        'role' => UserRole::FLEET_OWNER,
        'status' => UserStatus::ACTIVE,
        'email' => 'sitting.owner@secondfleet.test',
    ]);

    return ['operator' => $operator, 'owner' => $owner];
}

/** The plaintext never leaves the service, so tests plant a known one —
 * the same move `InvitationTest` makes, for the same reason. */
function handoverToken(Operator $operator): string
{
    $token = 'known-handover-token-for-tests-0123456789abcdef0';

    OwnershipTransfer::query()
        ->where('operator_id', $operator->id)
        ->update(['token_hash' => hash('sha256', $token)]);

    return $token;
}

it('sends the welcome email and changes nothing else', function () {
    handoverMailOn();
    Mail::fake();

    ['operator' => $operator, 'owner' => $owner] = handoverFleet();

    $this->actingAs(handoverHeadOffice(), 'sanctum')
        ->putJson("/api/v1/operators/{$operator->id}/owner", [
            'name' => 'Grace Auma',
            'email' => 'grace@secondfleet.test',
        ])
        ->assertOk()
        // The record page's pending state, straight off the answer.
        ->assertJsonPath('data.pending_owner.email', 'grace@secondfleet.test');

    // The email left, to the address that has no account.
    $delivery = MailDelivery::query()->where('recipient', 'grace@secondfleet.test')->firstOrFail();
    expect($delivery->type)->toBe('platform.fleet.ownership_invited')
        ->and($delivery->status)->toBe(MailDelivery::SENT);

    // And nothing else moved: no account for the new address, and the
    // sitting owner untouched. This is the owner's own specification.
    expect(User::query()->where('email', 'grace@secondfleet.test')->exists())->toBeFalse()
        ->and($owner->refresh()->status)->toBe(UserStatus::ACTIVE);
});

it("refuses a fleet's own super admin the handover, both verbs", function () {
    ['operator' => $operator] = handoverFleet();

    $fleetAdmin = User::factory()->create([
        'tenant_id' => null,
        'operator_id' => $operator->id,
        'access_level' => AccessLevel::FLEET,
        'role' => UserRole::SUPER_ADMIN,
        'status' => UserStatus::ACTIVE,
    ]);

    $this->actingAs($fleetAdmin, 'sanctum')
        ->putJson("/api/v1/operators/{$operator->id}/owner", [
            'name' => 'A', 'email' => 'a@sneaky.test',
        ])
        ->assertForbidden();

    $this->actingAs($fleetAdmin, 'sanctum')
        ->deleteJson("/api/v1/operators/{$operator->id}/owner")
        ->assertForbidden();
});

it('refuses handing a fleet to the person who already owns it', function () {
    ['operator' => $operator, 'owner' => $owner] = handoverFleet();

    // Nothing to hand over, and the only effect would be resetting the sitting
    // owner's password through a door built for something else.
    $this->actingAs(handoverHeadOffice(), 'sanctum')
        ->putJson("/api/v1/operators/{$operator->id}/owner", [
            'name' => 'The Same Person',
            'email' => $owner->email,
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('email');
});

it("refuses an address belonging to another organisation's account", function () {
    ['operator' => $operator] = handoverFleet();

    // A client's own administrator. Handing them a fleet would move a person
    // between organisations on the strength of an emailed link, which is the
    // write ADR-0065 spent a release closing on the read side.
    $tenant = Tenant::factory()->create();
    $clientAdmin = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_ADMIN,
    ]);

    $this->actingAs(handoverHeadOffice(), 'sanctum')
        ->putJson("/api/v1/operators/{$operator->id}/owner", [
            'name' => 'Wrong Person',
            'email' => $clientAdmin->email,
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors('email');
});

it('hands the fleet to somebody who already has an applicant account, without minting a second', function () {
    handoverMailOn();
    Mail::fake();

    ['operator' => $operator, 'owner' => $sitting] = handoverFleet();

    /*
     * The failure this exists for, from live on 25 August. An incoming owner
     * was invited at 21:22, filed a driver application at 01:44 — which mints
     * an account at submission time (ADR-0055, amendment) — and was then told
     * her four-hour-old link had expired. It had not: the handover simply had
     * no way to reach an address that already had an account, and said the
     * wrong thing about it.
     */
    $applicant = new User([
        'name' => 'Susan Nanyanzi',
        'email' => 'susan@applicant.test',
        'password' => 'whatever-they-set-at-application',
        'role' => UserRole::DRIVER,
        'status' => UserStatus::ACTIVE,
    ]);
    $applicant->access_level = AccessLevel::APPLICANT;
    $applicant->save();

    $this->actingAs(handoverHeadOffice(), 'sanctum')
        ->putJson("/api/v1/operators/{$operator->id}/owner", [
            'name' => 'Susan Nanyanzi',
            'email' => 'susan@applicant.test',
        ])
        ->assertOk();

    $this->postJson('/api/v1/owner-transfers/'.handoverToken($operator).'/accept', [
        'password' => 'a-long-enough-password',
        'password_confirmation' => 'a-long-enough-password',
    ])->assertOk();

    // The same account, promoted — not a second one on the same address.
    expect(User::query()->where('email', 'susan@applicant.test')->count())->toBe(1);

    $promoted = $applicant->fresh();

    expect($promoted->id)->toBe($applicant->id)
        ->and($promoted->access_level)->toBe(AccessLevel::FLEET)
        ->and($promoted->operator_id)->toBe($operator->id)
        ->and($promoted->roleSlug())->toBe(UserRole::FLEET_OWNER->value)
        // Their own name survives. Head office typed a name to say who it
        // meant, not to rewrite somebody's record.
        ->and($promoted->name)->toBe('Susan Nanyanzi');

    // And the handover actually happened: the sitting owner stands down.
    expect($sitting->refresh()->status)->toBe(UserStatus::SUSPENDED);

    // The password they just chose is the one that works.
    $this->postJson('/api/v1/auth/login', [
        'email' => 'susan@applicant.test',
        'password' => 'a-long-enough-password',
    ])->assertOk();
});

it('hands the fleet over when the new owner sets their password, and not before', function () {
    handoverMailOn();
    Mail::fake();

    ['operator' => $operator, 'owner' => $sitting] = handoverFleet();

    $this->actingAs(handoverHeadOffice(), 'sanctum')
        ->putJson("/api/v1/operators/{$operator->id}/owner", [
            'name' => 'Grace Auma',
            'email' => 'grace@secondfleet.test',
        ])
        ->assertOk();

    $token = handoverToken($operator);

    // The accept page can say whose fleet this is before asking anything.
    $this->getJson("/api/v1/owner-transfers/{$token}")
        ->assertOk()
        ->assertJsonPath('data.company', 'Second Fleet Ltd')
        ->assertJsonPath('data.email', 'grace@secondfleet.test');

    $this->postJson("/api/v1/owner-transfers/{$token}/accept", [
        'password' => 'chosen-by-grace-alone',
        'password_confirmation' => 'chosen-by-grace-alone',
    ])->assertOk();

    // The new owner exists, active, with the password only they know.
    $grace = User::query()->where('email', 'grace@secondfleet.test')->firstOrFail();
    // The raw column: `role`'s cast answers an enum or a string depending
    // on whether the roles table is seeded, and this assertion is about
    // what was written, not about the cast.
    expect($grace->getAttributes()['role'])->toBe(UserRole::FLEET_OWNER->value)
        ->and($grace->operator_id)->toBe($operator->id)
        ->and($grace->status)->toBe(UserStatus::ACTIVE)
        ->and(Hash::check('chosen-by-grace-alone', (string) $grace->password))->toBeTrue();

    // The sitting owner is out: suspended, retention clock stamped, and
    // their name still on their own history rather than rewritten.
    expect($sitting->refresh()->status)->toBe(UserStatus::SUSPENDED)
        ->and($sitting->deactivated_at)->not->toBeNull()
        ->and($sitting->email)->toBe('sitting.owner@secondfleet.test');

    // Single use: the same link again is told it was used, not that it lapsed.
    $this->postJson("/api/v1/owner-transfers/{$token}/accept", [
        'password' => 'second-try-anything',
        'password_confirmation' => 'second-try-anything',
    ])->assertStatus(409);
});

it('keeps the old owner when the link expires unconfirmed', function () {
    handoverMailOn();
    Mail::fake();

    ['operator' => $operator, 'owner' => $sitting] = handoverFleet();

    $this->actingAs(handoverHeadOffice(), 'sanctum')
        ->putJson("/api/v1/operators/{$operator->id}/owner", [
            'name' => 'Grace Auma',
            'email' => 'grace@secondfleet.test',
        ])
        ->assertOk();

    $token = handoverToken($operator);
    OwnershipTransfer::query()->where('operator_id', $operator->id)->update([
        'expires_at' => now()->subMinute(),
    ]);

    $this->postJson("/api/v1/owner-transfers/{$token}/accept", [
        'password' => 'too-late-to-matter',
        'password_confirmation' => 'too-late-to-matter',
    ])->assertStatus(410);

    // "If the email not confirmed then we keep the old email."
    expect(User::query()->where('email', 'grace@secondfleet.test')->exists())->toBeFalse()
        ->and($sitting->refresh()->status)->toBe(UserStatus::ACTIVE);
});

it('withdraws a proposal, and the emailed link stops working', function () {
    handoverMailOn();
    Mail::fake();

    ['operator' => $operator] = handoverFleet();
    $office = handoverHeadOffice();

    $this->actingAs($office, 'sanctum')
        ->putJson("/api/v1/operators/{$operator->id}/owner", [
            'name' => 'Grace Auma',
            'email' => 'grace@secondfleet.test',
        ])
        ->assertOk();

    $token = handoverToken($operator);

    $this->actingAs($office, 'sanctum')
        ->deleteJson("/api/v1/operators/{$operator->id}/owner")
        ->assertOk()
        ->assertJsonPath('data.pending_owner', null);

    $this->getJson("/api/v1/owner-transfers/{$token}")->assertNotFound();
});

it('replaces the pending proposal, which kills the earlier link', function () {
    handoverMailOn();
    Mail::fake();

    ['operator' => $operator] = handoverFleet();
    $office = handoverHeadOffice();

    $this->actingAs($office, 'sanctum')
        ->putJson("/api/v1/operators/{$operator->id}/owner", [
            'name' => 'Grace Auma', 'email' => 'grace@secondfleet.test',
        ])->assertOk();

    $first = handoverToken($operator);

    $this->actingAs($office, 'sanctum')
        ->putJson("/api/v1/operators/{$operator->id}/owner", [
            'name' => 'Daniel Okello', 'email' => 'daniel@secondfleet.test',
        ])->assertOk();

    // One live transfer per fleet — one key per door, as `invitations`.
    expect(OwnershipTransfer::query()->where('operator_id', $operator->id)->count())->toBe(1);
    $this->getJson("/api/v1/owner-transfers/{$first}")->assertNotFound();
});

it('refuses the handover when the address stopped being free while the link sat unread', function () {
    handoverMailOn();
    Mail::fake();

    ['operator' => $operator, 'owner' => $sitting] = handoverFleet();

    $this->actingAs(handoverHeadOffice(), 'sanctum')
        ->putJson("/api/v1/operators/{$operator->id}/owner", [
            'name' => 'Grace Auma', 'email' => 'grace@secondfleet.test',
        ])->assertOk();

    $token = handoverToken($operator);

    // A week passes and the address acquires an account at *another*
    // organisation — the factory's default is one of Shanitah's people.
    User::factory()->create(['email' => 'grace@secondfleet.test']);

    // 409 and its own code, not 410. This used to answer "that invitation has
    // expired", which was false and sent the reader to wait for a link that
    // would fail the same way. An account free to move is promoted instead;
    // this is the genuine cross-organisation case.
    $this->postJson("/api/v1/owner-transfers/{$token}/accept", [
        'password' => 'now-it-is-ambiguous',
        'password_confirmation' => 'now-it-is-ambiguous',
    ])->assertStatus(409)->assertJsonPath('code', 'OWNER_ADDRESS_IN_USE');

    expect($sitting->refresh()->status)->toBe(UserStatus::ACTIVE);
});

it('lets head office choose the plan at onboarding, and defaults it when absent', function () {
    handoverMailOn();
    Mail::fake();

    $office = handoverHeadOffice();

    $founding = Plan::query()->where('slug', 'founding-fleet')->firstOrFail();

    $chosen = $this->actingAs($office, 'sanctum')
        ->postJson('/api/v1/operators', [
            'name' => 'Chosen Plan Fleet',
            'owner_name' => 'A Owner',
            'owner_email' => 'owner@chosenplan.test',
            'plan_id' => $founding->id,
        ])
        ->assertCreated()
        ->json('data.plan.id');

    expect($chosen)->toBe($founding->id);

    // Absent still means the default, exactly as before (ADR-0058 §1).
    $defaulted = $this->actingAs($office, 'sanctum')
        ->postJson('/api/v1/operators', [
            'name' => 'Default Plan Fleet',
            'owner_name' => 'B Owner',
            'owner_email' => 'owner@defaultplan.test',
        ])
        ->assertCreated()
        ->json('data.plan.is_default');

    expect($defaulted)->toBeTrue();
});
