<?php

namespace Modules\Dispatch\Support;

/**
 * Straight-line distance between two points on the earth.
 *
 * Extracted when `WalkInRecommender` needed the same arithmetic
 * `DispatchRecommender` already had. One copy rather than two, because the
 * two rankings must agree about what "0.4 km away" means — a walk-in ride
 * and a corporate booking dispatched from the same stage, ranked by
 * subtly different formulas, would be a difference nobody could explain and
 * everybody would eventually notice.
 *
 * **Not road distance**, and this is the same limitation ADR-0020 §3
 * recorded: road distance needs Mapbox's Directions API, which is unbuilt
 * and metered. At Kampala's scale the two agree closely enough to *rank* by,
 * and both callers are ranking rather than promising an arrival time.
 */
final class GreatCircle
{
    /** Mean earth radius, kilometres. */
    private const EARTH_RADIUS_KM = 6371.0088;

    public static function kilometres(float $lat1, float $lon1, float $lat2, float $lon2): float
    {
        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lon2 - $lon1);

        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) ** 2;

        // `min(1.0, …)` guards the arcsine against a floating-point result
        // marginally above 1 for two identical points, which is a domain
        // error rather than a distance of zero.
        return self::EARTH_RADIUS_KM * 2 * asin(min(1.0, sqrt($a)));
    }
}
