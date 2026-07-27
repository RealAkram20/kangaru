<?php

namespace Modules\Administration\Services;

use RuntimeException;

/**
 * Thrown by AuthService::login() on bad credentials. Caught by
 * AuthController and turned into a 401 INVALID_CREDENTIALS response —
 * kept as a plain domain exception rather than a global exception-handler
 * mapping, since it's specific to the one login action.
 */
class InvalidCredentialsException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('The provided credentials do not match our records.');
    }
}
