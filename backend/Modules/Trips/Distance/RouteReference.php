<?php

namespace Modules\Trips\Distance;

use Modules\Trips\Models\Trip;

/**
 * Step 3 of the measured-distance algorithm: what the road says the trip
 * should have been (`docs/measured-distance-plan.md` §2, ADR-0045).
 *
 * Not a measurement — a bound. Real drives run longer than the shortest
 * road, never shorter, so the reference is what a trusted trace is graded
 * against and what the odometer is held inside when the trace is not
 * trusted.
 *
 * ## Where its ends come from
 *
 * The order's pickup and drop-off pins when the trip has them — a walk-in
 * always does. A corporate booking carries an origin pin only and there is
 * no geocoder, so for those the ends are the first and last kept pings of
 * the trace itself. That is weaker (a route between two points the vehicle
 * was at is not independent of the trace) but still a road-shaped bound; the
 * evidence row records which kind it was, and a trip with neither pins nor
 * trace has no reference and is grade C by construction.
 */
class RouteReference
{
    public const FROM_PINS = 'pins';

    public const FROM_TRACE = 'trace';

    public function __construct(private readonly MeasurementRouter $router) {}

    /**
     * @return array{km: float, source: string}|null
     */
    public function for(Trip $trip, MeasuredTrace $trace): ?array
    {
        if (! $this->router->available()) {
            return null;
        }

        $order = $trip->orderRequest;

        if ($order !== null
            && $order->pickup_latitude !== null && $order->pickup_longitude !== null
            && $order->dropoff_latitude !== null && $order->dropoff_longitude !== null) {
            $km = $this->router->routeKilometres([
                [(float) $order->pickup_latitude, (float) $order->pickup_longitude],
                [(float) $order->dropoff_latitude, (float) $order->dropoff_longitude],
            ]);

            if ($km !== null) {
                return ['km' => round($km, 2), 'source' => self::FROM_PINS];
            }
        }

        $first = $trace->firstPoint();
        $last = $trace->lastPoint();

        if ($first === null || $last === null || $first === $last) {
            return null;
        }

        $km = $this->router->routeKilometres([
            [$first->latitude, $first->longitude],
            [$last->latitude, $last->longitude],
        ]);

        return $km === null ? null : ['km' => round($km, 2), 'source' => self::FROM_TRACE];
    }
}
