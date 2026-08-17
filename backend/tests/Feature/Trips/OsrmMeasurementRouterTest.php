<?php

use Illuminate\Support\Facades\Http;
use Modules\Administration\Services\SettingsService;
use Modules\Trips\Distance\MeasurementRouter;
use Modules\Trips\Distance\OsrmMeasurementRouter;
use Modules\Trips\Distance\TracePoint;

/**
 * The measuring engine's HTTP, against a faked OSRM (ADR-0045).
 *
 * OSRM is faked throughout: the public demo server is not for production
 * and not for CI either, and a self-hosted box does not exist on a runner.
 * The bodies below are shaped the way OSRM really shapes them — `code` in
 * the body, distances in metres, `lng,lat` in the path, `tracepoints`
 * aligned with the input — because the parsing is what is under test.
 */
function enableMatching(string $baseUrl = 'https://osrm.test'): void
{
    app(SettingsService::class)->setGroup('maps', ['osrm_base_url' => $baseUrl]);
    app(SettingsService::class)->setGroup('tracking', ['trace_matching_enabled' => true]);
}

/**
 * @return array<int, TracePoint>
 */
function osrmPoints(int $count): array
{
    return array_map(
        fn (int $i) => new TracePoint(latitude: 0.3152, longitude: 32.5816 + $i * 0.001, recordedAt: 1_700_000_000 + $i * 10, accuracyMetres: 12.0),
        range(0, $count - 1),
    );
}

/**
 * @param  array<int, array<string, mixed>>  $matchings
 * @param  array<int, array<string, mixed>|null>  $tracepoints
 * @return array<string, mixed>
 */
function matchBody(array $matchings, array $tracepoints): array
{
    return ['code' => 'Ok', 'matchings' => $matchings, 'tracepoints' => $tracepoints];
}

it('is unavailable until the operator switches matching on', function () {
    app(SettingsService::class)->setGroup('maps', ['osrm_base_url' => 'https://osrm.test']);

    $router = app(MeasurementRouter::class);

    expect($router)->toBeInstanceOf(OsrmMeasurementRouter::class)
        ->and($router->available())->toBeFalse();

    Http::fake();
    expect($router->match(osrmPoints(3)))->toBeNull()
        ->and($router->routeKilometres([[0.3, 32.5], [0.4, 32.6]]))->toBeNull();
    Http::assertNothingSent();
});

it('is unavailable with matching on but no server URL', function () {
    app(SettingsService::class)->setGroup('maps', ['osrm_base_url' => '']);
    app(SettingsService::class)->setGroup('tracking', ['trace_matching_enabled' => true]);

    expect(app(MeasurementRouter::class)->available())->toBeFalse();
});

it('does not depend on the map\'s routing switch — that one may be off, or Google', function () {
    enableMatching();
    app(SettingsService::class)->setGroup('maps', ['routing_enabled' => false, 'routing_provider' => 'google']);

    expect(app(MeasurementRouter::class)->available())->toBeTrue();
});

it('sends the trace longitude-first with timestamps and the device accuracy as radius', function () {
    enableMatching();
    Http::fake(['osrm.test/*' => Http::response(matchBody(
        [['distance' => 2210.0, 'geometry' => 'abc', 'confidence' => 0.9]],
        array_map(fn (int $i) => ['matchings_index' => 0, 'waypoint_index' => $i, 'location' => [32.5816 + $i * 0.001, 0.3152]], range(0, 2)),
    ))]);

    $chunk = app(MeasurementRouter::class)->match(osrmPoints(3));

    Http::assertSent(function ($request) {
        $url = urldecode($request->url());

        return str_starts_with($url, 'https://osrm.test/match/v1/driving/32.5816,0.3152;32.5826,0.3152;32.5836,0.3152?')
            && str_contains($url, 'timestamps=1700000000;1700000010;1700000020')
            && str_contains($url, 'radiuses=12;12;12')
            && str_contains($url, 'geometries=polyline');
    });

    expect($chunk)->not->toBeNull()
        ->and($chunk->matchedKm)->toBe(2.21)
        ->and($chunk->unmatchedKm)->toBe(0.0)
        ->and($chunk->polylines)->toBe(['abc']);
});

it('sums several matchings and reports the break between them as unmatched', function () {
    enableMatching();
    // Five pings; the engine joined 0–1 by road and 3–4 by road, could not
    // join 1→3, and discarded 2 as an outlier (null tracepoint).
    Http::fake(['osrm.test/*' => Http::response(matchBody(
        [
            ['distance' => 111.0, 'geometry' => 'first'],
            ['distance' => 111.0, 'geometry' => 'second'],
        ],
        [
            ['matchings_index' => 0, 'waypoint_index' => 0, 'location' => [32.5816, 0.3152]],
            ['matchings_index' => 0, 'waypoint_index' => 1, 'location' => [32.5826, 0.3152]],
            null,
            ['matchings_index' => 1, 'waypoint_index' => 0, 'location' => [32.5846, 0.3152]],
            ['matchings_index' => 1, 'waypoint_index' => 1, 'location' => [32.5856, 0.3152]],
        ],
    ))]);

    $chunk = app(MeasurementRouter::class)->match(osrmPoints(5));

    // The break is input ping 1 → input ping 3: 0.002° at the equator,
    // ~222.6 m.
    expect($chunk->matchedKm)->toBe(0.222)
        ->and($chunk->unmatchedKm)->toEqualWithDelta(0.2226, 0.001)
        ->and($chunk->polylines)->toBe(['first', 'second']);
});

it('reports leading and trailing pings no matching claimed as unmatched', function () {
    enableMatching();
    Http::fake(['osrm.test/*' => Http::response(matchBody(
        [['distance' => 111.0, 'geometry' => 'mid']],
        [
            null,
            ['matchings_index' => 0, 'waypoint_index' => 0, 'location' => [32.5826, 0.3152]],
            ['matchings_index' => 0, 'waypoint_index' => 1, 'location' => [32.5836, 0.3152]],
            null,
        ],
    ))]);

    $chunk = app(MeasurementRouter::class)->match(osrmPoints(4));

    // 0→1 and 2→3, each ~111.3 m.
    expect($chunk->unmatchedKm)->toEqualWithDelta(0.2226, 0.001);
});

it('answers null, and does not throw, when the engine declines or fails', function () {
    enableMatching();
    $router = app(MeasurementRouter::class);

    Http::fake(['osrm.test/*' => Http::response(['code' => 'NoMatch', 'message' => 'Could not match the trace.'])]);
    expect($router->match(osrmPoints(3)))->toBeNull();

    Http::fake(['osrm.test/*' => Http::response(['code' => 'Ok', 'matchings' => []])]);
    expect($router->match(osrmPoints(3)))->toBeNull();

    Http::fake(['osrm.test/*' => Http::response('gateway timeout', 504)]);
    expect($router->match(osrmPoints(3)))->toBeNull()
        ->and($router->routeKilometres([[0.3, 32.5], [0.4, 32.6]]))->toBeNull();

    Http::fake(['osrm.test/*' => fn () => throw new RuntimeException('connection refused')]);
    expect($router->match(osrmPoints(3)))->toBeNull()
        ->and($router->routeKilometres([[0.3, 32.5], [0.4, 32.6]]))->toBeNull();
});

it('refuses to match fewer than two points without a request', function () {
    enableMatching();
    Http::fake();

    expect(app(MeasurementRouter::class)->match(osrmPoints(1)))->toBeNull();
    Http::assertNothingSent();
});

it('routes through waypoints longitude-first and answers kilometres', function () {
    enableMatching();
    Http::fake(['osrm.test/*' => Http::response(['code' => 'Ok', 'routes' => [['distance' => 12345.0, 'duration' => 900.0]]])]);

    $km = app(MeasurementRouter::class)->routeKilometres([[0.3346, 32.5906], [0.3300, 32.5950], [0.3268, 32.6011]]);

    Http::assertSent(fn ($request) => str_starts_with(
        urldecode($request->url()),
        'https://osrm.test/route/v1/driving/32.5906,0.3346;32.595,0.33;32.6011,0.3268?',
    ) && str_contains($request->url(), 'overview=false'));

    expect($km)->toBe(12.345);
});

it('answers null for a route with no road between the points', function () {
    enableMatching();
    Http::fake(['osrm.test/*' => Http::response(['code' => 'NoRoute'])]);

    expect(app(MeasurementRouter::class)->routeKilometres([[0.3, 32.5], [0.4, 32.6]]))->toBeNull();
});
