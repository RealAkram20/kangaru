<?php

namespace Modules\Dispatch\Services;

use Modules\Dispatch\Models\DispatchOffer;

/**
 * The offer names no vehicle, so accepting it could not produce a trip
 * (ADR-0024 §3).
 *
 * `trips.vehicle_id` is not nullable and a passenger cannot ride in an
 * intention. `WalkInRecommender::offerableFor()` filters these candidates
 * out, so reaching this is a bug rather than a race — but "unreachable" is a
 * property of today's callers, not of the accept path, and the failure it
 * guards against is a driver being told they have a job that cannot exist.
 *
 * Surfaces as 409 OFFER_HAS_NO_VEHICLE, with a sentence that tells the
 * driver the one thing they can act on.
 */
class OfferHasNoVehicleException extends \RuntimeException
{
    public function __construct(public readonly DispatchOffer $offer)
    {
        parent::__construct(
            'This job has no vehicle against it. Tell the depot which vehicle you are in and try again.'
        );
    }
}
