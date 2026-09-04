<?php

namespace Modules\Trips\Distance;

use Modules\Trips\Models\Trip;
use Modules\Trips\Models\TripStop;

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
            $km = $this->router->routeKilometres(array_merge(
                [
                    [(float) $order->pickup_latitude, (float) $order->pickup_longitude],
                    [(float) $order->dropoff_latitude, (float) $order->dropoff_longitude],
                ],
                $this->extensionWaypoints($trip),
            ));

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

    /**
     * The accepted extensions, in run order, as waypoints after the drop-off.
     *
     * ## Why this is the difference between paying a driver and not
     *
     * The reference is a **bound**, and `DistanceResolver::ROUTE_CAPPED` uses
     * it as one: a billed figure may not exceed the reference plus the detour
     * allowance. A trip whose passenger travelled twenty kilometres past the
     * agreed drop-off produces a trace twenty kilometres longer than a
     * two-pin route — so without these waypoints the resolver would read a
     * correct trace as an implausible one, cap the billed distance at the
     * original journey, and the extension would be driven and not paid for.
     * It would also land in Distance Review as a variance, which is the
     * office being asked to investigate the system working as designed.
     *
     * The trace branch below needs no equivalent: its ends are the first and
     * last kept pings, and the last ping of an extended trip is already at
     * the extension.
     *
     * Only extensions with coordinates. A driver in a dead zone may record
     * "on to Ntinda" as prose (`trip_stops.latitude` is nullable as a pair),
     * and a waypoint cannot be made from a sentence — that trip keeps the
     * two-pin reference, which is the honest weaker answer rather than a
     * guessed stronger one.
     *
     * @return array<int, array{0: float, 1: float}>
     */
    private function extensionWaypoints(Trip $trip): array
    {
        return TripStop::query()
            ->acceptedExtensions($trip)
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->get()
            ->map(fn (TripStop $stop) => [(float) $stop->latitude, (float) $stop->longitude])
            ->all();
    }
}
