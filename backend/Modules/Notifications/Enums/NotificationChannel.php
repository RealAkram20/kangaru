<?php

namespace Modules\Notifications\Enums;

use Modules\Notifications\Channels\ExpoPushChannel;
use Modules\Notifications\Channels\SettingsMailChannel;
use Modules\Notifications\Channels\TenantDatabaseChannel;

/**
 * How a notification reaches someone.
 *
 * PROJECT.md's Notification Center is "Email, SMS, system notifications.
 * Future: WhatsApp, push". Two of the three are here. SMS is **not** a case
 * on this enum, deliberately: no provider is configured, and an enum case
 * that silently delivers nowhere is worse than its absence — a dispatcher
 * would see "sent by SMS" against a message that never left the building.
 * It arrives as a case when a provider does. See the README.
 */
enum NotificationChannel: string
{
    case DATABASE = 'database';
    case MAIL = 'mail';

    /**
     * A notification on the handset's lock screen (ADR-0025).
     *
     * Ships *with* a working transport, which is what separates it from the
     * SMS case this enum still refuses above: `ExpoPushChannel` exists and
     * sends. It is inert — not silently lost — for a user with no registered
     * device, which is every staff account and any driver who declined the
     * OS permission.
     */
    case PUSH = 'push';

    /**
     * The Laravel channel this maps to.
     *
     * **None of the three is Laravel's own**, and each is ours for a
     * different reason.
     *
     * DATABASE resolves to our own channel because Laravel's writes to a
     * framework table with no tenant column (see the notifications migration).
     *
     * MAIL used to resolve to the string `mail`, which is the framework's
     * default mailer, which is `MAIL_MAILER` from `.env`, which is `log`.
     * Every email on this channel was written to a log file for the whole
     * life of the feature while `PasswordResetService` sent real mail from
     * the settings the owner saved. `SettingsMailChannel` is that second path,
     * and now it is the only one: a green test send in the settings screen
     * vouches for booking emails because it is the same code.
     */
    public function driver(): string
    {
        return match ($this) {
            self::DATABASE => TenantDatabaseChannel::class,
            self::MAIL => SettingsMailChannel::class,
            self::PUSH => ExpoPushChannel::class,
        };
    }
}
