<?php

namespace Tests\Support;

use Illuminate\Support\Carbon;
use Modules\Trips\Services\TripRouteRecorder;

/**
 * Builds GPS traces whose length is known in advance.
 *
 * Random coordinates would produce a route whose distance nobody can assert
 * against, so tests would end up asserting whatever the calculator happened
 * to return — a test that agrees with the code by construction. Instead
 * these lay points due east along a line of latitude, where the distance per
 * degree is a closed form, so the expected kilometres are arithmetic rather
 * than an oracle.
 */
class GpsFixtures
{
    /** Central Kampala. */
    public const START_LAT = 0.3152;

    public const START_LNG = 32.5816;

    private const EARTH_RADIUS_METRES = 6_371_008.8;

    /**
     * Records `$points` pings spaced `$metresApart` due east, and returns
     * the straight-line distance they cover in kilometres.
     *
     * Spacing is in metres so a caller can stay above or below the noise
     * floor deliberately — see the jitter test.
     */
    public static function straightLine(
        int $tenantId,
        int $tripId,
        int $points,
        float $metresApart,
        ?Carbon $startingAt = null,
    ): float {
        $startingAt ??= Carbon::now()->subHour();
        $pings = [];

        // Metres per degree of longitude shrinks with latitude; at 0.3152°
        // the cosine term is ~0.9999849, which matters at the metre scale
        // the assertions work to.
        $metresPerDegree = deg2rad(1) * self::EARTH_RADIUS_METRES * cos(deg2rad(self::START_LAT));
        $step = $metresApart / $metresPerDegree;

        for ($i = 0; $i < $points; $i++) {
            $pings[] = [
                'latitude' => number_format(self::START_LAT, 7, '.', ''),
                'longitude' => number_format(self::START_LNG + ($i * $step), 7, '.', ''),
                'recorded_at' => $startingAt->copy()->addSeconds($i * 10)->toDateTimeString(),
                'speed_kph' => '40.00',
            ];
        }

        app(TripRouteRecorder::class)->record($tenantId, $tripId, $pings);

        return round(($points - 1) * $metresApart / 1000, 2);
    }

    /**
     * Records `$points` pings that all sit within `$jitterMetres` of one
     * spot — a vehicle parked with its tracker running.
     *
     * The calculator should report this as no distance travelled. Without a
     * noise floor it reports the sum of the wander, which is exactly the
     * failure mode that would inflate a billed distance.
     */
    public static function stationaryJitter(
        int $tenantId,
        int $tripId,
        int $points,
        float $jitterMetres,
        ?Carbon $startingAt = null,
    ): void {
        $startingAt ??= Carbon::now()->subHour();
        $pings = [];

        $metresPerDegree = deg2rad(1) * self::EARTH_RADIUS_METRES * cos(deg2rad(self::START_LAT));
        $step = $jitterMetres / $metresPerDegree;

        for ($i = 0; $i < $points; $i++) {
            // Alternating either side of the same point: consecutive hops
            // are `$jitterMetres` apart but the vehicle never leaves.
            $offset = ($i % 2 === 0) ? 0.0 : $step;

            $pings[] = [
                'latitude' => number_format(self::START_LAT, 7, '.', ''),
                'longitude' => number_format(self::START_LNG + $offset, 7, '.', ''),
                'recorded_at' => $startingAt->copy()->addSeconds($i * 10)->toDateTimeString(),
                'speed_kph' => '0.00',
            ];
        }

        app(TripRouteRecorder::class)->record($tenantId, $tripId, $pings);
    }
}
