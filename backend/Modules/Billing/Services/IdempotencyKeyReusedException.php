<?php

namespace Modules\Billing\Services;

/**
 * The idempotency key presented was already spent on a different subject —
 * another trip's invoice, or another invoice's credit note.
 *
 * Returning the original record here would be worse than refusing: the
 * caller asked to bill trip B and would be handed trip A's invoice, and
 * would have no way to tell. A key identifies one intended mutation, so a
 * key pointing at two is a client bug and is reported as one.
 *
 * Surfaces as 409 IDEMPOTENCY_KEY_REUSED.
 */
class IdempotencyKeyReusedException extends \RuntimeException
{
    public function __construct(string $key, string $usedFor)
    {
        parent::__construct(sprintf(
            'The idempotency key "%s" was already used for %s. '.
            'Use a new key for a new request, or resend the original request unchanged to retrieve its result.',
            $key,
            $usedFor,
        ));
    }
}
