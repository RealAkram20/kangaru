<?php

namespace Modules\Dispatch\Services;

use Modules\Bookings\Enums\OrderRequestServiceType;

/**
 * Thrown when somebody tries to send a driver to a booking whose service
 * never takes one — a self-drive rental (ADR-0064).
 *
 * A dedicated exception rather than InvalidBookingTransitionException,
 * because that one's message names two statuses and would tell the
 * dispatcher a true-but-useless thing: the problem is not where the booking
 * is in its lifecycle but what kind of work it is, and no retry at any
 * status fixes that.
 */
class BookingNotDispatchableException extends \RuntimeException
{
    public function __construct(OrderRequestServiceType $service)
    {
        parent::__construct(
            "A {$service->value} booking is not dispatched to a driver. "
            .'The desk hands the vehicle over at collection instead.',
        );
    }
}
