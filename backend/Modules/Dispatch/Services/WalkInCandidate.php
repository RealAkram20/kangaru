<?php

namespace Modules\Dispatch\Services;

use Modules\Drivers\Models\Driver;
use Modules\Vehicles\Models\Vehicle;

/**
 * One driver the matcher would offer a walk-in ride to, and why
 * (ADR-0024 §3).
 *
 * The walk-in twin of `DispatchSuggestion`, and a separate class rather than
 * a reuse of it because the two rank different things. `DispatchSuggestion`
 * is vehicle-led — a corporate booking is dispatched by choosing a van and
 * pairing a free driver with it, because contracts are held against vehicles
 * (ADR-0009). A hailing ride is driver-led: the driver is the one who is
 * near the passenger, and their vehicle comes with them.
 *
 * Collapsing the two into one shape would mean a `vehicle` that is
 * sometimes the subject and sometimes an attribute of the subject.
 */
final class WalkInCandidate
{
    /**
     * @param  array<int, string>  $reasons  one sentence per scoring component
     */
    public function __construct(
        public readonly Driver $driver,
        public readonly ?Vehicle $vehicle,
        public readonly float $score,
        public readonly ?float $pickupDistanceKm,
        public readonly array $reasons,
    ) {}

    /**
     * Whether this candidate could actually be sent.
     *
     * A driver on duty with no vehicle is a real and common state — presence
     * records them before the depot has issued keys — and they are ranked
     * rather than dropped so the office can see them. But an offer they
     * accepted could not produce a trip, because `trips.vehicle_id` is not
     * nullable and a passenger cannot ride in an intention.
     *
     * Asked here rather than filtered in the recommender so that
     * `forOrderRequest()` stays an honest picture of the pool: "four drivers
     * near this pickup, one of whom has no van" is a useful thing for an
     * operator to be able to see.
     */
    public function isOfferable(): bool
    {
        return $this->vehicle !== null;
    }
}
