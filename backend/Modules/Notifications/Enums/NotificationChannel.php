<?php

namespace Modules\Notifications\Enums;

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
        };
    }
}
