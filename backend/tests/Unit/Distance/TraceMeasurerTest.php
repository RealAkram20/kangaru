<?php

use Modules\Dispatch\Support\GreatCircle;
use Modules\Trips\Distance\DistanceThresholds;
use Modules\Trips\Distance\MatchedChunk;
use Modules\Trips\Distance\MeasurementRouter;
use Modules\Trips\Distance\OsrmMeasurementRouter;
use Modules\Trips\Distance\TraceCleaner;
use Modules\Trips\Distance\TraceMeasurer;
use Modules\Trips\Distance\TracePoint;

/**
 * Step 2 of the measured-distance algorithm — chunking, gaps, coverage and
 * the fallback — against a scripted engine (ADR-0045).
 *
 * The engine here is a stand-in whose answers are arithmetic on the input:
 * a matched chunk is 10 % longer than its crow-flight (a road), a routed leg
 * 20 % longer. That makes every expected figure computable by hand while
 * still exercising the measurer's bookkeeping, which is what this file is
 * about. The real engine's HTTP is covered in Feature.
 */
class ScriptedRouter implements MeasurementRouter
{
    /** @var array<int, array<int, TracePoint>> */
    public array $matchCalls = [];

    /** @var array<int, array<int, array{0: float, 1: float}>> */
    public array $routeCalls = [];

    /** @var array<int, int> recordedAt values whose chunk should fail to match */
    public array $unmatchable = [];

    public bool $routeFails = false;

    public function __construct(public bool $up = true) {}

    public function available(): bool
    {
        return $this->up;
    }

    public function name(): string
    {
        return 'scripted';
    }

    public function match(array $points): ?MatchedChunk
    {
        $this->matchCalls[] = $points;

        foreach ($points as $p) {
            if (in_array($p->recordedAt, $this->unmatchable, true)) {
                return null;
            }
        }

        $km = 0.0;

        for ($i = 1, $n = count($points); $i < $n; $i++) {
            $km += GreatCircle::kilometres($points[$i - 1]->latitude, $points[$i - 1]->longitude, $points[$i]->latitude, $points[$i]->longitude);
        }

        return new MatchedChunk(matchedKm: $km * 1.1, unmatchedKm: 0.0, polylines: ['poly'.count($this->matchCalls)]);
    }

    public function routeKilometres(array $waypoints): ?float
    {
        $this->routeCalls[] = $waypoints;

        if ($this->routeFails) {
            return null;
        }

        $km = 0.0;

        for ($i = 1, $n = count($waypoints); $i < $n; $i++) {
            $km += GreatCircle::kilometres($waypoints[$i - 1][0], $waypoints[$i - 1][1], $waypoints[$i][0], $waypoints[$i][1]);
        }

        return $km * 1.2;
    }
}

function measurerPoint(float $lngOffset, int $t, bool $mock = false): TracePoint
{
    return new TracePoint(latitude: 0.0, longitude: 32.5 + $lngOffset, recordedAt: 1_700_000_000 + $t, isMock: $mock);
}

/**
 * $count pings ten seconds and 0.001° (~111 m) apart, starting at $t0
 * seconds and $lng0 degrees.
 *
 * @return array<int, TracePoint>
 */
function drive(int $count, int $t0 = 0, float $lng0 = 0.0): array
{
    return array_map(fn (int $i) => measurerPoint($lng0 + $i * 0.001, $t0 + $i * 10), range(0, $count - 1));
}

function measure(array $points, ScriptedRouter $router, ?DistanceThresholds $t = null, ?int $start = null, ?int $end = null)
{
    $t ??= DistanceThresholds::defaults();
    $start ??= 1_700_000_000;
    $end ??= $points === [] ? $start + 1 : $points[count($points) - 1]->recordedAt;

    return (new TraceMeasurer(new TraceCleaner, $router))->measure($points, $start, $end, $t);
}

/** Crow-flight over consecutive points, for expected values. */
function crow(array $points): float
{
    $km = 0.0;

    for ($i = 1, $n = count($points); $i < $n; $i++) {
        $km += GreatCircle::kilometres($points[$i - 1]->latitude, $points[$i - 1]->longitude, $points[$i]->latitude, $points[$i]->longitude);
    }

    return $km;
}

it('matches a clean drive in one chunk and infers nothing', function () {
    $router = new ScriptedRouter;
    $points = drive(30);

    $m = measure($points, $router);

    expect($router->matchCalls)->toHaveCount(1)
        ->and($router->routeCalls)->toHaveCount(0)
        ->and($m->matchedKm)->toEqualWithDelta(crow($points) * 1.1, 0.0001)
        ->and($m->inferredKm)->toBe(0.0)
        ->and($m->gpsKm)->toBe(round(crow($points) * 1.1, 2))
        ->and($m->inferredSharePercent)->toBe(0.0)
        ->and($m->coveragePercent)->toBe(100.0)
        ->and($m->provider)->toBe('scripted')
        ->and($m->polylines)->toBe(['poly1'])
        ->and($m->haversineKm)->toEqualWithDelta(crow($points), 0.0001);
});

it('chunks a long run at the engine limit, sharing the boundary point so no leg is lost', function () {
    $router = new ScriptedRouter;
    $points = drive(250);

    $m = measure($points, $router);

    // 250 points, chunks of 100 sharing one point: [0..99], [99..198], [198..249].
    expect($router->matchCalls)->toHaveCount(3)
        ->and(count($router->matchCalls[0]))->toBe(OsrmMeasurementRouter::MAX_MATCH_POINTS)
        ->and($router->matchCalls[1][0])->toBe($router->matchCalls[0][99])
        ->and(count($router->matchCalls[2]))->toBe(52)
        // Every one of the 249 legs was matched exactly once.
        ->and($m->matchedKm)->toEqualWithDelta(crow($points) * 1.1, 0.0001);
});

it('splits the trace where the device fell silent and routes the gap as inferred', function () {
    $router = new ScriptedRouter;
    // Ten minutes of silence, four kilometres apart: a dead zone.
    $before = drive(20);
    $after = drive(20, t0: 190 + 600, lng0: 0.019 + 0.036);
    $points = [...$before, ...$after];

    $m = measure($points, $router);

    $gapKm = GreatCircle::kilometres(0.0, 32.5 + 0.019, 0.0, 32.5 + 0.055);

    expect($router->matchCalls)->toHaveCount(2)
        ->and($router->routeCalls)->toHaveCount(1)
        ->and($m->gapsRouted)->toBe(1)
        ->and($m->inferredKm)->toEqualWithDelta($gapKm * 1.2, 0.0001)
        ->and($m->matchedKm)->toEqualWithDelta((crow($before) + crow($after)) * 1.1, 0.0001)
        // The gap is ten of the ~twenty-three minutes: coverage well below
        // full, and the inferred share is the routed gap over everything.
        ->and($m->coveragePercent)->toBeLessThan(60.0)
        ->and($m->inferredSharePercent)->toEqualWithDelta($m->inferredKm / ($m->matchedKm + $m->inferredKm) * 100, 0.01);
});

it('does not route a gap shorter than the receiver accuracy — a parked vehicle costs no request', function () {
    $router = new ScriptedRouter;
    // Drive, park for ten minutes (no pings kept — but no gap in the
    // cleaned points either, because parked jitter is dropped), drive on
    // from ~20 m away.
    $before = drive(10);
    $after = drive(10, t0: 90 + 600, lng0: 0.009 + 0.0002);
    $points = [...$before, ...$after];

    $m = measure($points, $router);

    expect($router->routeCalls)->toHaveCount(0)
        ->and($m->gapsRouted)->toBe(0)
        // The 22 m hop is added as straight line, as inferred.
        ->and($m->inferredKm)->toEqualWithDelta(GreatCircle::kilometres(0.0, 32.5 + 0.009, 0.0, 32.5 + 0.0092), 0.0001);
});

it('falls back to the straight line when the engine cannot route a gap', function () {
    $router = new ScriptedRouter;
    $router->routeFails = true;
    $before = drive(20);
    $after = drive(20, t0: 190 + 600, lng0: 0.055);
    $points = [...$before, ...$after];

    $m = measure($points, $router);

    $gapKm = GreatCircle::kilometres(0.0, 32.5 + 0.019, 0.0, 32.5 + 0.055);

    expect($router->routeCalls)->toHaveCount(1)
        ->and($m->gapsRouted)->toBe(0)
        ->and($m->inferredKm)->toEqualWithDelta($gapKm, 0.0001);
});

it('routes between the ends of a chunk the engine could not match, and counts it as inferred', function () {
    $router = new ScriptedRouter;
    $points = drive(30);
    $router->unmatchable = [$points[5]->recordedAt];

    $m = measure($points, $router);

    expect($router->matchCalls)->toHaveCount(1)
        ->and($router->routeCalls)->toHaveCount(1)
        ->and($m->matchedKm)->toBe(0.0)
        ->and($m->inferredKm)->toEqualWithDelta(crow([$points[0], $points[29]]) * 1.2, 0.0001)
        ->and($m->inferredSharePercent)->toBe(100.0);
});

it('never routes a leg shorter than the straight line between its ends', function () {
    // The engine answers 20 % *shorter* than the crow's flight — a snapped
    // endpoint on the far side of a carriageway. The straight line is the
    // floor.
    $router = new class extends ScriptedRouter
    {
        public function routeKilometres(array $waypoints): ?float
        {
            $this->routeCalls[] = $waypoints;

            return GreatCircle::kilometres($waypoints[0][0], $waypoints[0][1], $waypoints[1][0], $waypoints[1][1]) * 0.8;
        }
    };
    $before = drive(20);
    $after = drive(20, t0: 190 + 600, lng0: 0.055);

    $m = measure([...$before, ...$after], $router);

    expect($m->inferredKm)->toEqualWithDelta(GreatCircle::kilometres(0.0, 32.5 + 0.019, 0.0, 32.5 + 0.055), 0.0001);
});

it('measures by haversine, all of it inferred, when the engine is unavailable', function () {
    $router = new ScriptedRouter(up: false);
    $points = drive(30);

    $m = measure($points, $router);

    expect($router->matchCalls)->toHaveCount(0)
        ->and($router->routeCalls)->toHaveCount(0)
        ->and($m->provider)->toBe('haversine')
        ->and($m->matchedKm)->toBe(0.0)
        ->and($m->inferredKm)->toEqualWithDelta(crow($points), 0.0001)
        ->and($m->gpsKm)->toBe(round(crow($points), 2))
        ->and($m->inferredSharePercent)->toBe(100.0)
        ->and($m->coveragePercent)->toBe(100.0);
});

it('reports no distance — null, not zero — for fewer than two usable pings', function () {
    $router = new ScriptedRouter;

    $one = measure([measurerPoint(0.0, 0)], $router, end: 1_700_000_000 + 600);
    $none = measure([], $router, end: 1_700_000_000 + 600);
    $allMock = measure([measurerPoint(0.0, 0, mock: true), measurerPoint(0.001, 10, mock: true)], $router, end: 1_700_000_000 + 600);

    expect($one->gpsKm)->toBeNull()
        ->and($none->gpsKm)->toBeNull()
        ->and($allMock->gpsKm)->toBeNull()
        ->and($allMock->cleaned->droppedFor('mock'))->toBe(2)
        ->and($router->matchCalls)->toHaveCount(0);
});

it('reports zero — not null — for a vehicle that pinged but did not move', function () {
    $router = new ScriptedRouter;
    // Two kept pings 6 m apart (above the noise floor, below the accuracy
    // threshold), then nothing.
    $points = [measurerPoint(0.0, 0), measurerPoint(0.00006, 10)];

    $m = measure($points, $router, end: 1_700_000_000 + 10);

    expect($m->gpsKm)->not->toBeNull()
        ->and($m->gpsKm)->toBeLessThan(0.02);
});

it('computes coverage from presence, tolerant of the handset clock being offset', function () {
    $router = new ScriptedRouter;
    // The trip ran 0–600 s on the server's clock; the handset's clock is
    // three minutes fast, so its pings say 180–780 s. Every second of the
    // trip was tracked, and the offset must not read as two dead zones.
    $points = drive(61, t0: 180);

    $m = measure($points, $router, start: 1_700_000_000, end: 1_700_000_000 + 600);

    expect($m->coveragePercent)->toBe(100.0);
});

it('loses coverage for a trace that started late or stopped early', function () {
    $router = new ScriptedRouter;
    // Trip 0–600 s; pings only for the last 300 s.
    $points = drive(31, t0: 300);

    $m = measure($points, $router, start: 1_700_000_000, end: 1_700_000_000 + 600);

    expect($m->coveragePercent)->toBe(50.0);
});

it('does not lose coverage to a parked stretch whose pings were dropped as jitter', function () {
    $router = new ScriptedRouter;
    $points = drive(10);

    // Parked 100–700 s, wandering a metre, then drives on.
    for ($t = 100; $t <= 700; $t += 10) {
        $points[] = measurerPoint(0.009 + 0.00001 * (($t / 10) % 2), $t);
    }

    for ($i = 1; $i <= 10; $i++) {
        $points[] = measurerPoint(0.009 + $i * 0.001, 700 + $i * 10);
    }

    $m = measure($points, $router, start: 1_700_000_000, end: 1_700_000_000 + 800);

    expect($m->cleaned->droppedFor('jitter'))->toBeGreaterThan(50)
        ->and($m->coveragePercent)->toBe(100.0);
});

it('has no coverage figure when the trip has no start or end', function () {
    $router = new ScriptedRouter;

    $m = (new TraceMeasurer(new TraceCleaner, $router))->measure(drive(10), null, null, DistanceThresholds::defaults());

    expect($m->coveragePercent)->toBeNull();
});
