<?php

namespace Modules\Bookings\Services;

use Modules\Bookings\Enums\OrderRequestStatus;
use RuntimeException;

/**
 * Surfaced as `409 INVALID_ORDER_REQUEST_TRANSITION`, mirroring
 * InvalidBookingTransitionException.
 */
class InvalidOrderRequestTransitionException extends RuntimeException
{
    public function __construct(
        public readonly OrderRequestStatus $from,
        public readonly OrderRequestStatus $to,
    ) {
        parent::__construct(
            'An order request that is already '.$from->value.' cannot be moved to '.$to->value.'.'
        );
    }
}
