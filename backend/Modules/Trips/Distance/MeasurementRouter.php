<?php

namespace Modules\Trips\Distance;

/**
 * The routing engine as the measurer needs it: snap a trace to roads, and
 * measure the road through a list of points (ADR-0045).
 *
 * A second seam beside `Routing\RouteProvider`, not a widening of it. That
 * one draws a line for a driver's map, is gated by `maps.routing_enabled`,
 * and may be Google — a metered API that must never be called once per
 * completed trip. This one is gated by `tracking.trace_matching_enabled`,
 * runs against the operator's own OSRM, and answers two questions the map
 * never asks. Two switches, because the operator may want either without the
 * other, and a shared interface would make the metered vendor one config
 * value away from the per-trip path.
 *
 * **Implementations never throw.** A null answer degrades a measurement to
 * haversine and a grade; an exception would fail the job and leave the trip
 * unresolved, which is the silence ADR-0035 recorded as the worst outcome.
 */
interface MeasurementRouter
{
    /**
     * Whether the engine can be asked at all — switched on and pointed at a
     * server. Checked once per resolution so a disabled engine costs no
     * requests and the evidence row can say `provider: haversine`.
     */
    public function available(): bool;

    /**
     * Snap a run of consecutive pings to the road network.
     *
     * @param  array<int, TracePoint>  $points  in recorded order, at least two
     */
    public function match(array $points): ?MatchedChunk;

    /**
     * Road distance in kilometres through the given points, in order.
     *
     * @param  array<int, array{0: float, 1: float}>  $waypoints  latitude, longitude pairs; at least two
     */
    public function routeKilometres(array $waypoints): ?float;

    /** What the evidence row records as `provider`. */
    public function name(): string;
}
