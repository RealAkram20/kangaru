<?php

namespace Modules\Trips\Distance;

use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Modules\Administration\Services\SettingsService;
use Modules\Dispatch\Support\GreatCircle;

/**
 * OSRM as the measuring engine (ADR-0045; `docs/measured-distance-plan.md`
 * §2 Steps 2 and 3).
 *
 * The same server `Routing\OsrmProvider` draws the driver's map from — one
 * `maps.osrm_base_url` — but a different switch. `tracking.trace_matching_
 * enabled` defaults to false because that URL defaults to the project's
 * public demo, which is rate-limited and not for production; matching every
 * completed trip against it would breach their policy. The switch goes on
 * when an operator has pointed the URL at their own box, and from then on
 * every call here is free (self-hosted, no meter — the reason this path is
 * OSRM and never Google).
 *
 * ## `match`, and what its answer means
 *
 * OSRM's match service snaps a sequence of noisy pings to the road network
 * and returns one or more *matchings* — one when it could join every ping by
 * road, several when it had to break the trace where no road connects
 * consecutive fixes. The distance of each matching is road distance the
 * vehicle demonstrably covered. The jump *between* two matchings, and any
 * pings at either end that no matching claimed, are stretches the engine
 * could not measure; those are returned as `unmatchedKm` (straight-line) so
 * the measurer counts them as inferred rather than losing them.
 *
 * `radiuses` is the engine's search radius per ping, and it is told the
 * device's own accuracy figure — a fix the handset rated at 30 m may sit on
 * either of two parallel streets, and pretending it is exact makes the
 * matcher choose confidently and wrongly.
 *
 * Longitude first, as everywhere OSRM is spoken to in this codebase, and the
 * trap is the same: near the equator a swapped pair passes every range check
 * and lands in the Indian Ocean.
 *
 * Never throws. Every failure path returns null and logs a structured
 * warning; the measurer degrades and the evidence row records it.
 */
class OsrmMeasurementRouter implements MeasurementRouter
{
    /**
     * OSRM refuses a match request larger than its `--max-matching-size`,
     * which defaults to 100. The measurer chunks to this so the default works
     * everywhere; an operator who raised the flag gains nothing from bigger
     * chunks that a boundary shared between consecutive chunks does not
     * already give.
     */
    public const MAX_MATCH_POINTS = 100;

    /** When a ping carries no accuracy figure. Consumer GPS on a clear day. */
    private const DEFAULT_RADIUS_METRES = 15;

    public function __construct(private readonly SettingsService $settings) {}

    public function available(): bool
    {
        return (bool) $this->settings->get('tracking', 'trace_matching_enabled')
            && $this->baseUrl() !== '';
    }

    public function name(): string
    {
        return 'osrm';
    }

    public function match(array $points): ?MatchedChunk
    {
        if (count($points) < 2 || ! $this->available()) {
            return null;
        }

        $path = implode(';', array_map(
            fn (TracePoint $p) => "{$p->longitude},{$p->latitude}",
            $points,
        ));

        $body = $this->get("/match/v1/driving/{$path}", [
            'timestamps' => implode(';', array_map(fn (TracePoint $p) => $p->recordedAt, $points)),
            'radiuses' => implode(';', array_map(
                fn (TracePoint $p) => (int) max(1, round($p->accuracyMetres ?? self::DEFAULT_RADIUS_METRES)),
                $points,
            )),
            'geometries' => 'polyline',
            'overview' => 'full',
        ], 'match');

        if ($body === null) {
            return null;
        }

        /** @var array<int, array<string, mixed>> $matchings */
        $matchings = is_array($body['matchings'] ?? null) ? $body['matchings'] : [];
        /** @var array<int, array<string, mixed>|null> $tracepoints */
        $tracepoints = is_array($body['tracepoints'] ?? null) ? $body['tracepoints'] : [];

        if ($matchings === []) {
            return null;
        }

        $matchedMetres = 0.0;
        $polylines = [];

        foreach ($matchings as $matching) {
            $matchedMetres += (float) ($matching['distance'] ?? 0);

            if (is_string($matching['geometry'] ?? null) && $matching['geometry'] !== '') {
                $polylines[] = $matching['geometry'];
            }
        }

        return new MatchedChunk(
            matchedKm: $matchedMetres / 1000,
            unmatchedKm: $this->unmatchedKilometres($points, $tracepoints),
            polylines: $polylines,
        );
    }

    public function routeKilometres(array $waypoints): ?float
    {
        if (count($waypoints) < 2 || ! $this->available()) {
            return null;
        }

        $path = implode(';', array_map(fn (array $w) => "{$w[1]},{$w[0]}", $waypoints));

        $body = $this->get("/route/v1/driving/{$path}", ['overview' => 'false'], 'route');

        $metres = $body['routes'][0]['distance'] ?? null;

        return is_numeric($metres) ? (float) $metres / 1000 : null;
    }

    /**
     * Straight-line distance across everything the matcher did not claim:
     * the jump between consecutive matchings, plus any leading or trailing
     * pings that belong to no matching at all.
     *
     * Measured between the *input* pings rather than the snapped locations,
     * because at the ends of a break the snapped location is the engine's
     * best guess and the input is what the device actually reported.
     *
     * @param  array<int, TracePoint>  $points
     * @param  array<int, array<string, mixed>|null>  $tracepoints
     */
    private function unmatchedKilometres(array $points, array $tracepoints): float
    {
        $km = 0.0;
        $lastMatchedIndex = null;
        $lastMatchingId = null;

        foreach ($tracepoints as $i => $tracepoint) {
            if (! isset($points[$i])) {
                break;
            }

            if ($tracepoint === null) {
                continue;
            }

            $matchingId = (int) ($tracepoint['matchings_index'] ?? 0);

            if ($lastMatchedIndex === null) {
                // Leading pings no matching claimed.
                if ($i > 0) {
                    $km += $this->between($points[0], $points[$i]);
                }
            } elseif ($matchingId !== $lastMatchingId) {
                // The break between two matchings.
                $km += $this->between($points[$lastMatchedIndex], $points[$i]);
            }

            $lastMatchedIndex = $i;
            $lastMatchingId = $matchingId;
        }

        $last = count($points) - 1;

        if ($lastMatchedIndex === null) {
            // Nothing matched at all — the caller treats a null chunk as the
            // signal for that, so this only happens on a malformed body.
            return 0.0;
        }

        if ($lastMatchedIndex < $last) {
            // Trailing pings no matching claimed.
            $km += $this->between($points[$lastMatchedIndex], $points[$last]);
        }

        return $km;
    }

    private function between(TracePoint $a, TracePoint $b): float
    {
        return GreatCircle::kilometres($a->latitude, $a->longitude, $b->latitude, $b->longitude);
    }

    /**
     * One request, one verdict. OSRM answers 200 with its refusal in the
     * body (`NoMatch`, `NoRoute`, `NoSegment`, `TooBig`), so a 2xx is not
     * enough on its own.
     *
     * @param  array<string, string>  $query
     * @return array<string, mixed>|null
     */
    private function get(string $path, array $query, string $service): ?array
    {
        try {
            /** @var Response $response */
            $response = Http::timeout($service === 'match' ? 15 : 8)
                ->get($this->baseUrl().$path, $query);
        } catch (\Throwable $e) {
            Log::warning('distance.osrm_request_failed', ['service' => $service, 'message' => $e->getMessage()]);

            return null;
        }

        if (! $response->successful()) {
            Log::warning('distance.osrm_non_2xx', ['service' => $service, 'status' => $response->status()]);

            return null;
        }

        /** @var array<string, mixed> $body */
        $body = $response->json() ?? [];
        $code = is_string($body['code'] ?? null) ? $body['code'] : 'Unknown';

        if ($code !== 'Ok') {
            // Informational rather than a warning: `NoMatch` on a chunk in
            // the bush is the expected way of learning the map lacks the road.
            Log::info('distance.osrm_declined', ['service' => $service, 'code' => $code]);

            return null;
        }

        return $body;
    }

    private function baseUrl(): string
    {
        return rtrim((string) $this->settings->get('maps', 'osrm_base_url'), '/');
    }
}
