<?php

namespace Modules\Administration\Services;

use RuntimeException;

/**
 * The challenge is unknown, already spent, or older than five minutes.
 *
 * One exception for all three, because the difference is not the user's to
 * act on — they start the login again in every case — and because saying
 * which would tell an attacker holding a captured challenge id whether it
 * was ever real.
 */
class InvalidMfaChallengeException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('That sign-in attempt has expired. Please enter your email and password again.');
    }
}
