<?php

namespace Modules\Trips\Distance;

use Modules\Administration\Services\SettingsService;

/**
 * Every number the resolver turns on, read once and carried as a value
 * (ADR-0045; `tracking` settings group, and the noise floor from
 * `config/tracking.php`).
 *
 * Read once, at the start of a resolution, for two reasons. The cleaner, the
 * measurer and the resolver are pure functions of their inputs, and passing
 * them a value rather than a service is what keeps them that way. And the
 * evidence row records `toArray()` of *this object* — the thresholds as they
 * stood when the decision was made — so an operator changing a dial tomorrow
 * does not silently restate what today's fare was decided on.
 *
 * `defaults()` exists for tests and for the replay command, and mirrors the
 * catalogue's defaults exactly; a test that wants a different corridor names
 * it with `with()`.
 */
final class DistanceThresholds
{
    public function __construct(
        public readonly bool $traceMatchingEnabled,
        public readonly float $minCoveragePercent,
        public readonly float $maxInferredSharePercent,
        public readonly float $maxPingAccuracyMetres,
        public readonly float $maxPlausibleSpeedKph,
        public readonly int $maxTeleports,
        public readonly int $gapSeconds,
        public readonly float $routeTolerancePercent,
        public readonly float $corridorFloorPercent,
        public readonly float $corridorCeilingPercent,
        public readonly float $detourCapPercent,
        public readonly float $minSegmentMetres,
    ) {}

    /**
     * Half a kilometre of slack on the route tolerance, so a two-kilometre
     * hop is not graded B because the reference cut a corner the driver
     * could not. Fixed rather than a setting: it is a floor on a percentage,
     * not a policy of its own.
     */
    public const ROUTE_TOLERANCE_FLOOR_KM = 0.5;

    public static function fromSettings(SettingsService $settings): self
    {
        return new self(
            traceMatchingEnabled: (bool) $settings->get('tracking', 'trace_matching_enabled'),
            minCoveragePercent: (float) $settings->get('tracking', 'min_coverage_percent'),
            maxInferredSharePercent: (float) $settings->get('tracking', 'max_inferred_share_percent'),
            maxPingAccuracyMetres: (float) $settings->get('tracking', 'max_ping_accuracy_metres'),
            maxPlausibleSpeedKph: (float) $settings->get('tracking', 'max_plausible_speed_kph'),
            maxTeleports: (int) $settings->get('tracking', 'max_teleports'),
            gapSeconds: (int) $settings->get('tracking', 'gap_seconds'),
            routeTolerancePercent: (float) $settings->get('tracking', 'route_tolerance_percent'),
            corridorFloorPercent: (float) $settings->get('tracking', 'corridor_floor_percent'),
            corridorCeilingPercent: (float) $settings->get('tracking', 'corridor_ceiling_percent'),
            detourCapPercent: (float) $settings->get('tracking', 'detour_cap_percent'),
            minSegmentMetres: (float) config('tracking.min_segment_metres', 5),
        );
    }

    public static function defaults(): self
    {
        return new self(
            traceMatchingEnabled: false,
            minCoveragePercent: 80,
            maxInferredSharePercent: 25,
            maxPingAccuracyMetres: 50,
            maxPlausibleSpeedKph: 160,
            maxTeleports: 2,
            gapSeconds: 120,
            routeTolerancePercent: 15,
            corridorFloorPercent: 90,
            corridorCeilingPercent: 125,
            detourCapPercent: 15,
            minSegmentMetres: 5,
        );
    }

    /**
     * A copy with some values changed — the test-side way to say "the same
     * as the defaults, except the corridor is tighter".
     *
     * @param  array<string, mixed>  $overrides  keyed by constructor argument
     */
    public function with(array $overrides): self
    {
        return new self(...array_merge($this->toArray(), $overrides));
    }

    /**
     * What the evidence row stores. Keyed by the constructor's argument
     * names, so `new self(...$row['thresholds'])` rebuilds the object a
     * decision was made under.
     *
     * @return array<string, bool|float|int>
     */
    public function toArray(): array
    {
        return [
            'traceMatchingEnabled' => $this->traceMatchingEnabled,
            'minCoveragePercent' => $this->minCoveragePercent,
            'maxInferredSharePercent' => $this->maxInferredSharePercent,
            'maxPingAccuracyMetres' => $this->maxPingAccuracyMetres,
            'maxPlausibleSpeedKph' => $this->maxPlausibleSpeedKph,
            'maxTeleports' => $this->maxTeleports,
            'gapSeconds' => $this->gapSeconds,
            'routeTolerancePercent' => $this->routeTolerancePercent,
            'corridorFloorPercent' => $this->corridorFloorPercent,
            'corridorCeilingPercent' => $this->corridorCeilingPercent,
            'detourCapPercent' => $this->detourCapPercent,
            'minSegmentMetres' => $this->minSegmentMetres,
        ];
    }
}
