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

    /**
     * @param  array<int, array{float, float}>  $points
     */
    public function via(array $points): ?Route
    {
        if (count($points) < 2) {
            return null;
        }

        // Both halves: the switch and the credential. `routingConfigured()`
        // is the one place that knows, because `all()` never returns the key.
        if (! $this->settings->routingConfigured()) {
            return null;
        }

        $key = $this->settings->secret('maps', 'api_key');

        if ($key === null) {
            return null;
        }

        // Indexed off a list rather than `array_shift`/`array_pop`, which
        // return a nullable even when the count has just been checked.
        $points = array_values($points);
        $origin = $points[0];
        $destination = $points[count($points) - 1];
        $waypoints = array_slice($points, 1, -1);

        $query = [
            'origin' => "{$origin[0]},{$origin[1]}",
            'destination' => "{$destination[0]},{$destination[1]}",
            // Driving, and departing now — which is what makes the
            // duration a traffic prediction rather than a free-flow
            // figure. Without it Google returns the empty-road time,
            // which in Kampala at five o'clock is fiction.
            'mode' => 'driving',
            'departure_time' => 'now',
            'key' => $key,
        ];

        if ($waypoints !== []) {
            // **No `optimize:true` prefix, deliberately.** Google will happily
            // reorder waypoints to shorten the drive and ADR-0045 §7 refuses
            // it: a cash run's sequence is decided by which ATM is empty and
            // which is safe at which hour, not by total kilometres.
            $query['waypoints'] = implode('|', array_map(
                static fn (array $point) => "{$point[0]},{$point[1]}",
                $waypoints,
            ));
        }

        try {
            $response = Http::timeout(6)->get(self::ENDPOINT, $query);
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

        $legs = $body['routes'][0]['legs'] ?? null;
        $polyline = $body['routes'][0]['overview_polyline']['points'] ?? null;

        if (! is_array($legs) || $legs === [] || ! is_string($polyline) || $polyline === '') {
            return null;
        }

        $metres = 0.0;

        foreach ($legs as $leg) {
            $value = is_array($leg) ? ($leg['distance']['value'] ?? null) : null;

            // One unmeasurable leg makes the whole circuit unmeasurable.
            // Summing the rest would state a distance shorter than the drive,
            // which is the understatement ADR-0031 exists to stop.
            if (! is_numeric($value)) {
                return null;
            }

            $metres += (float) $value;
        }

        return new Route(
            polyline: $polyline,
            distanceKm: $metres / 1000,
            durationSeconds: $this->totalSeconds($legs),
            provider: 'google',
        );
    }

    /**
     * The circuit's duration, or null if any leg has none.
     *
     * ADR-0031 §6 forbids deriving a duration, and a partial sum is a
     * derivation wearing a total's clothes: it would read as "the whole run"
     * while describing six legs of seven.
     *
     * @param  array<int, mixed>  $legs
     */
    private function totalSeconds(array $legs): ?int
    {
        $total = 0;

        foreach ($legs as $leg) {
            if (! is_array($leg)) {
                return null;
            }

            $seconds = $this->seconds($leg);

            if ($seconds === null) {
                return null;
            }

            $total += $seconds;
        }

        return $total;
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
