<?php

namespace Modules\Trips\Services;

use RuntimeException;

/**
 * The selected driver is already committed to a live trip. Surfaced as
 * `409 DRIVER_UNAVAILABLE`.
 */
class DriverUnavailableException extends RuntimeException
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
        public readonly int $driverId,
        public readonly int $conflictingTripId,
        ?string $note = null,
    ) {
        parent::__construct($note ??
            'This driver is already assigned to trip #'.$conflictingTripId.
            ' and cannot be dispatched again until that trip is completed or cancelled.'
        );
    }
}
