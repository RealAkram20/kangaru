<?php

use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\Notification as NotificationFacade;
use Modules\Bookings\Enums\BookingStatus;
use Modules\Bookings\Models\Booking;
use Modules\Bookings\Services\BookingService;
use Modules\Notifications\Channels\TenantDatabaseChannel;
use Modules\Notifications\Enums\NotificationType;
use Modules\Notifications\Models\Notification;
use Modules\Notifications\Models\NotificationImmutableException;
use Modules\Notifications\Notifications\BookingApprovedNotification;

/**
 * Modules/Notifications, pass one.
 *
 * Every notification asserted here is produced by putting a real booking
 * through BookingService, not by writing a `notifications` row. A row
 * inserted directly would prove the table exists; it would prove nothing
 * about whether approving a booking actually tells the person who asked.
 */

/**
 * A tenant, an approver, and a pending booking raised by an employee.
 *
 * @return array{tenant: Tenant, admin: User, employee: User, booking: Booking}
 */
function notificationFixture(): array
{
    $tenant = Tenant::factory()->create();
    app(TenantContext::class)->set($tenant->id);

    $admin = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_ADMIN]);
    $employee = User::factory()->create([
        'tenant_id' => $tenant->id,
        'role' => UserRole::CORPORATE_EMPLOYEE,
        'name' => 'Grace Amongin',
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

it('tells the person who raised a booking that it was approved', function () {
    ['admin' => $admin, 'employee' => $employee, 'booking' => $booking] = notificationFixture();

    app(BookingService::class)->approve($booking, $admin);

    $notification = Notification::query()->for($employee)->firstOrFail();

    expect($notification->type)->toBe(NotificationType::BOOKING_APPROVED);
    expect($notification->subject)->toBe("Booking #{$booking->id} approved");
    // The route is in the body, because a notification is read in a list
    // and the recipient may have several bookings open.
    expect($notification->body)->toContain('Kampala');
    expect($notification->body)->toContain('Entebbe');
    expect($notification->url)->toBe("/bookings/{$booking->id}");
    expect($notification->context['booking_id'])->toBe($booking->id);
    expect($notification->isRead())->toBeFalse();

    // The approver is not told. They just clicked the button.
    expect(Notification::query()->for($admin)->count())->toBe(0);
});

it('tells them why it was rejected', function () {
    ['admin' => $admin, 'employee' => $employee, 'booking' => $booking] = notificationFixture();

    app(BookingService::class)->reject($booking, $admin, 'No vehicle available on that date.');

    $notification = Notification::query()->for($employee)->firstOrFail();

    expect($notification->type)->toBe(NotificationType::BOOKING_REJECTED);
    // A refusal delivered without its reason is the message that generates
    // the phone call this module exists to prevent.
    expect($notification->body)->toContain('No vehicle available on that date.');
    expect($notification->context['reason'])->toBe('No vehicle available on that date.');
});

it('says nothing when a booking is cancelled', function () {
    ['employee' => $employee, 'booking' => $booking] = notificationFixture();

    // Usually the requester's own act. Telling somebody what they just did
    // is exactly the fatigue AGENTS.md warns against.
    app(BookingService::class)->cancel($booking, $employee, 'No longer travelling.');

    expect(Notification::query()->for($employee)->count())->toBe(0);
});

it('sends a booking decision by mail as well as filing it in the inbox', function () {
    NotificationFacade::fake();
    ['admin' => $admin, 'employee' => $employee, 'booking' => $booking] = notificationFixture();

    app(BookingService::class)->approve($booking, $admin);

    // Asserted on the notification's channels rather than with Mail::fake():
    // notification mail is rendered through the mailer as a MailMessage, not
    // as a Mailable, so Mail::assertSentCount never sees it and would report
    // zero against a message that was in fact sent.
    NotificationFacade::assertSentTo(
        $employee,
        BookingApprovedNotification::class,
        // Both channels, per config/notifications.php: the person who asked
        // for transport may not be looking at the platform.
        fn ($notification, array $channels) => in_array('mail', $channels, true)
            && in_array(TenantDatabaseChannel::class, $channels, true),
    );

    NotificationFacade::assertNotSentTo($admin, BookingApprovedNotification::class);
});

it('honours a configured channel list over the type default', function () {
    config()->set('notifications.channels.booking.approved', ['database']);

    ['admin' => $admin, 'employee' => $employee, 'booking' => $booking] = notificationFixture();

    app(BookingService::class)->approve($booking, $admin);

    // AGENTS.md Configuration Driven: which channel carries which message is
    // an operational decision, so turning mail off must not need a release.
    // Asserted through the real path — the in-app row still lands.
    expect(BookingApprovedNotification::for($booking)->via($employee))
        ->toBe([TenantDatabaseChannel::class]);
    expect(Notification::query()->for($employee)->count())->toBe(1);
});

it('can be turned off entirely by configuring no channels', function () {
    config()->set('notifications.channels.booking.approved', []);

    ['admin' => $admin, 'employee' => $employee, 'booking' => $booking] = notificationFixture();

    app(BookingService::class)->approve($booking, $admin);

    // An empty array is a meaningful answer, not a missing one: it silences
    // a notification without deleting the code that raises it. No row is the
    // proof — nothing ran at all.
    expect(Notification::query()->for($employee)->count())->toBe(0);
});

it('ignores a channel name it does not recognise rather than guessing', function () {
    // SMS is the live case: PROJECT.md lists it, no provider is configured,
    // and NotificationChannel has no case for it. A deployment that sets it
    // anyway must not have the notification silently vanish — the channels
    // it *does* recognise still run.
    config()->set('notifications.channels.booking.approved', ['sms', 'database']);

    ['admin' => $admin, 'employee' => $employee, 'booking' => $booking] = notificationFixture();

    app(BookingService::class)->approve($booking, $admin);

    expect(BookingApprovedNotification::for($booking)->via($employee))
        ->toBe([TenantDatabaseChannel::class]);
    expect(Notification::query()->for($employee)->count())->toBe(1);
});

it('serves a user their own inbox with an unread count', function () {
    ['admin' => $admin, 'employee' => $employee, 'booking' => $booking] = notificationFixture();

    app(BookingService::class)->approve($booking, $admin);

    $this->actingAs($employee, 'sanctum')
        ->getJson('/api/v1/notifications')
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.type', 'booking.approved')
        ->assertJsonPath('data.0.is_read', false)
        // Beside the list, not behind a second endpoint — a bell shows a
        // count and a panel shows the list, and that is one round trip.
        ->assertJsonPath('meta.unread', 1);
});

it('marks one read, and marking it again does not move the timestamp', function () {
    ['admin' => $admin, 'employee' => $employee, 'booking' => $booking] = notificationFixture();

    app(BookingService::class)->approve($booking, $admin);
    $notification = Notification::query()->for($employee)->firstOrFail();

    $this->actingAs($employee, 'sanctum')
        ->patchJson("/api/v1/notifications/{$notification->id}")
        ->assertOk()
        ->assertJsonPath('data.is_read', true);

    $firstSeen = $notification->refresh()->read_at;

    $this->travel(5)->minutes();
    $this->actingAs($employee, 'sanctum')->patchJson("/api/v1/notifications/{$notification->id}")->assertOk();

    // The useful fact is when it was *first* seen. A client re-sending on
    // every render would otherwise keep pushing it forward.
    expect($notification->refresh()->read_at->timestamp)->toBe($firstSeen->timestamp);
});

it('clears the whole badge in one call', function () {
    ['admin' => $admin, 'employee' => $employee] = notificationFixture();

    foreach (range(1, 3) as $i) {
        $booking = app(BookingService::class)->create([
            'tenant_id' => $employee->tenant_id,
            'passenger_name' => 'Grace Amongin',
            'passenger_phone' => '+256700000000',
            'passenger_count' => 1,
            'origin' => "Origin {$i}",
            'destination' => 'Entebbe',
        ], $employee);

        app(BookingService::class)->approve($booking, $admin);
    }

    $this->actingAs($employee, 'sanctum')
        ->patchJson('/api/v1/notifications')
        ->assertOk()
        ->assertJsonPath('data.marked', 3);

    expect(Notification::query()->for($employee)->unread()->count())->toBe(0);
});

it('never shows one colleague another colleague\'s inbox', function () {
    ['tenant' => $tenant, 'admin' => $admin, 'employee' => $employee, 'booking' => $booking] = notificationFixture();

    app(BookingService::class)->approve($booking, $admin);
    $theirs = Notification::query()->for($employee)->firstOrFail();

    // Same tenant, and an admin at that. An inbox is addressed to one
    // person; no role reads someone else's, so this is a 404 rather than a
    // 403 — a 403 would confirm the notification exists.
    $colleague = User::factory()->create(['tenant_id' => $tenant->id, 'role' => UserRole::CORPORATE_ADMIN]);

    $this->actingAs($colleague, 'sanctum')
        ->getJson('/api/v1/notifications')
        ->assertOk()
        ->assertJsonCount(0, 'data')
        ->assertJsonPath('meta.unread', 0);

    $this->actingAs($colleague, 'sanctum')
        ->patchJson("/api/v1/notifications/{$theirs->id}")
        ->assertStatus(404);

    expect($theirs->refresh()->isRead())->toBeFalse();
});

it('never delivers one tenant\'s notification into another tenant', function () {
    ['tenant' => $tenantA, 'employee' => $employeeA, 'admin' => $adminA, 'booking' => $bookingA] = notificationFixture();
    ['employee' => $employeeB] = notificationFixture();

    // Building the second tenant rebound TenantContext to it, and
    // TenantScope fails closed — so approving tenant A's booking now would
    // not find it at all. Services called outside HTTP bind the tenant by
    // hand; this is that, and forgetting it is how a test passes vacuously.
    app(TenantContext::class)->set($tenantA->id);

    app(BookingService::class)->approve($bookingA, $adminA);

    // ADR-0001's mandatory isolation proof for this module. The row is
    // filed from the recipient's own tenant_id rather than from whatever
    // TenantContext a queue worker last left bound, which is the specific
    // way this could have gone wrong.
    $filed = Notification::query()->allTenants()->get();

    expect($filed)->toHaveCount(1);
    expect($filed->first()->tenant_id)->toBe($employeeA->tenant_id);
    expect($filed->first()->user_id)->toBe($employeeA->id);

    $this->actingAs($employeeB, 'sanctum')
        ->getJson('/api/v1/notifications')
        ->assertOk()
        ->assertJsonCount(0, 'data')
        ->assertJsonPath('meta.unread', 0);
});

it('files a notification under the recipient\'s tenant, not whatever the worker had bound', function () {
    ['tenant' => $tenantA, 'employee' => $employeeA, 'booking' => $bookingA] = notificationFixture();
    ['tenant' => $tenantB] = notificationFixture();

    // The scenario the channel actually has to survive. Notifications are
    // queued, and a queue worker never passes through IdentifyTenant — so
    // the ambient tenant when one is delivered is whatever the previous job
    // happened to leave bound. Here that is deliberately the wrong one.
    //
    // The isolation test above cannot catch this: it binds tenant A before
    // approving, so TenantContext and the recipient agree and the row lands
    // correctly either way. This one makes them disagree, which is the only
    // way to find out which of the two the channel actually reads.
    app(TenantContext::class)->set($tenantB->id);

    NotificationFacade::send($employeeA, BookingApprovedNotification::for($bookingA));

    $row = Notification::query()->allTenants()->firstOrFail();

    expect($row->tenant_id)->toBe($tenantA->id);
    expect($row->tenant_id)->not->toBe($tenantB->id);
    expect($row->user_id)->toBe($employeeA->id);
});

it('refuses to rewrite what somebody was already told', function () {
    ['admin' => $admin, 'employee' => $employee, 'booking' => $booking] = notificationFixture();

    app(BookingService::class)->approve($booking, $admin);
    $notification = Notification::query()->for($employee)->firstOrFail();

    // A notification records what someone was told. Re-rendering it later
    // against changed data would rewrite history — a booking rejected for
    // one reason would appear to have been rejected for another.
    $notification->body = 'Something else entirely.';

    expect(fn () => $notification->save())->toThrow(NotificationImmutableException::class);

    // Read state is the one thing that may change, and it still can.
    $notification->refresh()->markRead();
    expect($notification->refresh()->isRead())->toBeTrue();
});

it('rejects a filter the inbox does not accept', function () {
    ['employee' => $employee] = notificationFixture();

    $this->actingAs($employee, 'sanctum')
        ->getJson('/api/v1/notifications?user_id=1')
        ->assertStatus(422)
        ->assertJsonValidationErrors('user_id');
});

it('filters to unread only', function () {
    ['admin' => $admin, 'employee' => $employee, 'booking' => $booking] = notificationFixture();

    app(BookingService::class)->approve($booking, $admin);
    Notification::query()->for($employee)->firstOrFail()->markRead();

    $this->actingAs($employee, 'sanctum')
        ->getJson('/api/v1/notifications?unread=1')
        ->assertOk()
        ->assertJsonCount(0, 'data');

    $this->actingAs($employee, 'sanctum')
        ->getJson('/api/v1/notifications')
        ->assertOk()
        ->assertJsonCount(1, 'data');
});

it('requires authentication', function () {
    $this->getJson('/api/v1/notifications')->assertUnauthorized();
});

it('does not announce a decision that was rolled back', function () {
    ['admin' => $admin, 'employee' => $employee, 'booking' => $booking] = notificationFixture();

    // Approving something already approved throws inside the transaction.
    // The event is dispatched after the commit, so nothing is announced —
    // a notification cannot be unsent, which is why it is not raised from
    // inside the transaction that might still roll back.
    app(BookingService::class)->approve($booking, $admin);
    Notification::query()->for($employee)->delete();

    expect(fn () => app(BookingService::class)->approve($booking->refresh(), $admin))->toThrow(Exception::class);

    expect(Notification::query()->for($employee)->count())->toBe(0);
    expect($booking->refresh()->status)->toBe(BookingStatus::APPROVED);
});
