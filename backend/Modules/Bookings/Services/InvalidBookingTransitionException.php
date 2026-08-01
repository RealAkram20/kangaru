<?php

namespace Modules\Bookings\Services;

use Modules\Bookings\Enums\BookingStatus;
use RuntimeException;

/**
 * Surfaced as `409 INVALID_BOOKING_TRANSITION`, mirroring
 * Modules\Trips\Services\InvalidTripTransitionException.
 */
class InvalidBookingTransitionException extends RuntimeException
{
    public function __construct(public readonly BookingStatus $from, public readonly BookingStatus $to)
    {
        parent::__construct(
            'A booking that is already '.$from->value.' cannot be moved to '.$to->value.'.'
        );
    }
}
