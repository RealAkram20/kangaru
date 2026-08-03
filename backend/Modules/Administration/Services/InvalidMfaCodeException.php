<?php

namespace Modules\Administration\Services;

use RuntimeException;

/**
 * The six digits, or the recovery code, did not match (ADR-0008).
 *
 * Deliberately does not distinguish "wrong TOTP code" from "wrong recovery
 * code" from "no recovery codes left". The caller has one thing to do
 * either way, and separating them would tell somebody holding a stolen
 * password which of the two factors they are closer to.
 */
class InvalidMfaCodeException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('That code is not correct. Check your authenticator app and try again.');
    }
}
