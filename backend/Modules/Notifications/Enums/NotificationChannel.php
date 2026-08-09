<?php

namespace Modules\Notifications\Enums;

use Modules\Notifications\Channels\ExpoPushChannel;
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
     * DATABASE resolves to our own channel rather than Laravel's, because
     * Laravel's writes to a framework table with no tenant column (see the
     * notifications migration).
     */
    public function driver(): string
    {
        return match ($this) {
            self::DATABASE => TenantDatabaseChannel::class,
            self::MAIL => 'mail',
            self::PUSH => ExpoPushChannel::class,
        };
    }
}
