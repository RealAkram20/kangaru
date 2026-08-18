<?php

namespace Modules\Trips\Routing;

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
        $key = $this->cacheKey($fromLatitude, $fromLongitude, $toLatitude, $toLongitude);

        // A miss that the provider also declines is cached as a miss for a
        // short while, deliberately: without it, a trip whose coordinates have
        // no road between them re-asks Google on every heartbeat and is billed
        // for every refusal.
        $cached = Cache::get($key);

        if ($cached !== null) {
            return $cached === false ? null : $this->fromCache($cached);
        }

        $route = $this->provider->route($fromLatitude, $fromLongitude, $toLatitude, $toLongitude);

        Cache::put($key, $route === null ? false : $route->toArray(), self::TTL_SECONDS);

        return $route;
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

    private function cacheKey(float $fromLat, float $fromLng, float $toLat, float $toLng): string
    {
        $from = round($fromLat, self::ORIGIN_PRECISION).','.round($fromLng, self::ORIGIN_PRECISION);

        return "route:{$from}:{$toLat},{$toLng}";
    }
}
