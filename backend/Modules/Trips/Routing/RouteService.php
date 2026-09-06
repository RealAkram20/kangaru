<?php

namespace Modules\Trips\Routing;

use App\Support\Observability\Trace;
use Illuminate\Support\Facades\Cache;

/**
 * Routes, cached on a snapped origin (ADR-0031 §4).
 *
 * ## The cache key is the cost control
 *
 * A driver crawling through Kampala traffic asks the same question over and
 * over, and each answer is billed. The origin is therefore **snapped to three
 * decimal places** — roughly a hundred metres — before it becomes a key, so
 * everything asked from one stretch of road resolves to one request.
 *
 * Three decimals is chosen against what the answer is *for*: a route drawn on
 * a map at city zoom, and a distance rendered to one decimal of a kilometre.
 * Neither changes meaningfully over a hundred metres. Four decimals would be
 * ten metres and would bill nearly every heartbeat; two would be a kilometre
 * and would hand a driver a route from the wrong side of a junction.
 *
 * The destination is *not* snapped. It is a fixed point for the whole trip, so
 * snapping buys nothing, and rounding a drop-off is how a route ends on the
 * wrong side of a dual carriageway.
 *
 * ## Why a short TTL rather than none
 *
 * The geometry of a road does not expire, but the traffic on it does, and the
 * duration is the half of this that goes stale. Five minutes keeps a driver's
 * repeated asks free while never showing a prediction made before the jam they
 * are now sitting in.
 */
class RouteService
{
    /** Roughly 100 m. See the class docblock — this number is the bill. */
    private const ORIGIN_PRECISION = 3;

    private const TTL_SECONDS = 300;

    public function __construct(private readonly RouteProvider $provider) {}

    public function between(
        float $fromLatitude,
        float $fromLongitude,
        float $toLatitude,
        float $toLongitude,
    ): ?Route {
        return $this->via([[$fromLatitude, $fromLongitude], [$toLatitude, $toLongitude]]);
    }

    /**
     * A road through an ordered list of points (ADR-0045 §7).
     *
     * The circuit a corporate client draws: origin, every ATM in the order
     * the officer put them in, and the last stop. Two points is the case
     * `between()` delegates here, so there is one cache, one failure path
     * and one place the provider is asked.
     *
     * @param  array<int, array{float, float}>  $points
     */
    public function via(array $points): ?Route
    {
        if (count($points) < 2) {
            return null;
        }

        /*
         * Traced, because this is the one place in a request where the
         * platform spends somebody else's money and waits on somebody else's
         * server (ADR-0054 §4).
         *
         * The SDK already records the outbound HTTP call as a span. What it
         * cannot record is the **hit rate** — a cached answer makes no HTTP
         * call, so on the waterfall it is invisible, and "we ask Google far
         * too often" and "the cache is working perfectly" look identical.
         * `cache` below is the number the class docblock's whole
         * snapped-origin argument turns on, and it has never been measured.
         */
        return Trace::span('route.lookup', 'road through '.count($points).' points', function () use ($points) {
            $key = $this->cacheKey($points);

            // A miss that the provider also declines is cached as a miss for a
            // short while, deliberately: without it, a trip whose coordinates have
            // no road between them re-asks Google on every heartbeat and is billed
            // for every refusal.
            $cached = Cache::get($key);

            if ($cached !== null) {
                Trace::annotate(['cache' => 'hit', 'has_route' => $cached !== false]);

                return $cached === false ? null : $this->fromCache($cached);
            }

            $route = $this->provider->via($points);

            Cache::put($key, $route === null ? false : $route->toArray(), self::TTL_SECONDS);

            Trace::annotate([
                'cache' => 'miss',
                'has_route' => $route !== null,
                // Which of the two providers answered, on the span rather than
                // only in config: ADR-0031's switch has been flipped in
                // production before, and once by accident.
                'provider' => $route?->provider,
                'distance_km' => $route?->distanceKm,
            ]);

            return $route;
        }, ['points' => count($points)]);
    }

    /**
     * @param  array<string, mixed>  $cached
     */
    private function fromCache(array $cached): Route
    {
        return new Route(
            polyline: (string) $cached['polyline'],
            distanceKm: (float) $cached['distance_km'],
            durationSeconds: $cached['duration_seconds'] === null
                ? null
                : (int) $cached['duration_seconds'],
            provider: (string) $cached['provider'],
        );
    }

    /**
     * The origin snapped, everything after it exact — see the class docblock
     * for why those two halves differ.
     *
     * Hashed once there are waypoints, because a 25-stop circuit's key would
     * otherwise be several hundred characters and some cache backends cap a
     * key far below that. The hash is over the *ordered* list, so reordering
     * a circuit is a different key — which it must be, since it is a
     * different drive.
     *
     * @param  array<int, array{float, float}>  $points
     */
    private function cacheKey(array $points): string
    {
        // See GoogleDirectionsProvider for why this is indexed rather than
        // shifted.
        $points = array_values($points);
        $origin = $points[0];
        $rest = array_slice($points, 1);

        $from = round($origin[0], self::ORIGIN_PRECISION).','.round($origin[1], self::ORIGIN_PRECISION);

        $tail = implode(';', array_map(
            static fn (array $point) => "{$point[0]},{$point[1]}",
            $rest,
        ));

        // Two points keeps the original key shape verbatim, so a fleet's warm
        // cache survives this change rather than being invalidated wholesale
        // on deploy.
        return count($rest) === 1
            ? "route:{$from}:{$tail}"
            : 'route:'.$from.':via:'.hash('xxh128', $tail);
    }
}
