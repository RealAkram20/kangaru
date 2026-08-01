<?php

namespace Modules\Billing\Services;

use Modules\Trips\Enums\TripStatus;
use Modules\Trips\Models\Trip;

/**
 * The trip is not in a state that can be billed.
 *
 * Only a trip at `Trip Completed` can be invoiced: that is the transition
 * that captures the closing odometer and stamps `completed_at`, and without
 * both there is no distance to charge for and no way to reproduce the
 * charge later. Surfaces as 409 TRIP_NOT_INVOICEABLE.
 */
class TripNotInvoiceableException extends \RuntimeException
{
    public function __construct(public readonly Trip $trip)
    {
        parent::__construct(sprintf(
            'This trip cannot be invoiced because it is %s, not %s. '.
            'Complete the trip — capturing the closing odometer reading — and then invoice it.',
            str_replace('_', ' ', $trip->status->value),
            str_replace('_', ' ', TripStatus::TRIP_COMPLETED->value),
        ));
    }
}
