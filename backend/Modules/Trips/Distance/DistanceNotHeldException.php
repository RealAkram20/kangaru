<?php

namespace Modules\Trips\Distance;

use Modules\Trips\Models\Trip;

class DistanceNotHeldException extends \RuntimeException
{
    public function __construct(public readonly Trip $trip)
    {
        parent::__construct(sprintf(
            'Trip #%d is not held for review%s, so there is nothing to clear.',
            $trip->id,
            $trip->distance_grade === null
                ? ' — its distance has not been resolved yet'
                : " — its distance is grade {$trip->distance_grade->value}",
        ));
    }
}
