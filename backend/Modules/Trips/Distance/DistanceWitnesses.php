<?php

namespace Modules\Trips\Distance;

/**
 * The four witnesses and the quality numbers behind them — everything
 * `DistanceResolver` is allowed to look at (ADR-0045).
 *
 * A flat value rather than a Trip plus a MeasuredTrace plus a route, so the
 * resolver's whole input can be written out in a test table, and so the
 * evidence row can record exactly what the decision saw and nothing it
 * did not.
 *
 * Nulls mean "this witness did not testify": no odometer captured, no trace
 * to measure, no reference route obtainable. They are never zero — a trip
 * with a trace that shows no movement has `gpsKm = 0.0`, and that is a very
 * different fact from having no trace at all.
 */
final class DistanceWitnesses
{
    public function __construct(
        public readonly ?float $odometerKm,
        public readonly ?float $gpsKm,
        public readonly ?float $coveragePercent,
        public readonly ?float $inferredSharePercent,
        public readonly int $mockDropped,
        public readonly int $teleportsDropped,
        public readonly ?float $routeKm,
        /**
         * Whether the driver declared a stop (a Waiting period) during the
         * trip. Under `ROUTE_CAPPED` a declared stop lifts the detour cap:
         * the reference route does not visit a place the trip was asked to
         * wait at, so exceeding it is not a detour.
         */
        public readonly bool $stopsDeclared = false,
    ) {}
}
