<?php

namespace Modules\Trips\Services;

use RuntimeException;

/**
 * The selected vehicle is already committed to a live trip. Surfaced as
 * `409 VEHICLE_UNAVAILABLE` — the exact conflict AGENTS.md's API Standards
 * uses as its worked example.
 */
class VehicleUnavailableException extends RuntimeException
{
    public function __construct(public readonly int $vehicleId, public readonly int $conflictingTripId)
    {
        parent::__construct(
            'This vehicle is already assigned to trip #'.$conflictingTripId.
            ' and cannot be dispatched again until that trip is completed or cancelled.'
        );
    }
}
