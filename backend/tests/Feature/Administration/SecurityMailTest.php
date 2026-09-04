<?php

use App\Enums\AccessLevel;
use App\Enums\Permission;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Operator;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\Mail;
use Modules\Administration\Services\AuthService;
use Modules\Administration\Services\SettingsService;
use Modules\Administration\Services\UserAdminService;
use Modules\Bookings\Services\BookingService;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Models\MailDelivery;
use Modules\Notifications\Models\MailToggle;

/**
 * M3, the security family.
 *
 * Every assertion here goes through the service that actually performs the
 * act, never through the notification. The whole failure this package exists
 * to prevent is a warning that is written and never wired: `recoveryCodesAreLow()`
 * shipped with ADR-0010 and had **nothing consulting it** until this package,
 * so a user learned their code count by running out.
 *
 * Testing the notification class would have passed the entire time.
 */
function securityMailOn(): void
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

function deliveriesOfType(NotificationType $type): int
{
    return MailDelivery::query()->where('type', $type->value)->count();
}

it('warns the account holder when a password is changed', function () {
    securityMailOn();
    Mail::fake();

    $user = User::factory()->create(['email' => 'ada@centenary.test']);

    app(AuthService::class)->changePassword($user, 'a-brand-new-password-9');

    $delivery = MailDelivery::query()
        ->where('type', NotificationType::ACCOUNT_PASSWORD_CHANGED->value)
        ->firstOrFail();

    expect($delivery->recipient)->toBe('ada@centenary.test')
        ->and($delivery->status)->toBe(MailDelivery::SENT);
});

it('sends the address-change warning to the old address as well as the new one', function () {
    securityMailOn();
    Mail::fake();

    $actor = User::factory()->create(['role' => UserRole::SUPER_ADMIN]);
    $subject = User::factory()->create(['email' => 'old@centenary.test']);

    app(UserAdminService::class)->update($subject, ['email' => 'new@centenary.test'], $actor);

    $recipients = MailDelivery::query()
        ->where('type', NotificationType::ACCOUNT_EMAIL_CHANGED->value)
        ->pluck('recipient')
        ->sort()
        ->values()
        ->all();

    /*
     * The copy to the OLD address is the one that matters, and it is the one
     * that is easy to lose. Somebody who has taken an account and changed its
     * address has redirected every future warning to themselves; this is the
     * last message the real owner will ever receive about the account.
     */
    expect($recipients)->toBe(['new@centenary.test', 'old@centenary.test']);
});

it('warns on suspension and on being turned back on', function () {
    securityMailOn();
    Mail::fake();

    $actor = User::factory()->create(['role' => UserRole::SUPER_ADMIN]);
    $subject = User::factory()->create(['status' => UserStatus::ACTIVE]);

    app(UserAdminService::class)->update($subject, ['status' => UserStatus::SUSPENDED], $actor);
    app(UserAdminService::class)->update($subject->fresh(), ['status' => UserStatus::ACTIVE], $actor);

    expect(deliveriesOfType(NotificationType::ACCOUNT_SUSPENDED))->toBe(1)
        ->and(deliveriesOfType(NotificationType::ACCOUNT_REACTIVATED))->toBe(1);
});

it('says nothing when an update changes neither the status nor the address', function () {
    securityMailOn();
    Mail::fake();

    $actor = User::factory()->create(['role' => UserRole::SUPER_ADMIN]);
    $subject = User::factory()->create(['name' => 'Ada Nakato']);

    app(UserAdminService::class)->update($subject, ['name' => 'Ada N. Nakato'], $actor);

    // Renaming somebody is not a security event, and an email that fires on
    // every edit is an email nobody reads on the day it matters.
    expect(MailDelivery::query()->count())->toBe(0);
});

it('warns on a sign in from a browser the account has not used before', function () {
    securityMailOn();
    Mail::fake();

    $user = User::factory()->create([
        'email' => 'ada@centenary.test',
        'password' => 'a-known-password-9',
        'role' => UserRole::DISPATCHER,
    ]);

    $credentials = ['email' => 'ada@centenary.test', 'password' => 'a-known-password-9'];

    // First sign-in is recorded silently. Every account's first device is by
    // definition unseen, so warning on it would make a security alert about
    // themselves the first thing every new user receives.
    $this->withHeader('User-Agent', 'Chrome/140 on Windows')
        ->postJson('/api/v1/auth/login', $credentials)->assertOk();

    expect(deliveriesOfType(NotificationType::ACCOUNT_SIGNED_IN_NEW_DEVICE))->toBe(0);

    // The same browser again is not news.
    $this->withHeader('User-Agent', 'Chrome/140 on Windows')
        ->postJson('/api/v1/auth/login', $credentials)->assertOk();

    expect(deliveriesOfType(NotificationType::ACCOUNT_SIGNED_IN_NEW_DEVICE))->toBe(0);

    // A different one is.
    $this->withHeader('User-Agent', 'Firefox/141 on Android')
        ->postJson('/api/v1/auth/login', $credentials)->assertOk();

    expect(deliveriesOfType(NotificationType::ACCOUNT_SIGNED_IN_NEW_DEVICE))->toBe(1);
});

it('does not treat a changed IP address as a new device', function () {
    securityMailOn();
    Mail::fake();

    $user = User::factory()->create([
        'email' => 'driver@shanitah.test',
        'password' => 'a-known-password-9',
        'role' => UserRole::DISPATCHER,
    ]);

    $credentials = ['email' => 'driver@shanitah.test', 'password' => 'a-known-password-9'];

    $this->withHeader('User-Agent', 'KangaruDriver/1.0 Android')
        ->withServerVariables(['REMOTE_ADDR' => '102.86.7.251'])
        ->postJson('/api/v1/auth/login', $credentials)->assertOk();

    $this->withHeader('User-Agent', 'KangaruDriver/1.0 Android')
        ->withServerVariables(['REMOTE_ADDR' => '41.210.180.9'])
        ->postJson('/api/v1/auth/login', $credentials)->assertOk();

    /*
     * This is the assertion that makes the feature usable in Uganda rather
     * than merely correct. A driver upcountry gets a different mobile address
     * several times a day; keying on it would email them every morning, and a
     * warning that arrives daily is one nobody reads on the day it matters.
     */
    expect(deliveriesOfType(NotificationType::ACCOUNT_SIGNED_IN_NEW_DEVICE))->toBe(0);
});

it('lets a system administrator switch an optional email off for everybody', function () {
    securityMailOn();
    Mail::fake();

    // Head office, explicitly. `User::factory()` gives a tenant, which makes
    // the account CLIENT level: it would hold `settings.manage` and still be
    // refused, which is the guard working and not what these tests are about.
    $admin = User::factory()->create([
        'tenant_id' => null,
        'operator_id' => null,
        'access_level' => AccessLevel::KANGARU,
        'role' => UserRole::SUPER_ADMIN,
    ]);

    $this->actingAs($admin, 'sanctum')
        ->putJson('/api/v1/settings/email', [
            'type' => NotificationType::BOOKING_APPROVED->value,
            'enabled' => false,
        ])
        ->assertOk();

    expect(MailToggle::allows(NotificationType::BOOKING_APPROVED))->toBeFalse();
});

it('refuses to switch off an email that is the only warning somebody gets', function () {
    // Head office, explicitly. `User::factory()` gives a tenant, which makes
    // the account CLIENT level: it would hold `settings.manage` and still be
    // refused, which is the guard working and not what these tests are about.
    $admin = User::factory()->create([
        'tenant_id' => null,
        'operator_id' => null,
        'access_level' => AccessLevel::KANGARU,
        'role' => UserRole::SUPER_ADMIN,
    ]);

    $this->actingAs($admin, 'sanctum')
        ->putJson('/api/v1/settings/email', [
            'type' => NotificationType::ACCOUNT_PASSWORD_CHANGED->value,
            'enabled' => false,
        ])
        ->assertStatus(422);

    // Refused rather than accepted and ignored. A switch the platform stores
    // and then overrides reads back to the administrator as an answer.
    expect(MailToggle::allows(NotificationType::ACCOUNT_PASSWORD_CHANGED))->toBeTrue();
});

it('keeps the email menu away from everybody but a system administrator', function () {
    $dispatcher = User::factory()->create(['role' => UserRole::DISPATCHER]);

    $this->actingAs($dispatcher, 'sanctum')->getJson('/api/v1/settings/email')->assertForbidden();
    $this->actingAs($dispatcher, 'sanctum')
        ->putJson('/api/v1/settings/email', [
            'type' => NotificationType::BOOKING_APPROVED->value,
            'enabled' => false,
        ])
        ->assertForbidden();
});

it('refuses a fleet Super Admin, who holds the permission and must not hold this switch', function () {
    /*
     * The catch this test exists for. `settings.manage` was the obvious gate
     * and it is not enough: every Super Admin holds it, a fleet's own
     * included, because `StoreRoleRequest` will not let anybody grant a
     * permission they do not hold.
     *
     * It matters more here than for the settings beside it. A fleet editing an
     * SMTP setting writes its own override beside Kangaru's default (ADR-0055
     * §5), so the blast radius is their own fleet. `mail_toggles` has no
     * `operator_id`: one row per type, for the whole platform. A fleet Super
     * Admin flipping a switch here would silence that email for every other
     * fleet and every client on it.
     */
    $operator = Operator::create([
        'name' => 'Second Fleet Ltd',
        'slug' => 'second-fleet-toggle-test',
        'status' => 'active',
    ]);

    $fleetAdmin = User::factory()->create([
        'tenant_id' => null,
        'operator_id' => $operator->id,
        'access_level' => AccessLevel::FLEET,
        'role' => UserRole::SUPER_ADMIN,
    ]);

    expect($fleetAdmin->hasPermission(Permission::SETTINGS_MANAGE))->toBeTrue();

    $this->actingAs($fleetAdmin, 'sanctum')->getJson('/api/v1/settings/email')->assertForbidden();
    $this->actingAs($fleetAdmin, 'sanctum')
        ->putJson('/api/v1/settings/email', [
            'type' => NotificationType::BOOKING_APPROVED->value,
            'enabled' => false,
        ])
        ->assertForbidden();

    expect(MailToggle::allows(NotificationType::BOOKING_APPROVED))->toBeTrue();
});

it('stops sending a type the platform has switched off', function () {
    securityMailOn();
    Mail::fake();

    MailToggle::disable(NotificationType::BOOKING_APPROVED);

    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $admin = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_ADMIN]);
    $employee = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_EMPLOYEE]);

    $booking = app(BookingService::class)->create([
        'tenant_id' => $tenant->id,
        'passenger_name' => 'Grace Amongin',
        'passenger_phone' => '+256700000000',
        'passenger_count' => 1,
        'origin' => 'Kampala',
        'destination' => 'Entebbe',
    ], $employee);

    // Through the real service, so this proves the platform switch reaches the
    // send path rather than proving a notification can be constructed.
    app(BookingService::class)->approve($booking, $admin);

    expect(deliveriesOfType(NotificationType::BOOKING_APPROVED))->toBe(0);
});

it('lists every mailable type with whether it can be switched at all', function () {
    // Head office, explicitly. `User::factory()` gives a tenant, which makes
    // the account CLIENT level: it would hold `settings.manage` and still be
    // refused, which is the guard working and not what these tests are about.
    $admin = User::factory()->create([
        'tenant_id' => null,
        'operator_id' => null,
        'access_level' => AccessLevel::KANGARU,
        'role' => UserRole::SUPER_ADMIN,
    ]);

    $rows = $this->actingAs($admin, 'sanctum')
        ->getJson('/api/v1/settings/email')
        ->assertOk()
        ->json('data');

    $byType = collect($rows)->keyBy('type');

    // Required types are listed and locked, never hidden. An administrator
    // hunting for "why did nobody get the password reset email" needs to find
    // it and see that it cannot be switched off.
    expect($byType[NotificationType::ACCOUNT_PASSWORD_CHANGED->value]['required'])->toBeTrue()
        ->and($byType[NotificationType::BOOKING_APPROVED->value]['required'])->toBeFalse()
        // Push-only types have no email to switch, so a row for one would be a
        // control that does nothing.
        ->and($byType->has(NotificationType::TRIP_OFFERED->value))->toBeFalse();
});
