<?php

namespace Modules\Trips\Distance;

use Modules\Trips\Models\Trip;

/**
 * Who says which witness a trip bills on (ADR-0045 §3).
 *
 * The answer lives on the rate card version, which is Billing's, and Billing
 * already depends on Trips — the pricing engine takes a Trip. Having the
 * resolver import `RateCardResolver` would close that loop and make neither
 * module movable, the same reasoning that made `TripCompleted` an event
 * rather than a call. So Trips names the question here and Billing answers
 * it (`Modules\Billing\Pricing\RateCardDistancePolicySource`), bound in
 * `AppServiceProvider` like `RouteProvider` is.
 */
interface DistancePolicySource
{
    /**
     * The policy of the rate card version that would price this trip, or
     * `GPS_PRIMARY` when none can be resolved — nothing will bill such a trip,
     * and the shadow report should still show what the trace would have said.
     */
    public function policyFor(Trip $trip): DistancePolicy;
}
