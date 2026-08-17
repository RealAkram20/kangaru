<?php

use Modules\Trips\Distance\DistanceThresholds;
use Modules\Trips\Distance\TraceCleaner;
use Modules\Trips\Distance\TracePoint;

/**
 * Step 1 of the measured-distance algorithm, on its own (ADR-0045).
 *
 * Every rule pinned on a hand-built trace where the expected answer is
 * arithmetic, not an oracle. Points sit on the equator so a degree of
 * longitude is 111.32 km and the offsets below read as metres directly:
 * 0.0001° is about 11 m, 0.001° about 111 m, 0.1° about 11 km.
 */
function cleanerPoint(float $lngOffset, int $t, ?float $accuracy = null, bool $mock = false): TracePoint
{
    return new TracePoint(
        latitude: 0.0,
        longitude: 32.5 + $lngOffset,
        recordedAt: 1_700_000_000 + $t,
        accuracyMetres: $accuracy,
        isMock: $mock,
    );
}

/**
 * A clean drive: a point every ten seconds, ~111 m apart (about 40 km/h).
 *
 * @return array<int, TracePoint>
 */
function cleanDrive(int $points): array
{
    return array_map(fn (int $i) => cleanerPoint($i * 0.001, $i * 10), range(0, $points - 1));
}

it('keeps every ping of a clean drive and drops nothing', function () {
    $cleaned = (new TraceCleaner)->clean(cleanDrive(20), DistanceThresholds::defaults());

    expect($cleaned->kept())->toBe(20)
        ->and($cleaned->total)->toBe(20)
        ->and(array_sum($cleaned->dropped))->toBe(0)
        ->and($cleaned->presence)->toHaveCount(20);
});

it('drops mock-location pings and does not count them as presence', function () {
    $points = cleanDrive(10);
    $points[4] = cleanerPoint(0.004, 40, mock: true);
    $points[5] = cleanerPoint(0.005, 50, mock: true);

    $cleaned = (new TraceCleaner)->clean($points, DistanceThresholds::defaults());

    expect($cleaned->droppedFor('mock'))->toBe(2)
        ->and($cleaned->kept())->toBe(8)
        // Presence is every non-mock ping: a fake fix proves nothing about
        // where the handset was, so it is not evidence of a live device.
        ->and($cleaned->presence)->toHaveCount(8);
});

it('drops pings the device rated worse than the accuracy ceiling but keeps them as presence', function () {
    $points = cleanDrive(10);
    $points[3] = cleanerPoint(0.003, 30, accuracy: 80.0);

    $cleaned = (new TraceCleaner)->clean($points, DistanceThresholds::defaults());

    expect($cleaned->droppedFor('accuracy'))->toBe(1)
        ->and($cleaned->kept())->toBe(9)
        // A bad fix is still a reporting handset.
        ->and($cleaned->presence)->toHaveCount(10);
});

it('keeps a ping that carries no accuracy figure at all', function () {
    // "Did not say" is not "said it was bad".
    $points = cleanDrive(3);

    expect((new TraceCleaner)->clean($points, DistanceThresholds::defaults())->kept())->toBe(3);
});

it('keeps a ping exactly at the accuracy ceiling', function () {
    $points = cleanDrive(3);
    $points[1] = cleanerPoint(0.001, 10, accuracy: 50.0);

    expect((new TraceCleaner)->clean($points, DistanceThresholds::defaults())->droppedFor('accuracy'))->toBe(0);
});

it('drops a teleport and measures the next ping from the last good position', function () {
    $points = cleanDrive(6);
    // Eleven kilometres in ten seconds: 4,000 km/h.
    $points[3] = cleanerPoint(0.1, 30);

    $cleaned = (new TraceCleaner)->clean($points, DistanceThresholds::defaults());

    expect($cleaned->droppedFor('teleport'))->toBe(1)
        // Point 4 is 0.004° from the start — 222 m from point 2 in 20 s,
        // 40 km/h, an ordinary move — so it is kept, not treated as a
        // second teleport back from the bad fix.
        ->and($cleaned->kept())->toBe(5)
        ->and($cleaned->droppedFor('jitter'))->toBe(0);
});

it('drops a second ping in the same second as a duplicate rather than a teleport', function () {
    $points = cleanDrive(3);
    $points[] = cleanerPoint(0.0025, 20); // same second as points[2], 55 m away

    $cleaned = (new TraceCleaner)->clean($points, DistanceThresholds::defaults());

    expect($cleaned->droppedFor('duplicate'))->toBe(1)
        ->and($cleaned->droppedFor('teleport'))->toBe(0)
        ->and($cleaned->kept())->toBe(3);
});

it('drops receiver jitter from a parked vehicle but keeps the parked time as presence', function () {
    // Parked for two minutes, wandering ~1 m, then drives off.
    $points = [cleanerPoint(0.0, 0)];

    for ($i = 1; $i <= 12; $i++) {
        $points[] = cleanerPoint(0.00001 * ($i % 2), $i * 10); // ~1 m wander
    }

    $points[] = cleanerPoint(0.001, 130);
    $points[] = cleanerPoint(0.002, 140);

    $cleaned = (new TraceCleaner)->clean($points, DistanceThresholds::defaults());

    expect($cleaned->droppedFor('jitter'))->toBe(12)
        ->and($cleaned->kept())->toBe(3)
        // Fifteen non-mock pings, fifteen moments the handset was reporting.
        ->and($cleaned->presence)->toHaveCount(15);
});

it('always keeps the first ping, having nothing to compare it against', function () {
    $cleaned = (new TraceCleaner)->clean([cleanerPoint(0.0, 0)], DistanceThresholds::defaults());

    expect($cleaned->kept())->toBe(1);
});

it('honours a stricter speed ceiling from the thresholds', function () {
    // A boda fleet: 60 km/h ceiling. A 111 m hop in 10 s is 40 km/h and
    // fine; a 333 m hop in 10 s is 120 km/h and a teleport.
    $points = cleanDrive(3);
    $points[] = cleanerPoint(0.005, 30);

    $strict = DistanceThresholds::defaults()->with(['maxPlausibleSpeedKph' => 60]);
    $cleaned = (new TraceCleaner)->clean($points, $strict);

    expect($cleaned->droppedFor('teleport'))->toBe(1);
});

it('returns an empty trace, not an error, for no pings', function () {
    $cleaned = (new TraceCleaner)->clean([], DistanceThresholds::defaults());

    expect($cleaned->kept())->toBe(0)
        ->and($cleaned->total)->toBe(0)
        ->and($cleaned->dropped)->toHaveKeys(['mock', 'accuracy', 'duplicate', 'teleport', 'jitter']);
});
