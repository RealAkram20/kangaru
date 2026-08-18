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
    ) {}
}
