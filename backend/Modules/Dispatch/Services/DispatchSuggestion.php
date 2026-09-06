<?php

namespace Modules\Dispatch\Services;

use Modules\Drivers\Models\Driver;
use Modules\Vehicles\Models\Vehicle;

/**
 * One (vehicle, driver) pair the matcher would choose, and why (ADR-0020).
 *
 * The reasons are not decoration. AGENTS.md ships dispatch algorithm changes
 * behind a flag precisely because a matcher is a thing operators have to
 * come to trust, and a ranking nobody can audit is a ranking a dispatcher
 * overrides on instinct — which is manual dispatch with extra steps. Every
 * score here can be read back as a sentence.
 */
final class DispatchSuggestion
{
    /**
     * @param  array<int, string>  $reasons  why this pair ranks where it does
     */
    public function __construct(
        public readonly Vehicle $vehicle,
        public readonly Driver $driver,
        public readonly float $score,
        public readonly ?float $pickupDistanceKm,
        public readonly array $reasons,
        /**
         * Whether this vehicle is contracted to the booking's client for the
         * day (ADR-0009 §1).
         *
         * Already decided when the score is built — it is the 1000-point term
         * — and carried out so callers do not have to infer it. The offer
         * path needs it as a *filter* rather than a weight: the owner's
         * ruling is that a corporate booking offered to drivers never leaves
         * the client's own contracted fleet, and reading that off the reasons
         * array would be matching on a sentence.
         */
        public readonly bool $contracted = false,
        /**
         * Whether the vehicle belongs to the main fleet.
         *
         * The owner's rule, 29 August 2026: *"shanitah is the main fleet that
         * has got all the access to both walking and Coporate, the other just
         * need to request another contract."* The house fleet is the
         * platform's own operation and predates the idea of contracting to
         * it; a fleet that arrived to serve one client contracts for the work.
         *
         * **Eligibility, not weight.** It is read beside `contracted` by the
         * offer path and nowhere in the score, so a contracted vehicle still
         * outranks a house one by the full 1000 points (ADR-0009 §1). A client
         * who has paid to have vehicles set aside still gets them first; what
         * changes is that the house can take the job when they are all out,
         * instead of the booking going back to a desk that would have picked
         * the same vehicle by hand.
         */
        public readonly bool $mainFleet = false,
    ) {}
}
