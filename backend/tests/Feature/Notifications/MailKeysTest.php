<?php

use Modules\Notifications\Enums\NotificationChannel;
use Modules\Notifications\Enums\NotificationType;

/**
 * Every email this platform can send has copy behind it.
 *
 * ## Why this file exists
 *
 * The parameterised families (`SecurityEventNotification`,
 * `DriverEventNotification`, `ClientEventNotification`,
 * `OfficeEventNotification`) build their translation keys from the enum
 * *value*: `platform.fleet.no_account` becomes
 * `mail.office.platform_fleet_no_account.subject`.
 *
 * That is what makes adding a notification one line instead of a class, and it
 * is also a silent failure waiting to happen. Laravel's `__()` returns the key
 * itself when nothing matches, so a mistyped or renamed key does not throw —
 * **it renders `mail.office.platform_fleet_has_no_account.subject` into
 * somebody's subject line** and every test still passes.
 *
 * That is not hypothetical. It happened while M6 was being written: the enum
 * said `no_account`, the lang file said `has_no_account`, and the only reason
 * it was caught was a test that happened to assert on the rendered subject.
 * This file makes that catch systematic instead of lucky.
 *
 * ## It walks the enum, not a list
 *
 * A hand-maintained list of types would need updating alongside the enum,
 * which is the same drift one layer up.
 */

/**
 * Which lang namespace a type's copy lives under, or null when the type has a
 * notification class of its own that holds its own sentences.
 */
function familyOf(NotificationType $type): ?string
{
    /*
     * Types with a notification class of their own, whose sentences live in
     * PHP rather than in `lang/en/mail.php`.
     *
     * Named explicitly rather than pattern-matched, because the patterns lie:
     * `driver_application.document.rejected` looks exactly like the
     * parameterised driver family and is not one. That false positive is what
     * this list is for, and it is short and stable enough to maintain by hand.
     *
     * They are excluded rather than checked because their copy is not addressed
     * by key at all — `ApplicationDocumentRejectedNotification` composes its
     * own sentences, including the office's rejection reason. Migrating those
     * into the lang file is a separate pass (mail plan §5) and is deliberately
     * not part of M6: rewriting other agents' copy is the collision the
     * worklog exists to prevent.
     */
    $bespoke = [
        NotificationType::BOOKING_APPROVED,
        NotificationType::BOOKING_REJECTED,
        NotificationType::REPORT_EXPORT_READY,
        NotificationType::TRIP_ASSIGNED,
        NotificationType::TRIP_DRIVER_ARRIVED,
        NotificationType::TRIP_COMPLETED,
        NotificationType::ORDER_REQUEST_RECEIVED,
        NotificationType::TRIP_OFFERED,
        NotificationType::TRIP_OFFER_WITHDRAWN,
        NotificationType::DRIVER_CLOSURE_ANSWERED,
        NotificationType::DRIVER_SUPPORT_ANSWERED,
        NotificationType::DRIVER_DOCUMENT_REVIEWED,
        NotificationType::DRIVER_APPLICATION_DOCUMENT_REJECTED,
        NotificationType::ACCOUNT_ACCESSED_BY_SUPPORT,
        NotificationType::ACCOUNT_INVITED,
        NotificationType::ACCOUNT_INVITATION_EXPIRING,
    ];

    if (in_array($type, $bespoke, true)) {
        return null;
    }

    return match (true) {
        str_starts_with($type->value, 'client.') => 'client',
        str_starts_with($type->value, 'fleet.'), str_starts_with($type->value, 'platform.') => 'office',
        str_starts_with($type->value, 'driver_application.'),
        str_starts_with($type->value, 'driver.document.expir'),
        str_starts_with($type->value, 'driver.settlement.'),
        str_starts_with($type->value, 'driver.walk_in_contract.'),
        str_starts_with($type->value, 'driver.weekly_bonus.') => 'driver',
        str_starts_with($type->value, 'account.'),
        $type === NotificationType::DRIVER_PAYOUT_ACCOUNT_CHANGED => 'security',
        default => null,
    };
}

it('has subject, heading and body copy for every parameterised email', function () {
    $missing = [];

    foreach (NotificationType::cases() as $type) {
        $family = familyOf($type);

        if ($family === null) {
            continue;
        }

        $base = 'mail.'.$family.'.'.str_replace('.', '_', $type->value);

        foreach (['subject', 'heading', 'body'] as $part) {
            $key = $base.'.'.$part;

            // `__()` hands back the key when nothing matches. That is the
            // whole failure mode: no exception, no warning, just a
            // dot-separated string where a sentence should be.
            if (__($key) === $key) {
                $missing[] = $key;
            }
        }
    }

    expect($missing)->toBe([], 'Notification types with no copy behind them');
});

it('never renders a translation key into a subject line', function () {
    $leaked = [];

    foreach (NotificationType::cases() as $type) {
        $family = familyOf($type);

        if ($family === null) {
            continue;
        }

        $subject = __('mail.'.$family.'.'.str_replace('.', '_', $type->value).'.subject');

        // Belt and braces over the test above, and it catches a second shape:
        // copy that exists but was written with a dotted key by mistake.
        if (is_string($subject) && str_starts_with($subject, 'mail.')) {
            $leaked[] = $type->value;
        }
    }

    expect($leaked)->toBe([], 'Types whose subject is a translation key');
});

it('gives every mailable type a label for the settings screen', function () {
    $unlabelled = [];

    foreach (NotificationType::cases() as $type) {
        $configured = config('notifications.channels.'.$type->value);

        $channels = is_array($configured)
            ? $configured
            : array_map(fn (NotificationChannel $c) => $c->value, $type->defaultChannels());

        if (! in_array(NotificationChannel::MAIL->value, $channels, true)) {
            continue;
        }

        // The email menu renders `label()` for every switchable row, and an
        // enum case with no arm there is a fatal `UnhandledMatchError` on a
        // screen a Super Admin opens, not a missing string.
        if (trim($type->label()) === '') {
            $unlabelled[] = $type->value;
        }
    }

    expect($unlabelled)->toBe([], 'Mailable types with no label');
});
