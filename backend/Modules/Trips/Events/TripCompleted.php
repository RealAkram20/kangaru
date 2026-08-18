<?php

namespace Modules\Trips\Events;

use Illuminate\Foundation\Events\Dispatchable;
use Modules\Trips\Models\Trip;

/**
 * A journey finished (ADR-0026 §3).
 *
 * Raised at `trip_completed` and nowhere else: that is the transition which
 * captures the closing odometer and computes `distance_km`, so it is the
 * first moment a fare *can* be worked out.
 *
 * ## Why an event rather than a call
 *
 * `Modules\Billing` already depends on `Modules\Trips` — the pricing engine
 * takes a Trip. Having the state machine call a billing service would close
 * that loop and make neither module movable. The same reasoning produced
 * `BookingApproved`, which exists so `Modules\Bookings` need not know that
 * anybody sends notifications.
 *
 * Carries the model rather than an id, and is deliberately **not** queued:
 * its listener prices the trip inside the request that completed it, so a
 * driver's app has the fare on the response. See `SettleWalkInFare` for why
 * that is safe.
 */
class TripCompleted
{
    use Dispatchable;

    public function __construct(public readonly Trip $trip) {}
}
