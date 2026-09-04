<?php

namespace Modules\Drivers\Services;

use App\Models\User;
use Modules\Drivers\Models\Driver;

/**
 * A driver profile and a sign-in account may each belong to at most one of
 * the other (ADR-0016 §3).
 *
 * Surfaces as `409 DRIVER_ACCOUNT_CONFLICT`. The message names which half
 * is already taken, because "conflict" alone leaves an administrator
 * guessing which of the two things they have to detach.
 */
class DriverAccountConflictException extends \RuntimeException
{
    private function __construct(string $message)
    {
        parent::__construct($message);
    }

    public static function profileAlreadyHasAccount(Driver $driver): self
    {
        return new self(sprintf(
            '%s already signs in with an account. Remove the existing account from this driver '.
            'before attaching a different one.',
            $driver->name,
        ));
    }

    public static function accountBelongsToAnotherDriver(User $account): self
    {
        return new self(sprintf(
            'The account %s already signs in as another driver. One account drives for one driver '.
            'profile, so that link has to be removed first.',
            $account->email,
        ));
    }

    /**
     * The address on an application already belongs to an account
     * (ADR-0027 §5's deliberate duplicate, arriving at approval).
     *
     * The message tells the reviewer their two ways forward, because at
     * this point they are looking at a person they have decided to hire.
     */
    public static function emailAlreadyHasAccount(string $email): self
    {
        return new self(sprintf(
            '%s already belongs to an account on this platform. If it is this applicant, link that '.
            'account from the driver screen instead; if it is somebody else, the applicant needs to '.
            'apply again with an address of their own.',
            $email,
        ));
    }
}
