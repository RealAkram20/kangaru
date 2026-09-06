<?php

namespace Modules\Trips\Distance;

use Modules\Dispatch\Support\GreatCircle;

/**
 * Step 2 of the measured-distance algorithm: how far the vehicle went,
 * according to its trace (`docs/measured-distance-plan.md` §2, ADR-0045).
 *
 * Cleans, splits the kept pings into runs wherever the device fell silent
 * for longer than `gap_seconds`, snaps each run to the road network in
 * chunks the engine accepts, and routes across the gaps between runs. What
 * the engine measured is `matchedKm`; what had to be routed or straight-lined
 * is `inferredKm`; and the share of the second in the total is one of the
 * bars the resolver holds a trace to.
 *
 * ## When the engine is not there
 *
 * `MeasurementRouter::available()` false — switched off, or no URL — is the
 * ordinary state of a fresh deployment, so it is not an error path. The
 * measurer falls back to the crow-flight sum over kept pings, records the
 * whole of it as inferred and the provider as `haversine`, and the resolver
 * grades accordingly. Nothing is billed from that in any policy; the
 * shadow report simply shows an operator what switching the engine on would
 * buy them.
 *
 * ## Coverage is skew-tolerant on purpose
 *
 * `trips.started_at` is the server's clock; `recorded_at` is the handset's.
 * They differ, sometimes by minutes. So coverage is not "presence between
 * started_at and completed_at" — a two-minute skew would read as a
 * two-minute dead zone at each end. It is the presence *span* less the gaps
 * inside it, over the longer of that span and the trip's duration. A trace
 * that started late or stopped early still loses coverage (its span is
 * shorter than the trip); a trace whose clock is merely offset does not.
 */
class TraceMeasurer
{
    public function __construct(
        private readonly TraceCleaner $cleaner,
        private readonly MeasurementRouter $router,
    ) {}

    /**
     * @param  array<int, TracePoint>  $raw  every ping on the trip, in recorded order
     * @param  int|null  $tripStartedAt  Unix seconds, server clock; null when the trip never started
     * @param  int|null  $tripCompletedAt  Unix seconds, server clock
     */
    public function measure(array $raw, ?int $tripStartedAt, ?int $tripCompletedAt, DistanceThresholds $thresholds): MeasuredTrace
    {
        $cleaned = $this->cleaner->clean($raw, $thresholds);
        $points = $cleaned->points;
        $haversine = $this->haversineOver($points);
        $coverage = $this->coverage($cleaned->presence, $tripStartedAt, $tripCompletedAt, $thresholds->gapSeconds);
        $engine = $this->router->available();
        $provider = $engine ? $this->router->name() : 'haversine';

        if (count($points) < 2) {
            return new MeasuredTrace(
                cleaned: $cleaned,
                gpsKm: null,
                matchedKm: 0.0,
                inferredKm: 0.0,
                haversineKm: $haversine,
                coveragePercent: $coverage,
                inferredSharePercent: null,
                gapsRouted: 0,
                provider: $provider,
                polylines: [],
            );
        }

        if (! $engine) {
            return new MeasuredTrace(
                cleaned: $cleaned,
                gpsKm: round($haversine, 2),
                matchedKm: 0.0,
                inferredKm: $haversine,
                haversineKm: $haversine,
                coveragePercent: $coverage,
                inferredSharePercent: $haversine > 0 ? 100.0 : 0.0,
                gapsRouted: 0,
                provider: $provider,
                polylines: [],
            );
        }

        $matched = 0.0;
        $inferred = 0.0;
        $gapsRouted = 0;
        $polylines = [];

        [$runs, $gaps] = $this->split($points, $thresholds->gapSeconds);

        foreach ($runs as $run) {
            foreach ($this->chunks($run) as $chunk) {
                $result = $this->router->match($chunk);

                if ($result !== null) {
                    $matched += $result->matchedKm;
                    $inferred += $result->unmatchedKm;
                    array_push($polylines, ...$result->polylines);

                    continue;
                }

                // The engine could not match this chunk at all — typically a
                // road the map lacks. Its ends are still two positions the
                // vehicle was at, so the road between them is the best
                // available figure, and failing that the straight line.
                $inferred += $this->legKilometres($chunk[0], $chunk[count($chunk) - 1], $thresholds, $gapsRouted);
            }
        }

        foreach ($gaps as [$from, $to]) {
            $inferred += $this->legKilometres($from, $to, $thresholds, $gapsRouted);
        }

        $gps = $matched + $inferred;

        return new MeasuredTrace(
            cleaned: $cleaned,
            gpsKm: round($gps, 2),
            matchedKm: $matched,
            inferredKm: $inferred,
            haversineKm: $haversine,
            coveragePercent: $coverage,
            inferredSharePercent: $gps > 0 ? round($inferred / $gps * 100, 2) : 0.0,
            gapsRouted: $gapsRouted,
            provider: $provider,
            polylines: $polylines,
        );
    }

    /**
     * Distance for a stretch the engine did not match: the road between its
     * ends when the stretch is longer than the receiver's own accuracy, the
     * straight line otherwise — below that scale there is no road worth
     * asking about, and a parked vehicle's two kept pings must not cost a
     * request each.
     */
    private function legKilometres(TracePoint $from, TracePoint $to, DistanceThresholds $t, int &$gapsRouted): float
    {
        $straight = GreatCircle::kilometres($from->latitude, $from->longitude, $to->latitude, $to->longitude);

        if ($straight * 1000 <= $t->maxPingAccuracyMetres) {
            return $straight;
        }

        $routed = $this->router->routeKilometres([[$from->latitude, $from->longitude], [$to->latitude, $to->longitude]]);

        if ($routed === null) {
            return $straight;
        }

        $gapsRouted++;

        // A road shorter than the crow's flight is a routing answer to a
        // different question (a snapped endpoint on the far side of a
        // carriageway); the straight line is the floor.
        return max($routed, $straight);
    }

    /**
     * Runs of consecutive pings, split where the device fell silent, and the
     * gaps between them.
     *
     * @param  array<int, TracePoint>  $points
     * @return array{0: array<int, array<int, TracePoint>>, 1: array<int, array{0: TracePoint, 1: TracePoint}>}
     */
    private function split(array $points, int $gapSeconds): array
    {
        $runs = [];
        $gaps = [];
        $current = [$points[0]];

        for ($i = 1, $n = count($points); $i < $n; $i++) {
            $previous = $points[$i - 1];
            $point = $points[$i];

            if ($point->recordedAt - $previous->recordedAt > $gapSeconds) {
                $runs[] = $current;
                $gaps[] = [$previous, $point];
                $current = [];
            }

            $current[] = $point;
        }

        $runs[] = $current;

        return [$runs, $gaps];
    }

    /**
     * Chunks the engine will accept, each sharing its first point with the
     * previous chunk's last so no leg is lost at a boundary. A run of one
     * point yields nothing: it has no legs of its own, and its distance to
     * its neighbours is in the gaps either side.
     *
     * @param  array<int, TracePoint>  $run
     * @return iterable<int, array<int, TracePoint>>
     */
    private function chunks(array $run): iterable
    {
        $n = count($run);

        if ($n < 2) {
            return;
        }

        $size = OsrmMeasurementRouter::MAX_MATCH_POINTS;

        for ($start = 0; $start < $n - 1; $start += $size - 1) {
            yield array_slice($run, $start, $size);
        }
    }

    /**
     * @param  array<int, TracePoint>  $points
     */
    private function haversineOver(array $points): float
    {
        $km = 0.0;

        for ($i = 1, $n = count($points); $i < $n; $i++) {
            $km += GreatCircle::kilometres(
                $points[$i - 1]->latitude,
                $points[$i - 1]->longitude,
                $points[$i]->latitude,
                $points[$i]->longitude,
            );
        }

        return $km;
    }

    /**
     * @param  array<int, int>  $presence  Unix seconds of every non-mock ping, in order
     */
    private function coverage(array $presence, ?int $startedAt, ?int $completedAt, int $gapSeconds): ?float
    {
        if ($startedAt === null || $completedAt === null) {
            return null;
        }

        $duration = max(0, $completedAt - $startedAt);

        if ($presence === []) {
            return 0.0;
        }

        $span = $presence[count($presence) - 1] - $presence[0];
        $silent = 0;

        for ($i = 1, $n = count($presence); $i < $n; $i++) {
            $dt = $presence[$i] - $presence[$i - 1];

            if ($dt > $gapSeconds) {
                $silent += $dt;
            }
        }

        $denominator = max($duration, $span);

        // A trip and a trace that both fit inside one second have nothing to
        // measure coverage over. Null — no figure — rather than a division.
        if ($denominator === 0) {
            return null;
        }

        return round(min(100.0, max(0, $span - $silent) / $denominator * 100), 2);
    }
}
