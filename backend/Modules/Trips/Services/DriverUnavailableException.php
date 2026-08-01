<?php

namespace Modules\Trips\Services;

use RuntimeException;

/**
 * The selected driver is already committed to a live trip. Surfaced as
 * `409 DRIVER_UNAVAILABLE`.
 */
class DriverUnavailableException extends RuntimeException
{
    public function __construct(public readonly int $driverId, public readonly int $conflictingTripId)
    {
        parent::__construct(
            'This driver is already assigned to trip #'.$conflictingTripId.
            ' and cannot be dispatched again until that trip is completed or cancelled.'
        );
    }
}
