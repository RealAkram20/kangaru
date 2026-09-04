<?php

use Modules\Trips\Distance\DistanceGrade;
use Modules\Trips\Distance\DistancePolicy;
use Modules\Trips\Distance\DistanceResolver;
use Modules\Trips\Distance\DistanceThresholds;
use Modules\Trips\Distance\DistanceWitnesses;

/**
 * Step 5 of the measured-distance algorithm — the rule itself (ADR-0045).
 *
 * Every branch of `DistanceResolver` as a row: what the four witnesses said,
 * and what the fare is billed on and how far it is trusted. This is the
 * table a bank's auditor and a driver's dispute both come down to, so it is
 * written to be read as one. Nothing here touches a database, a clock or a
 * network.
 */

/**
 * A trustworthy trace unless told otherwise: full coverage, nothing
 * inferred, no mock, no teleports.
 */
function witnesses(array $overrides = []): DistanceWitnesses
{
    return new DistanceWitnesses(...array_merge([
        'odometerKm' => 12.0,
        'gpsKm' => 12.4,
        'coveragePercent' => 100.0,
        'inferredSharePercent' => 0.0,
        'mockDropped' => 0,
        'teleportsDropped' => 0,
        'routeKm' => 12.0,
        'stopsDeclared' => false,
    ], $overrides));
}

function decide(DistanceWitnesses $w, DistancePolicy $policy = DistancePolicy::GPS_PRIMARY, ?DistanceThresholds $t = null)
{
    return (new DistanceResolver)->decide($w, $policy, $t ?? DistanceThresholds::defaults());
}

// ---------------------------------------------------------------------------
// GPS_PRIMARY: a trusted trace is billed as measured
// ---------------------------------------------------------------------------

it('bills a trusted trace that the road agrees with as grade A', function () {
    $d = decide(witnesses());

    expect($d->billedKm)->toBe(12.4)
        ->and($d->grade)->toBe(DistanceGrade::VERIFIED)
        ->and($d->traceTrusted)->toBeTrue()
        ->and($d->reason)->toContain('agrees');
});

it('bills a trusted trace with no reference route as grade A', function () {
    $d = decide(witnesses(['routeKm' => null]));

    expect($d->billedKm)->toBe(12.4)
        ->and($d->grade)->toBe(DistanceGrade::VERIFIED)
        ->and($d->reason)->toContain('no reference route');
});

it('bills a trusted trace that strays from the road as grade B — a detour is still driven', function () {
    // 12 km reference, 15 % + 0.5 km tolerance = 2.3 km; 15 km is 3 km out.
    $d = decide(witnesses(['gpsKm' => 15.0]));

    expect($d->billedKm)->toBe(15.0)
        ->and($d->grade)->toBe(DistanceGrade::BOUNDED)
        ->and($d->reason)->toContain('disagrees');
});

it('grades exactly at the tolerance edge as A, and just past it as B', function () {
    // 12 × 15 % + 0.5 = 2.3; 14.3 is on the line, 14.31 is over.
    expect(decide(witnesses(['gpsKm' => 14.3]))->grade)->toBe(DistanceGrade::VERIFIED)
        ->and(decide(witnesses(['gpsKm' => 14.31]))->grade)->toBe(DistanceGrade::BOUNDED);
});

it('never lets the odometer move a trusted trace, however far off it is', function () {
    // The 90,004 km reading (ADR-0035) against a good trace: the trace wins.
    $d = decide(witnesses(['odometerKm' => 90004.0]));

    expect($d->billedKm)->toBe(12.4)
        ->and($d->grade)->toBe(DistanceGrade::VERIFIED);
});

// ---------------------------------------------------------------------------
// GPS_PRIMARY: what makes a trace untrusted
// ---------------------------------------------------------------------------

it('does not trust a trace with too little coverage', function () {
    $d = decide(witnesses(['coveragePercent' => 79.9]));

    expect($d->traceTrusted)->toBeFalse()
        ->and($d->reason)->toContain('coverage 79.9%');
});

it('trusts a trace exactly at the coverage floor', function () {
    expect(decide(witnesses(['coveragePercent' => 80.0]))->traceTrusted)->toBeTrue();
});

it('does not trust a trace with too much inferred across gaps', function () {
    $d = decide(witnesses(['inferredSharePercent' => 25.1]));

    expect($d->traceTrusted)->toBeFalse()
        ->and($d->reason)->toContain('inferred across gaps');
});

it('trusts a trace exactly at the inferred ceiling', function () {
    expect(decide(witnesses(['inferredSharePercent' => 25.0]))->traceTrusted)->toBeTrue();
});

it('does not trust a trace with a single mock-location ping in it', function () {
    $d = decide(witnesses(['mockDropped' => 1]));

    expect($d->traceTrusted)->toBeFalse()
        ->and($d->reason)->toContain('mock-location');
});

it('holds — never merely unverifies — a trip whose handset faked its position, even with no road to check', function () {
    // A mock ping is not "no evidence": the device spoke against the trip.
    foreach ([DistancePolicy::GPS_PRIMARY, DistancePolicy::ODOMETER] as $policy) {
        $d = decide(witnesses(['mockDropped' => 1, 'routeKm' => null]), $policy);

        expect($d->grade)->toBe(DistanceGrade::HELD)
            ->and($d->reason)->toContain('faked position');
    }
});

it('tolerates teleports up to the limit and not one more', function () {
    expect(decide(witnesses(['teleportsDropped' => 2]))->traceTrusted)->toBeTrue()
        ->and(decide(witnesses(['teleportsDropped' => 3]))->traceTrusted)->toBeFalse();
});

it('does not trust a trace that measured nothing', function () {
    $d = decide(witnesses(['gpsKm' => null, 'coveragePercent' => null, 'inferredSharePercent' => null]));

    expect($d->traceTrusted)->toBeFalse()
        ->and($d->reason)->toContain('No usable trace');
});

// ---------------------------------------------------------------------------
// GPS_PRIMARY: the odometer stands in, inside the road's corridor
// ---------------------------------------------------------------------------

it('bills an odometer inside the corridor as grade B when the trace is weak', function () {
    // Reference 12 km → corridor 10.8–15.0 km. Odometer 12 sits inside.
    $d = decide(witnesses(['coveragePercent' => 40.0]));

    expect($d->billedKm)->toBe(12.0)
        ->and($d->grade)->toBe(DistanceGrade::BOUNDED)
        ->and($d->traceTrusted)->toBeFalse()
        ->and($d->reason)->toContain('inside the corridor');
});

it('clamps an inflated odometer to the corridor ceiling and holds it as grade C', function () {
    $d = decide(witnesses(['coveragePercent' => 40.0, 'odometerKm' => 20.0]));

    expect($d->billedKm)->toBe(15.0)
        ->and($d->grade)->toBe(DistanceGrade::HELD)
        ->and($d->reason)->toContain('clamped to 15.00 km');
});

it('lifts a short odometer to the corridor floor and holds it as grade C', function () {
    $d = decide(witnesses(['coveragePercent' => 40.0, 'odometerKm' => 3.0]));

    expect($d->billedKm)->toBe(10.8)
        ->and($d->grade)->toBe(DistanceGrade::HELD);
});

it('bills an odometer exactly on the corridor edges as inside', function () {
    expect(decide(witnesses(['coveragePercent' => 40.0, 'odometerKm' => 15.0]))->grade)->toBe(DistanceGrade::BOUNDED)
        ->and(decide(witnesses(['coveragePercent' => 40.0, 'odometerKm' => 10.8]))->grade)->toBe(DistanceGrade::BOUNDED);
});

it('grades an odometer with neither trace nor road as U — unverified, not held', function () {
    // ADR-0035's principle carried into the gate: missing evidence is not a
    // discrepancy. Whether U bills is the policy's call, not the resolver's.
    $d = decide(witnesses(['gpsKm' => null, 'coveragePercent' => null, 'inferredSharePercent' => null, 'routeKm' => null]));

    expect($d->billedKm)->toBe(12.0)
        ->and($d->grade)->toBe(DistanceGrade::UNVERIFIED)
        ->and($d->grade->billable())->toBeTrue()
        ->and($d->reason)->toContain('stands unverified');
});

it('holds whatever figure exists as grade C when there is no odometer either', function () {
    $d = decide(witnesses(['coveragePercent' => 40.0, 'odometerKm' => null, 'routeKm' => null]));

    expect($d->billedKm)->toBe(12.4)
        ->and($d->grade)->toBe(DistanceGrade::HELD)
        ->and($d->reason)->toContain('no odometer reading');
});

it('never bills a negative figure', function () {
    $d = decide(witnesses(['gpsKm' => null, 'coveragePercent' => null, 'inferredSharePercent' => null, 'routeKm' => null, 'odometerKm' => -3.0]));

    expect($d->billedKm)->toBe(0.0);
});

// ---------------------------------------------------------------------------
// ROUTE_CAPPED
// ---------------------------------------------------------------------------

it('caps a detour at the reference plus the allowance under route_capped', function () {
    // Reference 12 km + 15 % = 13.8 km. Trace 15 km is a detour.
    $d = decide(witnesses(['gpsKm' => 15.0]), DistancePolicy::ROUTE_CAPPED);

    expect($d->billedKm)->toBe(13.8)
        // Grade is about evidence, and the evidence was a trusted trace
        // that disagreed with the road: B, unchanged by the cap.
        ->and($d->grade)->toBe(DistanceGrade::BOUNDED)
        ->and($d->reason)->toContain('Capped at 13.80 km');
});

it('does not cap under route_capped when the driver declared a stop', function () {
    $d = decide(witnesses(['gpsKm' => 15.0, 'stopsDeclared' => true]), DistancePolicy::ROUTE_CAPPED);

    expect($d->billedKm)->toBe(15.0)
        ->and($d->reason)->not->toContain('Capped');
});

it('leaves a trace inside the cap alone under route_capped', function () {
    $d = decide(witnesses(['gpsKm' => 13.0]), DistancePolicy::ROUTE_CAPPED);

    expect($d->billedKm)->toBe(13.0)
        ->and($d->grade)->toBe(DistanceGrade::VERIFIED);
});

it('cannot cap without a reference route', function () {
    $d = decide(witnesses(['gpsKm' => 15.0, 'routeKm' => null]), DistancePolicy::ROUTE_CAPPED);

    expect($d->billedKm)->toBe(15.0);
});

it('never caps under gps_primary', function () {
    expect(decide(witnesses(['gpsKm' => 15.0]))->billedKm)->toBe(15.0);
});

// ---------------------------------------------------------------------------
// ODOMETER
// ---------------------------------------------------------------------------

it('bills the odometer and grades it A when a trusted trace agrees', function () {
    $d = decide(witnesses(), DistancePolicy::ODOMETER);

    expect($d->billedKm)->toBe(12.0)
        ->and($d->grade)->toBe(DistanceGrade::VERIFIED);
});

it('bills the odometer but holds it as C when a trusted trace contradicts it', function () {
    // The 6 km trip typed as 13 km — inside every ceiling, and the trace
    // says otherwise. Under an odometer contract that is a hold, not a bill.
    $d = decide(witnesses(['gpsKm' => 6.0, 'odometerKm' => 13.0]), DistancePolicy::ODOMETER);

    expect($d->billedKm)->toBe(13.0)
        ->and($d->grade)->toBe(DistanceGrade::HELD)
        ->and($d->reason)->toContain('contradicts');
});

it('grades the odometer B when the trace is weak but the road allows the reading', function () {
    $d = decide(witnesses(['coveragePercent' => 40.0]), DistancePolicy::ODOMETER);

    expect($d->billedKm)->toBe(12.0)
        ->and($d->grade)->toBe(DistanceGrade::BOUNDED);
});

it('holds the odometer as C when the trace is weak and the road does not allow the reading', function () {
    $d = decide(witnesses(['coveragePercent' => 40.0, 'odometerKm' => 20.0]), DistancePolicy::ODOMETER);

    // Still bills the reading — this is the odometer policy — but held.
    expect($d->billedKm)->toBe(20.0)
        ->and($d->grade)->toBe(DistanceGrade::HELD)
        ->and($d->reason)->toContain('outside the corridor');
});

it('grades the odometer U under the odometer policy when nothing can vouch for or against it', function () {
    $d = decide(witnesses(['gpsKm' => null, 'coveragePercent' => null, 'inferredSharePercent' => null, 'routeKm' => null]), DistancePolicy::ODOMETER);

    expect($d->grade)->toBe(DistanceGrade::UNVERIFIED)
        ->and($d->reason)->toContain('stands unverified');
});

it('holds whatever exists as C under the odometer policy with no odometer', function () {
    $d = decide(witnesses(['odometerKm' => null]), DistancePolicy::ODOMETER);

    expect($d->billedKm)->toBe(12.4)
        ->and($d->grade)->toBe(DistanceGrade::HELD)
        ->and($d->reason)->toContain('no odometer reading');
});

// ---------------------------------------------------------------------------
// The thresholds are the operator's
// ---------------------------------------------------------------------------

it('reads every bar from the thresholds, not from constants', function () {
    $loose = DistanceThresholds::defaults()->with([
        'minCoveragePercent' => 30,
        'maxInferredSharePercent' => 60,
        'maxTeleports' => 10,
        'routeTolerancePercent' => 50,
        'corridorFloorPercent' => 50,
        'corridorCeilingPercent' => 200,
        'detourCapPercent' => 40,
    ]);

    // Would fail every default bar; passes every loosened one.
    $w = witnesses(['coveragePercent' => 35.0, 'inferredSharePercent' => 55.0, 'teleportsDropped' => 8, 'gpsKm' => 17.0]);

    $d = decide($w, DistancePolicy::GPS_PRIMARY, $loose);
    expect($d->traceTrusted)->toBeTrue()->and($d->grade)->toBe(DistanceGrade::VERIFIED);

    // And the corridor: 12 × 50 %–200 % = 6–24. An odometer of 20 with a
    // weak trace is inside under the loose set, clamped under the defaults.
    $weak = witnesses(['coveragePercent' => 10.0, 'odometerKm' => 20.0]);
    expect(decide($weak, DistancePolicy::GPS_PRIMARY, $loose)->grade)->toBe(DistanceGrade::BOUNDED)
        ->and(decide($weak)->grade)->toBe(DistanceGrade::HELD);

    // And the cap: 12 × 140 % = 16.8.
    expect(decide(witnesses(['gpsKm' => 16.0]), DistancePolicy::ROUTE_CAPPED, $loose)->billedKm)->toBe(16.0)
        ->and(decide(witnesses(['gpsKm' => 16.0]), DistancePolicy::ROUTE_CAPPED)->billedKm)->toBe(13.8);
});

it('records which policy decided', function () {
    foreach (DistancePolicy::cases() as $policy) {
        expect(decide(witnesses(), $policy)->policy)->toBe($policy);
    }
});
