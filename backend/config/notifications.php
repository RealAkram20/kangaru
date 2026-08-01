<?php

use Modules\Notifications\Enums\NotificationChannel;
use Modules\Notifications\Enums\NotificationType;

return [

    /*
    |--------------------------------------------------------------------------
    | Channels per notification type
    |--------------------------------------------------------------------------
    |
    | AGENTS.md, Configuration Driven: which channel carries which message is
    | an operational decision, not a constant. A deployment that wants
    | booking decisions in-app only should not need a release, and a client
    | whose staff live in their inbox should be able to add mail.
    |
    | Omit a type entirely and NotificationType::defaultChannels() decides.
    | An empty array is a valid, meaningful answer: it turns that
    | notification off without deleting the code that raises it.
    |
    | Only channels NotificationChannel knows about are honoured; anything
    | else is dropped rather than guessed at. SMS is deliberately absent —
    | no provider is configured, and a channel that silently delivers
    | nowhere is worse than one that does not exist.
    |
    */

    'channels' => [

        NotificationType::BOOKING_APPROVED->value => [
            NotificationChannel::DATABASE->value,
            NotificationChannel::MAIL->value,
        ],

        NotificationType::BOOKING_REJECTED->value => [
            NotificationChannel::DATABASE->value,
            NotificationChannel::MAIL->value,
        ],

        /*
         | In-app only. The requester asked for this file seconds ago and is
         | most likely still on the page; emailing them as well is the
         | notification fatigue AGENTS.md warns about.
         */
        NotificationType::REPORT_EXPORT_READY->value => [
            NotificationChannel::DATABASE->value,
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Retention
    |--------------------------------------------------------------------------
    |
    | How long a read notification is kept before pruning. Unread ones are
    | never pruned by age: an unread notification is a job somebody has not
    | done, and deleting it would silently close that loop.
    |
    | Pruning itself is NOT built — see Modules/Notifications/README.md. This
    | key exists so the value is settled in one place when the command
    | arrives, rather than being invented inside it.
    |
    */

    'retention_days' => (int) env('NOTIFICATION_RETENTION_DAYS', 90),

];
