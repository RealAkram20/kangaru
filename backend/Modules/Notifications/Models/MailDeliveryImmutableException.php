<?php

namespace Modules\Notifications\Models;

use RuntimeException;

/**
 * Raised when something tries to rewrite or delete a delivery record.
 *
 * A programming error rather than a user-facing one: the module offers no
 * editing path, so reaching this means a caller went around
 * `SettingsMailChannel` instead of that somebody asked for something
 * disallowed.
 *
 * @see MailDelivery::booted()
 */
class MailDeliveryImmutableException extends RuntimeException
{
    /**
     * @param  array<int, string>  $changed
     */
    public function __construct(MailDelivery $delivery, array $changed)
    {
        parent::__construct(
            "Mail delivery {$delivery->id} is append-only (attempted: ".implode(', ', $changed).'). '.
            'A delivery row records that an email was attempted; it may be closed once, from queued, and never deleted.'
        );
    }
}
