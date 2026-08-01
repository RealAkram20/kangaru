<?php

namespace Modules\Notifications\Models;

use RuntimeException;

/**
 * Raised when something tries to rewrite a delivered notification.
 *
 * A programming error, not a user-facing one — nothing in the module offers
 * an editing path, so reaching this means a caller went around the module
 * rather than that someone asked for something disallowed. It names the
 * columns it caught so the caller does not have to guess which of them was
 * the problem.
 *
 * @see Notification::booted()
 */
class NotificationImmutableException extends RuntimeException
{
    /**
     * @param  array<int, string>  $changed
     */
    public function __construct(Notification $notification, array $changed)
    {
        $columns = implode(', ', array_diff($changed, ['read_at', 'updated_at']));

        parent::__construct(
            "Notification {$notification->id} cannot be edited after delivery (attempted to change: {$columns}). ".
            'A notification records what someone was told; only read_at may change.'
        );
    }
}
