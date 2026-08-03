<?php

namespace Modules\Administration\Services;

use RuntimeException;

/**
 * Enrolment was begun on an account that already has a confirmed factor.
 *
 * Refused rather than quietly replacing the secret: silently re-enrolling
 * would be a reset, and resetting somebody's second factor is the same
 * hazard as resetting their password — an act an audit trail cannot tell
 * apart from impersonation. ADR-0008 puts admin-initiated MFA reset out of
 * scope for exactly that reason, and this is the self-service edge of it.
 */
class MfaAlreadyEnrolledException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('Two-factor authentication is already set up on this account.');
    }
}
