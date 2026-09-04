<?php

use App\Enums\AccessLevel;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Operator;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Notification;
use Modules\Administration\Models\Invitation;
use Modules\Administration\Services\InvitationService;
use Modules\Administration\Services\SettingsService;
use Modules\Fleet\Services\OperatorService;
use Modules\Notifications\Models\MailDelivery;
use Modules\Notifications\Notifications\AccountInvitedNotification;

/**
 * M2, the invitation.
 *
 * ## The bug this closes, stated once so nobody reintroduces it
 *
 * `OperatorService::onboard()` and `ClientOnboardingService::onboard()` both
 * created an active account with `Str::password(32)` and threw the password
 * away. Both carried a comment saying an invitation was how the account was
 * reached. **No invitation existed anywhere in the repo.** The forgot-password
 * escape hatch was closed twice over, by `auth.password_reset_enabled` being
 * false and by `mailConfigured()` being false, so `/auth/password/forgot`
 * answered 409.
 *
 * A fleet owner and a corporate client admin were therefore accounts nobody
 * could sign into, and every test in the suite passed.
 *
 * The first test below is the one that would have caught it, and it is written
 * against `OperatorService` rather than against the invitation machinery on
 * purpose: proving the machinery works proves nothing about whether onboarding
 * uses it.
 */
function mailOn(): void
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

/**
 * A client's administrator, and the client they administer.
 *
 * Local rather than reaching for `UserAdminTest`'s `staffFixture()`: Pest
 * loads each test file in its own pass, so a helper defined in another file
 * is only there by accident of ordering.
 *
 * @return array{tenant: Tenant, admin: User}
 */
function clientAdministrator(): array
{
    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $admin = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_ADMIN,
        'status' => UserStatus::ACTIVE,
    ]);

    return compact('tenant', 'admin');
}

function invitee(): User
{
    // Operator has no factory on purpose: until K2 there was deliberately no
    // way to create a second one at all. Built the way the rest of the suite
    // builds them.
    $operator = Operator::create([
        'name' => 'Shanitah General Enterprises',
        'slug' => 'shanitah-invite-test',
        'status' => 'active',
    ]);

    return User::factory()->create([
        'tenant_id' => null,
        'operator_id' => $operator->id,
        'access_level' => AccessLevel::FLEET,
        'role' => UserRole::FLEET_OWNER,
        'status' => UserStatus::ACTIVE,
        'email' => 'owner@shanitah.test',
    ]);
}

it('emails an invitation when a fleet is onboarded, so its owner can get in', function () {
    mailOn();
    Mail::fake();

    $operator = app(OperatorService::class)->onboard([
        'name' => 'Second Fleet Ltd',
        'owner_name' => 'Sarah Namuli',
        'owner_email' => 'sarah@secondfleet.test',
    ]);

    $owner = User::query()->where('operator_id', $operator->id)->firstOrFail();

    expect(Invitation::query()->where('user_id', $owner->id)->exists())->toBeTrue();

    // And it actually left the building, rather than merely being recorded.
    $delivery = MailDelivery::query()->where('recipient', 'sarah@secondfleet.test')->firstOrFail();

    expect($delivery->type)->toBe('account.invited')
        ->and($delivery->status)->toBe(MailDelivery::SENT);
});

it('lets the holder of a token see whose account it is', function () {
    mailOn();
    Mail::fake();

    $user = invitee();
    app(InvitationService::class)->invite($user);

    // The plaintext never leaves the service, so the test reproduces the token
    // the same way an attacker cannot: by making one and looking it up.
    $token = 'known-token-for-this-test-only-0123456789abcd';
    Invitation::query()->where('user_id', $user->id)->update(['token_hash' => hash('sha256', $token)]);

    $this->getJson("/api/v1/invitations/{$token}")
        ->assertOk()
        ->assertJsonPath('data.email', 'owner@shanitah.test');
});

it('sets a password, closes every session, and burns the link', function () {
    mailOn();
    Mail::fake();

    $user = invitee();
    $user->createToken('old session');

    app(InvitationService::class)->invite($user);

    $token = 'accept-token-for-this-test-only-0123456789abc';
    Invitation::query()->where('user_id', $user->id)->update(['token_hash' => hash('sha256', $token)]);

    $this->postJson("/api/v1/invitations/{$token}/accept", [
        'password' => 'a-real-password-9',
        'password_confirmation' => 'a-real-password-9',
    ])->assertOk();

    $user->refresh();

    expect(Hash::check('a-real-password-9', $user->password))->toBeTrue()
        // A credential change that leaves an existing session signed in has
        // changed nothing for whoever already had one.
        ->and($user->tokens()->count())->toBe(0)
        ->and(Invitation::query()->where('user_id', $user->id)->first()->accepted_at)->not->toBeNull();

    // Single use. The second attempt is told to sign in, not told it expired.
    $this->postJson("/api/v1/invitations/{$token}/accept", [
        'password' => 'another-password-9',
        'password_confirmation' => 'another-password-9',
    ])
        ->assertStatus(409)
        ->assertJsonPath('code', 'INVITATION_ALREADY_USED');
});

it('refuses an expired link with its own code, not a generic one', function () {
    mailOn();
    Mail::fake();

    $user = invitee();
    app(InvitationService::class)->invite($user);

    $token = 'expired-token-for-this-test-only-0123456789a';
    Invitation::query()->where('user_id', $user->id)->update([
        'token_hash' => hash('sha256', $token),
        'expires_at' => now()->subDay(),
    ]);

    $this->postJson("/api/v1/invitations/{$token}/accept", [
        'password' => 'a-real-password-9',
        'password_confirmation' => 'a-real-password-9',
    ])
        ->assertStatus(410)
        ->assertJsonPath('code', 'INVITATION_EXPIRED');
});

it('refuses an unknown token', function () {
    $this->getJson('/api/v1/invitations/nothing-here-at-all')
        ->assertStatus(404)
        ->assertJsonPath('code', 'NOT_FOUND');
});

it('will not let an invitation issued before a suspension become the way around it', function () {
    mailOn();
    Mail::fake();

    $user = invitee();
    app(InvitationService::class)->invite($user);

    $token = 'suspended-token-for-this-test-only-01234567a';
    Invitation::query()->where('user_id', $user->id)->update(['token_hash' => hash('sha256', $token)]);

    $user->update(['status' => UserStatus::SUSPENDED]);

    $this->postJson("/api/v1/invitations/{$token}/accept", [
        'password' => 'a-real-password-9',
        'password_confirmation' => 'a-real-password-9',
    ])->assertStatus(410);

    // And the password did not move.
    expect(Hash::check('a-real-password-9', $user->fresh()->password))->toBeFalse();
});

it('keeps only one live link per account, so resending kills the old one', function () {
    mailOn();
    Mail::fake();

    $user = invitee();

    app(InvitationService::class)->invite($user);
    $first = Invitation::query()->where('user_id', $user->id)->firstOrFail()->token_hash;

    app(InvitationService::class)->invite($user);
    $second = Invitation::query()->where('user_id', $user->id)->firstOrFail()->token_hash;

    expect(Invitation::query()->where('user_id', $user->id)->count())->toBe(1)
        // Two live links to one account is a second key lying in an older
        // email that may have been forwarded on.
        ->and($second)->not->toBe($first);
});

it('refuses a password a reset would refuse', function () {
    mailOn();
    Mail::fake();

    $user = invitee();
    app(InvitationService::class)->invite($user);

    $token = 'weak-password-token-for-this-test-0123456789';
    Invitation::query()->where('user_id', $user->id)->update(['token_hash' => hash('sha256', $token)]);

    $this->postJson("/api/v1/invitations/{$token}/accept", [
        'password' => 'short',
        'password_confirmation' => 'short',
    ])->assertStatus(422);
});

it('names the inviter in the email, and never puts the token in the stored payload', function () {
    mailOn();
    Mail::fake();

    $user = invitee();
    $inviter = User::factory()->create(['name' => 'Head Office', 'access_level' => AccessLevel::KANGARU]);

    $notification = new AccountInvitedNotification(
        app(InvitationService::class)->invite($user, $inviter),
        'the-plaintext-token',
        $inviter,
    );

    $content = $notification->mailContent();

    expect($content->paragraphs[0])->toContain('Head Office')
        ->and($content->paragraphs[0])->toContain('Shanitah General Enterprises')
        ->and($content->actionUrl)->toContain('the-plaintext-token')
        // `context()` becomes a stored row and push `data` for every other type
        // in this enum. A live credential belongs in neither.
        ->and(json_encode($notification->context()))->not->toContain('the-plaintext-token');
});

/*
|--------------------------------------------------------------------------
| Inviting a colleague, rather than inventing a password for them
|--------------------------------------------------------------------------
|
| `U2`. `StoreUserRequest`'s docblock used to justify the typed password by
| saying no invite flow existed — *"a half-built invite that emails a link to
| nowhere is worse than an honest 'tell them this password'."* It exists now,
| and this is the staff endpoint using it.
|
| Both paths are kept on purpose: mail is a setting and it is off on
| production, so an invitation-only endpoint would mean nobody can be added.
*/

it('creates a colleague with no known password and emails them a link', function () {
    Notification::fake();
    mailOn();

    ['admin' => $admin] = clientAdministrator();

    $this->actingAs($admin, 'sanctum')->postJson('/api/v1/users', [
        'name' => 'Grace Nakimuli',
        'email' => 'grace.nakimuli@centenary-bank.test',
        'phone' => '+256700000301',
        'role' => 'corporate_employee',
        'invite' => true,
    ])->assertStatus(201);

    $created = User::query()->where('email', 'grace.nakimuli@centenary-bank.test')->sole();

    // One live invitation, addressed to them, issued by the administrator who
    // added them — `invited_by` is what tells a support conversation who let
    // this person in.
    $invitation = Invitation::query()->where('user_id', $created->id)->sole();

    expect($invitation->invited_by)->toBe($admin->id)
        ->and($invitation->accepted_at)->toBeNull();

    Notification::assertSentTo($created, AccountInvitedNotification::class);
});

it('refuses an invitation when mail is switched off, rather than creating an unreachable account', function () {
    Notification::fake();

    // `mail.enabled` defaults false, which is production's state today.
    ['admin' => $admin] = clientAdministrator();

    $this->actingAs($admin, 'sanctum')->postJson('/api/v1/users', [
        'name' => 'Nobody Can Reach Me',
        'email' => 'unreachable@centenary-bank.test',
        'phone' => '+256700000302',
        'role' => 'corporate_employee',
        'invite' => true,
    ])->assertStatus(422)->assertJsonValidationErrors('invite');

    // The account must not exist. Creating it and failing to send is exactly
    // the state this suite's own docblock describes: an account nobody could
    // sign into, with every test passing.
    expect(User::query()->where('email', 'unreachable@centenary-bank.test')->exists())->toBeFalse();
});

it('still lets an administrator set an initial password instead', function () {
    Notification::fake();

    ['admin' => $admin] = clientAdministrator();

    $this->actingAs($admin, 'sanctum')->postJson('/api/v1/users', [
        'name' => 'Peter Ochieng',
        'email' => 'peter.ochieng@centenary-bank.test',
        'phone' => '+256700000303',
        'role' => 'corporate_employee',
        'password' => 'a-long-enough-password',
    ])->assertStatus(201);

    // No invitation, and the password works. The path that survives with mail
    // off is the reason both were kept.
    $created = User::query()->where('email', 'peter.ochieng@centenary-bank.test')->sole();

    expect(Invitation::query()->where('user_id', $created->id)->exists())->toBeFalse();

    $this->postJson('/api/v1/auth/login', [
        'email' => 'peter.ochieng@centenary-bank.test',
        'password' => 'a-long-enough-password',
    ])->assertOk();
});

it('refuses an account with neither a password nor an invitation', function () {
    ['admin' => $admin] = clientAdministrator();

    // The two paths are the only two. Without this, dropping `invite` from a
    // payload would create an account whose password is 32 random characters
    // nobody has and no link reaches — reachable by nobody, silently.
    $this->actingAs($admin, 'sanctum')->postJson('/api/v1/users', [
        'name' => 'No Way In',
        'email' => 'no-way-in@centenary-bank.test',
        'phone' => '+256700000304',
        'role' => 'corporate_employee',
    ])->assertStatus(422)->assertJsonValidationErrors('password');
});

/*
|--------------------------------------------------------------------------
| Hiring somebody who already has an account
|--------------------------------------------------------------------------
|
| The second time this platform met the same fact. A driver application mints
| an account at submission time (ADR-0055, amendment), so an address that was
| free yesterday has an account today — and every "add a person" door refused
| it with a bare uniqueness message. The fleet handover learned it on 25
| August; this door learned it on the 26th, when a fleet tried to hire one of
| its own driver applicants as an Operations Manager and was told only "the
| email has already been taken".
*/

/** Somebody who has applied to drive: an account keyed to nothing but that. */
function driverApplicantAccount(string $email = 'evelyn@applicant.test'): User
{
    $applicant = new User([
        'name' => 'Nambuya Evelyn',
        'email' => $email,
        'password' => 'set-when-they-applied',
        'phone' => '+256706881920',
        'role' => UserRole::DRIVER,
        'status' => UserStatus::ACTIVE,
    ]);

    $applicant->access_level = AccessLevel::APPLICANT;
    $applicant->save();

    return $applicant;
}

it('hires a driver applicant into a fleet without minting a second account', function () {
    Notification::fake();
    mailOn();

    $applicant = driverApplicantAccount();

    $owner = User::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'role' => UserRole::FLEET_OWNER,
    ]);

    $this->actingAs($owner, 'sanctum')->postJson('/api/v1/users', [
        'name' => 'Nambuya Evelyn',
        'email' => 'evelyn@applicant.test',
        'phone' => '+256706881920',
        'role' => UserRole::OPERATIONS_MANAGER->value,
        'invite' => true,
    ])->assertStatus(201);

    expect(User::query()->where('email', 'evelyn@applicant.test')->count())->toBe(1);

    $hired = $applicant->fresh();

    expect($hired->id)->toBe($applicant->id)
        ->and($hired->operator_id)->toBe(Operator::SHANITAH)
        ->and($hired->access_level)->toBe(AccessLevel::FLEET)
        ->and($hired->roleSlug())->toBe(UserRole::OPERATIONS_MANAGER->value);

    // They are invited, not handed a password somebody else chose.
    Notification::assertSentTo($hired, AccountInvitedNotification::class);
});

it('will not let an administrator set a password on an account that already exists', function () {
    Notification::fake();
    mailOn();

    driverApplicantAccount();

    $owner = User::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'role' => UserRole::FLEET_OWNER,
    ]);

    /*
     * The difference between this and the fleet handover, and it is the whole
     * reason attaching is gated on the invitation. There the token had gone to
     * the address and the holder chose their own password. Here a fleet office
     * is doing the adding, and an applicant's account holds their own driver
     * application — licence and ID among it. A password typed by somebody else
     * would be a way into that.
     */
    $this->actingAs($owner, 'sanctum')->postJson('/api/v1/users', [
        'name' => 'Nambuya Evelyn',
        'email' => 'evelyn@applicant.test',
        'phone' => '+256706881920',
        'role' => UserRole::OPERATIONS_MANAGER->value,
        'password' => 'chosen-by-somebody-else',
    ])->assertStatus(422)->assertJsonValidationErrors('email');
});

it("refuses to absorb another fleet's staff", function () {
    mailOn();

    $rival = Operator::create([
        'name' => 'Rival Transport Ltd',
        'slug' => 'rival-hiring-test',
        'status' => 'active',
    ]);

    $theirs = User::factory()->create([
        'operator_id' => $rival->id,
        'role' => UserRole::DISPATCHER,
        'email' => 'their.dispatcher@rival.test',
    ]);

    $owner = User::factory()->create([
        'operator_id' => Operator::SHANITAH,
        'role' => UserRole::FLEET_OWNER,
    ]);

    // ADR-0065 from the hiring side: absorbing a competitor's dispatcher would
    // move a person between organisations on one administrator's say-so.
    $this->actingAs($owner, 'sanctum')->postJson('/api/v1/users', [
        'name' => 'Poached',
        'email' => 'their.dispatcher@rival.test',
        'phone' => '+256700000777',
        'role' => UserRole::DISPATCHER->value,
        'invite' => true,
    ])->assertStatus(422)->assertJsonValidationErrors('email');

    expect($theirs->fresh()->operator_id)->toBe($rival->id);
});
