<?php

namespace Modules\Billing\Pricing;

use Modules\Trips\Models\Trip;

/**
 * The trip bills on the measured trace and the resolver has not answered
 * for it yet (ADR-0045). "Not yet", not "never".
 */
class TripDistanceUnresolvedException extends \RuntimeException
{
    public function __construct(public readonly Trip $trip)
    {
        parent::__construct(sprintf(
            'Trip #%d cannot be billed yet: its rate card prices the measured distance, and the distance has not been resolved. '.
            'The resolver runs shortly after Trip Completed and again when late GPS pings arrive; wait, or run '.
            '`php artisan trips:replay-distance %d --commit` to resolve it now.',
            $trip->id,
            $trip->id,
        ));
    }
}
