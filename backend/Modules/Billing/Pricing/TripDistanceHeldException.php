<?php

namespace Modules\Billing\Pricing;

use Modules\Trips\Distance\DistanceGrade;
use Modules\Trips\Models\Trip;

/**
 * The trip's distance resolved to grade C — held — and held trips do not
 * bill until a person clears them (ADR-0045 §2).
 */
class TripDistanceHeldException extends \RuntimeException
{
    /**
     * The grade is passed rather than read off the trip: `DistanceGate` has
     * just decided on it, and a message that re-read the column could name a
     * different one if anything reloaded the model in between.
     */
    public function __construct(public readonly Trip $trip, public readonly DistanceGrade $grade)
    {
        parent::__construct(sprintf(
            'Trip #%d cannot be billed: its distance is held for review (grade %s — %s). '.
            'A finance user must review the evidence and clear it with a reason before it is invoiced or the driver is paid.',
            $trip->id,
            $grade->value,
            $grade->label(),
        ));
    }
}
