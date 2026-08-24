<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Notification;
use Modules\Administration\Models\Invitation;
use Modules\Administration\Services\SettingsService;
use Modules\Bookings\Models\Booking;
use Modules\Bookings\Services\BookingService;
use Modules\Notifications\Channels\SettingsMailChannel;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Models\MailDelivery;
use Modules\Notifications\Models\MailDeliveryImmutableException;
use Modules\Notifications\Models\MailPreference;
use Modules\Notifications\Notifications\AccountInvitedNotification;

/**
 * M0, the one mail path.
 *
 * Every email asserted here is produced by putting a real booking through
 * `BookingService`, the same way `NotificationTest` does, and for the same
 * reason: dispatching a notification by hand would prove the channel can be
 * called. It would prove nothing about whether approving a booking actually
 * emails the person who asked, which is the thing that was broken.
 *
 * **What was broken, so nobody restores it.** `NotificationChannel::MAIL`
 * resolved to the string `mail`, which is `MAIL_MAILER`, which is `log`.
 * These emails were written to `storage/logs/laravel.log` for the whole life
 * of the feature while the password reset sent real mail from settings. The
 * assertion that matters most in this file is not that mail is sent. It is
 * that it is sent **through the settings mailer**, because a green test send
 * in the settings screen has to vouch for this path.
 */

/**
 * Mail switched on, with settings a real deployment would have.
 *
 * `Mail::fake()` afterwards, which intercepts `Mail::build()` too, so
 * `smtpMailer()` hands back a fake transport while still being the code under
 * test. Faking the *transport* rather than the channel is what keeps this an
 * end-to-end assertion.
 */
function configureMail(): void
{
    app(SettingsService::class)->setGroup('mail', [
        'enabled' => true,
        'host' => 'smtp.example.test',
        'port' => 587,
        'username' => 'postmaster',
        'password' => 'secret',
        'encryption' => 'tls',
        'from_address' => 'operations@kangaruride.test',
        'from_name' => 'KangaruRide',
    ]);
}

/**
 * @return array{tenant: Tenant, admin: User, employee: User, booking: Booking}
 */
function mailFixture(): array
{
    $tenant = Tenant::factory()->create(['name' => 'Nakumatt Ltd']);
    app(TenantContext::class)->set($tenant->id);

    $admin = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_ADMIN]);
    $employee = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
        'name' => 'Grace Amongin',
        'email' => 'grace@nakumatt.test',
    ]);

    $booking = app(BookingService::class)->create([
        'tenant_id' => $tenant->id,
        'passenger_name' => 'Grace Amongin',
        'passenger_phone' => '+256700000000',
        'passenger_count' => 1,
        'origin' => 'Kampala',
        'destination' => 'Entebbe',
    ], $employee);

    return compact('tenant', 'admin', 'employee', 'booking');
}

it('sends a booking decision email through the settings mailer', function () {
    configureMail();
    Mail::fake();

    ['admin' => $admin, 'employee' => $employee, 'booking' => $booking] = mailFixture();

    app(BookingService::class)->approve($booking, $admin);

    $delivery = MailDelivery::query()->where('recipient', 'grace@nakumatt.test')->firstOrFail();

    expect($delivery->type)->toBe(NotificationType::BOOKING_APPROVED->value)
        ->and($delivery->status)->toBe(MailDelivery::SENT)
        ->and($delivery->sent_at)->not->toBeNull()
        // Taken from the recipient, not from whatever tenant happened to be
        // bound. See the channel's note on queue workers.
        ->and($delivery->tenant_id)->toBe($employee->tenant_id)
        ->and($delivery->error)->toBeNull();
});

it('writes no delivery row and raises nothing when mail is not configured', function () {
    // Deliberately not calling configureMail(). This is the platform's
    // default state and it is the state the dev database is in today.
    Mail::fake();

    ['admin' => $admin, 'booking' => $booking] = mailFixture();

    app(BookingService::class)->approve($booking, $admin);

    // The point is that approving still worked. A booking decision must never
    // fail because email is switched off.
    expect($booking->fresh()->status->value)->toBe('approved')
        ->and(MailDelivery::query()->count())->toBe(0);
});

it('respects a recipient who switched an optional email off', function () {
    configureMail();
    Mail::fake();

    ['admin' => $admin, 'employee' => $employee, 'booking' => $booking] = mailFixture();

    MailPreference::create([
        'user_id' => $employee->id,
        'type' => NotificationType::BOOKING_APPROVED->value,
    ]);

    app(BookingService::class)->approve($booking, $admin);

    expect(MailDelivery::query()->count())->toBe(0);
});

it('ignores a preference against an email nobody may switch off', function () {
    // BOOKING_REJECTED is required: an approval is confirmed again by the car
    // arriving, a refusal is confirmed by nothing.
    configureMail();
    Mail::fake();

    ['admin' => $admin, 'employee' => $employee, 'booking' => $booking] = mailFixture();

    MailPreference::create([
        'user_id' => $employee->id,
        'type' => NotificationType::BOOKING_REJECTED->value,
    ]);

    app(BookingService::class)->reject($booking, $admin, 'No vehicle available.');

    expect(MailDelivery::query()->where('type', NotificationType::BOOKING_REJECTED->value)->count())->toBe(1);
});

it('records the transport error rather than losing it', function () {
    configureMail();

    // A transport that refuses, which is what a wrong password, a blocked
    // port or a rejected from-address all look like from in here.
    Mail::shouldReceive('build')->andThrow(new RuntimeException('535 Authentication failed'));

    ['admin' => $admin, 'booking' => $booking] = mailFixture();

    try {
        app(BookingService::class)->approve($booking, $admin);
    } catch (Throwable) {
        // Rethrown on purpose so the queue retries. Not the assertion.
    }

    $delivery = MailDelivery::query()->firstOrFail();

    expect($delivery->status)->toBe(MailDelivery::FAILED)
        ->and($delivery->error)->toContain('535 Authentication failed');
});

it('reaches somebody who has no account, which is how an applicant is told anything', function () {
    configureMail();
    Mail::fake();

    /*
     * The regression this pins, and it shipped for a while before anybody
     * noticed.
     *
     * An applicant has no `User` until they are approved, so
     * `ApplicationDocumentReviewController` reaches them with
     * `Notification::route('mail', $email)`, which produces an
     * `AnonymousNotifiable`. The first version of `SettingsMailChannel`
     * returned early for anything that was not a `User`, which silently
     * dropped every email to the one population that has **no other way of
     * hearing anything**: no inbox to check, no app to open, only the address
     * they typed on the form.
     *
     * Every test in the suite passed, because they all notified accounts.
     */
    Notification::route('mail', 'applicant@example.test')->notify(
        new AccountInvitedNotification(
            Invitation::query()->create([
                'user_id' => User::factory()->create()->id,
                'token_hash' => hash('sha256', 'anonymous-recipient-token'),
                'expires_at' => now()->addDays(7),
            ]),
            'anonymous-recipient-token',
        ),
    );

    $delivery = MailDelivery::query()->where('recipient', 'applicant@example.test')->firstOrFail();

    expect($delivery->status)->toBe(MailDelivery::SENT)
        // Null all three, and correctly: somebody with no account belongs to
        // no tenant and no fleet, and stamping one would make the cross-fleet
        // audit query answer wrongly.
        ->and($delivery->user_id)->toBeNull()
        ->and($delivery->tenant_id)->toBeNull()
        ->and($delivery->operator_id)->toBeNull();
});

it('refuses to rewrite a closed delivery row', function () {
    $delivery = MailDelivery::create([
        'recipient' => 'grace@nakumatt.test',
        'type' => NotificationType::BOOKING_APPROVED->value,
        'subject' => 'Booking approved',
        'status' => MailDelivery::SENT,
        'sent_at' => now(),
    ]);

    expect(fn () => $delivery->update(['status' => MailDelivery::FAILED]))
        ->toThrow(MailDeliveryImmutableException::class);
});

it('refuses to delete a delivery row', function () {
    $delivery = MailDelivery::create([
        'recipient' => 'grace@nakumatt.test',
        'type' => NotificationType::BOOKING_APPROVED->value,
        'subject' => 'Booking approved',
    ]);

    expect(fn () => $delivery->delete())->toThrow(MailDeliveryImmutableException::class);
});

it('lowercases the address so support can find it', function () {
    $delivery = MailDelivery::create([
        'recipient' => '  Grace@Nakumatt.TEST ',
        'type' => NotificationType::BOOKING_APPROVED->value,
        'subject' => 'Booking approved',
    ]);

    expect($delivery->recipient)->toBe('grace@nakumatt.test');
});

/**
 * The outage alarm, and why it is pinned two ways.
 *
 * kangaru-aa's mutation result is the reason for the pairing: they moved
 * `PasswordPolicy::MINIMUM_LENGTH` from 6 to 8 and **every boundary test
 * stayed green**, because each derived from the constant and followed it
 * anywhere. Only one literal assertion caught the move.
 *
 * So the two do different jobs and neither is redundant:
 *
 * - the boundary test below catches the **alarm drifting away from the
 *   constant** — firing at two, or not firing at three;
 * - the literal one catches **the constant itself moving without a decision**,
 *   which is exactly how an alarm gets quietly turned into a nag or into
 *   silence.
 */
function failedDeliveries(int $count): void
{
    for ($i = 0; $i < $count; $i++) {
        MailDelivery::create([
            'recipient' => "failure{$i}@nakumatt.test",
            'type' => NotificationType::BOOKING_APPROVED->value,
            'subject' => 'Booking approved',
            'status' => MailDelivery::FAILED,
        ]);
    }
}

it('says nothing after two failures, because two is two bad addresses', function () {
    configureMail();
    Mail::shouldReceive('build')->andThrow(new RuntimeException('535 Authentication failed'));
    Log::spy();

    failedDeliveries(1);

    ['admin' => $admin, 'booking' => $booking] = mailFixture();

    try {
        app(BookingService::class)->approve($booking, $admin);
    } catch (Throwable) {
        // Rethrown so the queue retries. Not the assertion.
    }

    // Two failures total. Alerting here would train everybody to ignore the
    // alert, which is how the real outage goes unnoticed.
    Log::shouldNotHaveReceived('error', ['mail.transport_down', Mockery::any()]);
});

it('says the transport is down on the third failure in a row', function () {
    configureMail();
    Mail::shouldReceive('build')->andThrow(new RuntimeException('535 Authentication failed'));
    Log::spy();

    failedDeliveries(2);

    ['admin' => $admin, 'booking' => $booking] = mailFixture();

    try {
        app(BookingService::class)->approve($booking, $admin);
    } catch (Throwable) {
    }

    /*
     * `MailDelivery::consecutiveFailures()` shipped in M0 with a docblock
     * explaining what it was for and **nothing calling it** — the same shape
     * as `recoveryCodesAreLow()` before M3. This is the test that proves it is
     * consulted rather than merely defined.
     */
    Log::shouldHaveReceived('error')
        ->withArgs(fn (string $message, array $context) => $message === 'mail.transport_down'
            && $context['consecutive_failures'] >= 3);
});

it('a success between failures resets the run, so a bad address is not an outage', function () {
    configureMail();
    Mail::shouldReceive('build')->andThrow(new RuntimeException('535 Authentication failed'));
    Log::spy();

    failedDeliveries(2);

    // One success on top, which is what an outage cannot produce.
    MailDelivery::create([
        'recipient' => 'ok@nakumatt.test',
        'type' => NotificationType::BOOKING_APPROVED->value,
        'subject' => 'Booking approved',
        'status' => MailDelivery::SENT,
    ]);

    ['admin' => $admin, 'booking' => $booking] = mailFixture();

    try {
        app(BookingService::class)->approve($booking, $admin);
    } catch (Throwable) {
    }

    Log::shouldNotHaveReceived('error', ['mail.transport_down', Mockery::any()]);
});

it('alerts at three, and the three is written down here on purpose', function () {
    /*
     * The literal, and it is the half kangaru-aa proved you cannot do without.
     * Every assertion above derives from the behaviour and would follow the
     * constant anywhere: move it to 10 and they all stay green while the
     * platform silently stops warning about an outage until the tenth failure.
     *
     * This line does not follow. Changing the threshold has to be a decision
     * somebody takes here, with a reason.
     */
    $threshold = new ReflectionClassConstant(
        SettingsMailChannel::class,
        'OUTAGE_THRESHOLD',
    );

    expect($threshold->getValue())->toBe(3);
});

it('counts only an unbroken run of failures at the tail', function () {
    foreach ([MailDelivery::FAILED, MailDelivery::SENT, MailDelivery::FAILED, MailDelivery::FAILED] as $i => $status) {
        MailDelivery::create([
            'recipient' => "person{$i}@nakumatt.test",
            'type' => NotificationType::BOOKING_APPROVED->value,
            'subject' => 'Booking approved',
            'status' => $status,
        ]);
    }

    // The two most recent failed, then a success. Three would mean an outage;
    // two means two bad addresses, and alerting on that trains everybody to
    // ignore the alert.
    expect(MailDelivery::consecutiveFailures())->toBe(2);
});
