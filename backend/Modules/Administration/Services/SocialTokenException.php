<?php

namespace Modules\Administration\Services;

/**
 * The provider proof did not verify (ADR-0028 §3).
 *
 * Surfaces as `401 SOCIAL_TOKEN_INVALID`, and the message shown to the
 * caller is always the same generic sentence — which of the checks failed
 * (audience, expiry, the provider refusing) goes to the log via
 * `$reason`, where it helps an operator instead of an attacker tuning
 * their forgery.
 */
class SocialTokenException extends \RuntimeException
{
    public function __construct(public readonly string $reason)
    {
        parent::__construct('That sign-in could not be verified. Try again.');
    }
}
