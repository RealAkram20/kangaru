<?php

namespace Modules\Dispatch\Services;

use RuntimeException;

/**
 * The client has a vehicle contracted for this day and a different one was
 * chosen, without saying why (ADR-0009 §1).
 *
 * Not a refusal — the dispatcher may absolutely make this choice, and often
 * should: the contracted vehicle may be in maintenance, or wrong for the
 * passenger count. What is refused is making it *silently*. A reason turns
 * "why was the Bank's contracted vehicle not used on the 14th" from an
 * unanswerable question into a stored one.
 *
 * Surfaced as a `422` against `allocation_override_reason` rather than a
 * 409: nothing about the world conflicts, the request is simply missing a
 * field that this particular choice requires.
 */
class AllocationOverrideRequiredException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct(
            'This client has a vehicle contracted for that date and you have chosen a different one. '
            .'Give a short reason — it is recorded on the trip so the choice can be explained later.'
        );
    }
}
