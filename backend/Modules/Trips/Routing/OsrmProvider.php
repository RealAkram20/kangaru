<?php

namespace Modules\Trips\Routing;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Modules\Administration\Services\SettingsService;

/**
 * OSRM — open-source routing, no key, no meter (ADR-0031 §2).
 *
 * ## Why this exists alongside Google
 *
 * ADR-0031 records that self-hosted OSRM was offered and Google chosen for its
 * traffic data. This is not a reversal of that: it is the answer to a question the
 * decision did not cover — **what draws the route before anyone has opened a
 * billing account.**
 *
 * The straight dashed line is honest and it is also, in a driver's words, not
 * helping. On the Misindye-to-Acacia run it says 14.3 km where the road is
 * 19.8 — a 39% understatement, and a shape that follows no street. OSRM turns
 * that into a real route immediately, for nothing, which makes it the right
 * default and Google the upgrade.
 *
 * ## What it does not have
 *
 * **Traffic.** OSRM routes on road geometry and speed limits, so its duration
 * is a free-flow figure — optimistic in Kampala at five o'clock. That is the
 * whole of what the Google key buys, and it is why `routing_provider` is a
 * setting rather than a constant.
 *
 * ## The default server is for development
 *
 * `router.project-osrm.org` is the project's public demo. It is rate-limited
 * and **explicitly not for production** under OSRM's own usage policy. Before
 * a real fleet leans on this, run one: a Docker container and the Uganda
 * extract from Geofabrik, then change `maps.osrm_base_url` — which is the only
 * thing that changes.
 *
 * ## Nothing here throws
 *
 * The same contract `GoogleDirectionsProvider` holds, for the same reason: a
 * third-party HTTP call made on behalf of a screen somebody is reading in
 * traffic. Every failure is `null`, which the app draws as the dashed direct
 * line (ADR-0031 §3).
 */
class OsrmProvider implements RouteProvider
{
    public function __construct(private readonly SettingsService $settings) {}

    public function route(
        float $fromLatitude,
        float $fromLongitude,
        float $toLatitude,
        float $toLongitude,
    ): ?Route {
        if (! $this->settings->routingConfigured()) {
            return null;
        }

        $base = rtrim((string) $this->settings->get('maps', 'osrm_base_url'), '/');

        if ($base === '') {
            return null;
        }

        // Longitude first, and the order is the trap. OSRM takes `lng,lat` —
        // the opposite of everything else in this codebase — and Uganda sits
        // near the equator, so a swap passes every range check either number
        // could face and routes somewhere in the Indian Ocean.
        $path = "{$fromLongitude},{$fromLatitude};{$toLongitude},{$toLatitude}";

        try {
            $response = Http::timeout(6)->get("{$base}/route/v1/driving/{$path}", [
                // The full shape rather than the simplified one: this is drawn
                // on a map a driver can pinch into, and `simplified` drops the
                // detail exactly where they need it.
                'overview' => 'full',
                // Precision-5 encoded polyline — the same encoding Google
                // uses, so the app's decoder is shared rather than forked.
                'geometries' => 'polyline',
            ]);
        } catch (\Throwable $e) {
            Log::warning('OSRM request failed', ['message' => $e->getMessage()]);

            return null;
        }

        if (! $response->successful()) {
            Log::warning('OSRM returned a non-2xx', ['status' => $response->status()]);

            return null;
        }

        /** @var array<string, mixed> $body */
        $body = $response->json() ?? [];

        // Like Google, OSRM answers 200 with its verdict in the body:
        // `NoRoute` for two points with no road between them.
        $code = is_string($body['code'] ?? null) ? $body['code'] : 'Unknown';

        if ($code !== 'Ok') {
            Log::warning('OSRM declined', ['code' => $code]);

            return null;
        }

        $route = $body['routes'][0] ?? null;

        if (! is_array($route)) {
            return null;
        }

        $polyline = $route['geometry'] ?? null;
        $metres = $route['distance'] ?? null;

        if (! is_string($polyline) || $polyline === '' || ! is_numeric($metres)) {
            return null;
        }

        $seconds = $route['duration'] ?? null;

        return new Route(
            polyline: $polyline,
            distanceKm: (float) $metres / 1000,
            // Rounded rather than truncated, and free-flow rather than
            // predicted — see the class docblock. Still the provider's own
            // number: nothing here derives it (ADR-0031 §6).
            durationSeconds: is_numeric($seconds) ? (int) round((float) $seconds) : null,
            provider: 'osrm',
        );
    }
}
