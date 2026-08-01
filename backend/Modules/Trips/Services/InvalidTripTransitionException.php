<?php

namespace Modules\Trips\Services;

use Modules\Trips\Enums\TripStatus;
use RuntimeException;

/**
 * Thrown by TripStateMachine::transition() when the requested move isn't
 * in TripStatus::allowedTransitions(). Caught by TripController and
 * turned into a 409 INVALID_TRIP_TRANSITION response — kept as a plain
 * domain exception rather than a global exception-handler mapping, same
 * as InvalidCredentialsException.
 */
class InvalidTripTransitionException extends RuntimeException
{
    public function __construct(public readonly TripStatus $from, public readonly TripStatus $to)
    {
        parent::__construct("Cannot move a trip from \"{$from->value}\" to \"{$to->value}\".");
    }
}
