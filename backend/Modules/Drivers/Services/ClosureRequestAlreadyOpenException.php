<?php

namespace Modules\Drivers\Services;

use Modules\Drivers\Models\Driver;

/**
 * This driver already has a closure request waiting (ADR-0043 §1).
 *
 * Surfaces as `409 CLOSURE_REQUEST_ALREADY_OPEN`. Two pending requests are not
 * two closures, they are one driver asking twice — usually a double tap on a
 * bad connection, which is why the service takes a lock rather than trusting a
 * plain status check.
 *
 * The message points at the withdrawal the app offers, because "you already
 * asked" without a way to change the answer is how somebody ends up ringing
 * the office about a button.
 */
class ClosureRequestAlreadyOpenException extends \RuntimeException
{
    private function __construct(string $message)
    {
        parent::__construct($message);
    }

    public static function forDriver(Driver $driver): self
    {
        return new self(
            'You have already asked the office to close your account. '
            .'Withdraw that request first if you want to change it.',
        );
    }
}
