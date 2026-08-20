<?php

namespace Modules\Trips\Services;

use Modules\Administration\Services\SettingsService;
use Modules\Trips\Routing\RouteService;

/**
 * How far a trip went, when nobody read an odometer (ADR-0047 §2).
 *
 * ## The problem this exists for
 *
 * `distance_km` has always been `odometer_end - odometer_start`, and
 * `TripPricingEngine` prices from it. Turn the odometer off — which
 * `tracking.odometer_enabled` now allows platform-wide — and that subtraction
 * has nothing on either side of it. Something has to say how far the vehicle
 * went, and it has to be something a passenger can be charged for.
 *
 * ## Why the trace alone is not good enough
 *
 * The recorded trace is the best *measurement* available: `RouteDistanceCalculator`
 * already sums haversine over the pings and drops segments below a noise floor,
 * so a vehicle idling at a kerb does not accumulate billable metres. But a
 * measurement with no upper bound is a fare with no upper bound, and there are
 * two ordinary ways it inflates:
 *
 * - **Jitter.** Consumer GPS wanders. The noise floor catches a stationary
 *   vehicle; it does not catch a slow crawl through a market where every ping
 *   is genuinely a few metres from the last but the sum runs long.
 * - **A spoofed location.** `trip_locations` carries no mock-location flag —
 *   `docs/measured-distance-plan.md` §1 names that as a fact of the schema.
 *   Once the trace prices the fare rather than merely checking it, a handset
 *   that lies is a handset that pays itself.
 *
 * Neither is theoretical once money depends on the number. The odometer never
 * had this problem because a human read a dial somebody else could photograph.
 *
 * ## So: the road is the ceiling
 *
 * The trace is billed, unless it exceeds what the road between its own two
 * ends could plausibly justify — routed distance plus
 * `tracking.trace_route_ceiling_percent`. Over that, the fare is **capped and
 * flagged, never refused**: the passenger is standing at the kerb and the
 * driver did drive somewhere, so refusing to price the trip punishes the wrong
 * person for a signal problem. A human sees the flag.
 *
 * This is `docs/measured-distance-plan.md`'s thesis in its smallest useful
 * form. That plan's property is *boundedness* rather than precision — "there
 * is no path through the algorithm to a figure that is wildly wrong and
 * silently billed" — and the cap is what buys it. The full plan (map-matching,
 * a resolver that re-runs when late pings land) is still unbuilt and still
 * worth building; this does not replace it.
 *
 * ## What it will get wrong, stated rather than discovered
 *
 * **A genuine multi-stop circuit is capped low.** The reference is the road
 * between the trace's first and last point, so a vehicle that visits six ATMs
 * and returns near its start has a reference close to zero and a real distance
 * that is not. It is billed at the ceiling and flagged, so it is under-billed
 * and visible rather than over-billed and silent — the right direction to
 * fail, but a real limitation.
 *
 * It does not bite today: ADR-0045's client routes exist as models but nothing
 * links a `Trip` to their stops yet, so no trip in the system carries
 * waypoints. **When that linkage lands, route `via()` those stops instead of
 * `between()` the endpoints** — `RouteService` already has the method, and
 * this is the one place that has to change.
 */
class TripDistanceResolver
{
    public function __construct(
        private readonly RouteDistanceCalculator $trace,
        private readonly RouteService $routes,
        private readonly SettingsService $settings,
    ) {}

    /**
     * Whether drivers are recording odometer readings at all.
     *
     * Asked here rather than read directly by every caller, so the request
     * rules, the state machine and the resource layer cannot drift into three
     * different opinions about the same switch.
     */
    public function odometerEnabled(): bool
    {
        return (bool) $this->settings->get('tracking', 'odometer_enabled');
    }

    /**
     * The distance to bill for a trip whose odometer was never read.
     */
    public function resolve(int $tripId): TripDistance
    {
        $measured = $this->trace->kilometresFor($tripId);

        // **No trace, no distance — and deliberately not zero.** A handset
        // that never reported leaves a trip the platform genuinely cannot
        // measure, and inventing a figure for it is how an unnoticed fare
        // becomes an invoice. Flagged, so somebody resolves it against the
        // driver rather than against a guess.
        if ($measured === null) {
            return new TripDistance(
                null,
                true,
                null,
                'No GPS trace was recorded for this trip, so its distance could not be measured. It needs a distance before it can be billed.',
            );
        }

        $ceiling = $this->ceilingFor($tripId);

        // Routing switched off, no road between the two ends, or the provider
        // declined. The trace is then the only evidence there is, and it is
        // billed unbounded — with no flag, because nothing here is
        // suspicious: an operator who has not turned routing on has not asked
        // for a second opinion, and flagging every trip would make the flag
        // mean nothing. ADR-0047 records that as the cost of leaving
        // `maps.routing_enabled` off.
        if ($ceiling === null) {
            return new TripDistance(
                $measured,
                false,
                $measured,
                sprintf('Distance measured from the GPS trace: %.2f km. No road route was available to check it against.', $measured),
            );
        }

        if ($measured > $ceiling) {
            return new TripDistance(
                round($ceiling, 2),
                true,
                $measured,
                sprintf(
                    'The GPS trace measured %.2f km, which is further than the road between the start and end of this trip allows (%.2f km including the permitted margin). Billed at %.2f km and flagged for review.',
                    $measured,
                    $ceiling,
                    round($ceiling, 2),
                ),
            );
        }

        return new TripDistance(
            $measured,
            false,
            $measured,
            sprintf('Distance measured from the GPS trace: %.2f km, within what the road allows.', $measured),
        );
    }

    /**
     * The most a trace may measure before it stops being believable, or null
     * when there is no road answer to compare against.
     */
    private function ceilingFor(int $tripId): ?float
    {
        $endpoints = $this->trace->endpointsFor($tripId);

        if ($endpoints === null) {
            return null;
        }

        [[$fromLatitude, $fromLongitude], [$toLatitude, $toLongitude]] = $endpoints;

        // Null when `maps.routing_enabled` is off, when the provider fails, or
        // when there is no road between the points. `RouteService` caches a
        // refusal for a short while, so a trip whose coordinates have no route
        // does not re-ask a billed provider on every attempt.
        $route = $this->routes->between($fromLatitude, $fromLongitude, $toLatitude, $toLongitude);

        if ($route === null) {
            return null;
        }

        $margin = (float) $this->settings->get('tracking', 'trace_route_ceiling_percent');

        return $route->distanceKm * (1 + $margin / 100);
    }
}
