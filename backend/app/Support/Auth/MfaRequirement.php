<?php

namespace App\Support\Auth;

/**
 * Whether the second factor is in force at all (config/mfa.php).
 *
 * One place, because two places would eventually disagree: the middleware
 * that forces enrolment and the sign-in that asks for a code must be
 * switched by the same answer, or a developer ends up unable to enrol and
 * unable to sign in.
 *
 * **Production is not negotiable.** The environment is checked before the
 * config value is read, so `MFA_ENABLED=false` copied into a production .env
 * is inert. AGENTS.md requires the factor for the roles that move money;
 * this class is a development convenience and says so by refusing to be one
 * anywhere else.
 *
 * Nothing here deletes a secret. Turning the switch back on restores exactly
 * the accounts that were protected before it was turned off.
 */
class MfaRequirement
{
    public static function inForce(): bool
    {
        if (app()->environment('production')) {
            return true;
        }

        return (bool) config('mfa.enabled', true);
    }
}
