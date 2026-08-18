<?php

namespace Modules\Drivers\Services;

use Modules\Drivers\Models\DriverApplication;

/**
 * Somebody has already decided this application (ADR-0027 §4).
 *
 * Surfaces as `409 DRIVER_APPLICATION_CLOSED`. Almost always a second
 * reviewer acting on a list they loaded before their colleague approved the
 * same row — which is exactly the race the service takes a lock to lose
 * safely, since the alternative is two accounts for one person.
 *
 * The message names the outcome rather than saying "closed", because the
 * reviewer's next move differs: an approved application has a driver profile
 * to go and look at, a rejected one does not.
 */
class DriverApplicationClosedException extends \RuntimeException
{
    private function __construct(string $message)
    {
        parent::__construct($message);
    }

    public static function alreadyDecided(DriverApplication $application): self
    {
        return new self(sprintf(
            "%s's application was already %s. Refresh the list — somebody else may have reviewed it.",
            $application->name,
            $application->status->label() === 'Approved' ? 'approved' : 'rejected',
        ));
    }
}
