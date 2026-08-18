<?php

namespace Modules\Trips\Routing;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Modules\Administration\Services\SettingsService;

/**
 * Google Directions (ADR-0031 §2).
 *
 * ## Nothing here throws, and that is the contract
 *
 * `ExpoPushChannel` states the same rule for the same reason: this is a
 * third-party HTTP call made on behalf of a screen somebody is reading in
 * traffic. A quota rejection, a DNS failure or a malformed body must all come
 * back as `null`, which the app draws as the dashed direct line it drew before
 * any of this existed (ADR-0031 §3).
 *
 * A failure is logged rather than swallowed silently — an operator paying per
 * request deserves to find out that none of them are succeeding.
 *
 * ## The key is read per call
 *
 * Not held, not cached, not read at boot. `SettingsService::secret()` decrypts
 * on demand, so rotating the key in System Settings takes effect on the next
 * request rather than the next deploy — and the same read is what makes
 * turning the switch off actually stop the spend.
 */
class GoogleDirectionsProvider implements RouteProvider
{
    private const ENDPOINT = 'https://maps.googleapis.com/maps/api/directions/json';

    public function __construct(private readonly SettingsService $settings) {}

    public function route(
        float $fromLatitude,
        float $fromLongitude,
        float $toLatitude,
        float $toLongitude,
    ): ?Route {
        // Both halves: the switch and the credential. `routingConfigured()`
        // is the one place that knows, because `all()` never returns the key.
        if (! $this->settings->routingConfigured()) {
            return null;
        }

        $key = $this->settings->secret('maps', 'api_key');

        if ($key === null) {
            return null;
        }

        try {
            $response = Http::timeout(6)->get(self::ENDPOINT, [
                'origin' => "{$fromLatitude},{$fromLongitude}",
                'destination' => "{$toLatitude},{$toLongitude}",
                // Driving, and departing now — which is what makes the
                // duration a traffic prediction rather than a free-flow
                // figure. Without it Google returns the empty-road time,
                // which in Kampala at five o'clock is fiction.
                'mode' => 'driving',
                'departure_time' => 'now',
                'key' => $key,
            ]);
        } catch (\Throwable $e) {
            // A timeout or a DNS failure. The map falls back; the trip does
            // not care.
            Log::warning('Directions request failed', ['message' => $e->getMessage()]);

            return null;
        }

        if (! $response->successful()) {
            Log::warning('Directions returned a non-2xx', ['status' => $response->status()]);

            return null;
        }

        /** @var array<string, mixed> $body */
        $body = $response->json() ?? [];

        // Google answers 200 with a status string in the body — `ZERO_RESULTS`
        // for two points with no road between them, `OVER_QUERY_LIMIT` when
        // the bill has run out. Both are 200s, and treating an HTTP code as
        // the answer is how a quota failure becomes a blank map nobody can
        // explain.
        $status = is_string($body['status'] ?? null) ? $body['status'] : 'UNKNOWN';

        if ($status !== 'OK') {
            Log::warning('Directions declined', ['status' => $status]);

            return null;
        }

        $leg = $body['routes'][0]['legs'][0] ?? null;
        $polyline = $body['routes'][0]['overview_polyline']['points'] ?? null;

        if (! is_array($leg) || ! is_string($polyline) || $polyline === '') {
            return null;
        }

        $metres = $leg['distance']['value'] ?? null;

        if (! is_numeric($metres)) {
            return null;
        }

        return new Route(
            polyline: $polyline,
            distanceKm: (float) $metres / 1000,
            // `duration_in_traffic` when the departure time bought us one,
            // falling back to the free-flow figure. **Null if neither is
            // there** — ADR-0031 §6 forbids deriving one, and a missing
            // duration means the screen shows no minutes rather than minutes
            // somebody made up.
            durationSeconds: $this->seconds($leg),
            provider: 'google',
        );
    }

    /**
     * @param  array<string, mixed>  $leg
     */
    private function seconds(array $leg): ?int
    {
        foreach (['duration_in_traffic', 'duration'] as $field) {
            $value = $leg[$field]['value'] ?? null;

            if (is_numeric($value)) {
                return (int) $value;
            }
        }

        return null;
    }
}
