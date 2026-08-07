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
    /**
     * @param  int  $conflictingTripId  0 when the refusal is not a trip clash —
     *                                  ADR-0017's leave, workshop and off-shift
     *                                  reasons have no trip to point at
     * @param  string|null  $note  the specific reason, when there is one worth
     *                             reading; the trip-clash sentence is used
     *                             otherwise so existing callers are unchanged
     */
    public function __construct(
        public readonly int $vehicleId,
        public readonly int $conflictingTripId,
        ?string $note = null,
    ) {
        parent::__construct($note ??
            'This vehicle is already assigned to trip #'.$conflictingTripId.
            ' and cannot be dispatched again until that trip is completed or cancelled.'
        );
    }
}
