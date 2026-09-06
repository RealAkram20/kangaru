<?php

namespace Modules\Trips\Distance;

/**
 * What the trace says the vehicle did, and how much of that was measured
 * rather than inferred (ADR-0045).
 *
 * `gpsKm` is null — not zero — when there were fewer than two usable pings.
 * Null is "no evidence"; zero is "the vehicle did not move". The resolver
 * treats them differently and so must everything downstream.
 *
 * `matchedKm` is road the engine snapped pings to. `inferredKm` is everything
 * else that went into `gpsKm`: gaps routed between the runs of pings, breaks
 * the engine left inside a run, and — when the engine was unavailable — the
 * whole haversine figure. `inferredSharePercent` is the second over the sum,
 * and it is one of the bars a trace must clear to be billed as measured.
 *
 * `haversineKm` is the raw crow-flight sum over kept pings, kept for the
 * record and for the shadow report's "how far off was the old watchdog"
 * column. It is what `gps_distance_km` has always been.
 */
final class MeasuredTrace
{
    /**
     * @param  array<int, string>  $polylines  the engine's snapped geometries, encoded
     */
    public function __construct(
        public readonly CleanedTrace $cleaned,
        public readonly ?float $gpsKm,
        public readonly float $matchedKm,
        public readonly float $inferredKm,
        public readonly float $haversineKm,
        public readonly ?float $coveragePercent,
        public readonly ?float $inferredSharePercent,
        public readonly int $gapsRouted,
        public readonly string $provider,
        public readonly array $polylines,
    ) {}

    /** The first kept ping, for a reference route that has no pins to start from. */
    public function firstPoint(): ?TracePoint
    {
        return $this->cleaned->points[0] ?? null;
    }

    public function lastPoint(): ?TracePoint
    {
        $points = $this->cleaned->points;

        return $points === [] ? null : $points[count($points) - 1];
    }
}
