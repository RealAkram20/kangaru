<?php

use Modules\Fleet\Support\BoundaryRing;

/**
 * ADR-0021's geometry, on its own.
 *
 * Point-in-polygon is where geofencing bugs live, and they are the quiet
 * kind: a zone that answers wrongly near its edge prices a trip wrongly, or
 * refuses an order nobody can see a reason to refuse. Every case here is a
 * known answer rather than a round trip through the database.
 */
function square(): BoundaryRing
{
    // A unit square from (0,0) to (1,1). Deliberately not Kampala
    // coordinates: the arithmetic is easier to check by hand.
    return BoundaryRing::fromArray([
        ['lat' => 0.0, 'lng' => 0.0],
        ['lat' => 0.0, 'lng' => 1.0],
        ['lat' => 1.0, 'lng' => 1.0],
        ['lat' => 1.0, 'lng' => 0.0],
    ]);
}

it('contains a point in the middle', function () {
    expect(square()->contains(0.5, 0.5))->toBeTrue();
});

it('excludes a point outside', function () {
    expect(square()->contains(2.0, 2.0))->toBeFalse();
    expect(square()->contains(0.5, 1.5))->toBeFalse();
    expect(square()->contains(-0.5, 0.5))->toBeFalse();
});

it('treats a point exactly on an edge as inside', function () {
    // Genuinely ambiguous, so it is settled explicitly rather than left to
    // whichever side the rounding falls on. For a service area this is the
    // kinder answer — refusing an order because the pin landed on the line
    // is not something anybody can act on.
    expect(square()->contains(0.5, 0.0))->toBeTrue();
    expect(square()->contains(0.0, 0.5))->toBeTrue();
    expect(square()->contains(1.0, 0.5))->toBeTrue();
});

it('treats a corner as inside', function () {
    expect(square()->contains(0.0, 0.0))->toBeTrue();
    expect(square()->contains(1.0, 1.0))->toBeTrue();
});

it('does not double-count a ray passing through a vertex', function () {
    // A diamond, so a horizontal ray from the left at lat 0.5 passes
    // exactly through the west and east vertices. Counting the two edges
    // meeting at each would flip the answer and report "outside" for a
    // point plainly in the middle.
    $diamond = BoundaryRing::fromArray([
        ['lat' => 0.5, 'lng' => 0.0],
        ['lat' => 1.0, 'lng' => 0.5],
        ['lat' => 0.5, 'lng' => 1.0],
        ['lat' => 0.0, 'lng' => 0.5],
    ]);

    expect($diamond->contains(0.5, 0.5))->toBeTrue();
    expect($diamond->contains(0.5, 1.5))->toBeFalse();
});

it('respects the notch in a concave shape', function () {
    // An L. The square hull would call (0.8, 0.8) inside; the actual shape
    // does not, and a zone that claimed otherwise would price a trip in a
    // district it does not cover.
    $ell = BoundaryRing::fromArray([
        ['lat' => 0.0, 'lng' => 0.0],
        ['lat' => 0.0, 'lng' => 1.0],
        ['lat' => 0.5, 'lng' => 1.0],
        ['lat' => 0.5, 'lng' => 0.5],
        ['lat' => 1.0, 'lng' => 0.5],
        ['lat' => 1.0, 'lng' => 0.0],
    ]);

    expect($ell->contains(0.2, 0.2))->toBeTrue();
    expect($ell->contains(0.8, 0.8))->toBeFalse();
    expect($ell->contains(0.8, 0.2))->toBeTrue();
});

it('survives a repeated point, which a hand-drawn boundary produces easily', function () {
    $withDuplicate = BoundaryRing::fromArray([
        ['lat' => 0.0, 'lng' => 0.0],
        ['lat' => 0.0, 'lng' => 0.0],
        ['lat' => 0.0, 'lng' => 1.0],
        ['lat' => 1.0, 'lng' => 1.0],
        ['lat' => 1.0, 'lng' => 0.0],
    ]);

    // A zero-length edge divides by zero unless it is special-cased.
    expect($withDuplicate->contains(0.5, 0.5))->toBeTrue();
});

it('answers correctly for a real Kampala boundary', function () {
    // A rough box around central Kampala, in the coordinates the platform
    // actually deals in — small positive latitudes and large longitudes,
    // which is exactly the pair that gets swapped.
    $kampala = BoundaryRing::fromArray([
        ['lat' => 0.2800, 'lng' => 32.5300],
        ['lat' => 0.2800, 'lng' => 32.6400],
        ['lat' => 0.3900, 'lng' => 32.6400],
        ['lat' => 0.3900, 'lng' => 32.5300],
    ]);

    // City centre.
    expect($kampala->contains(0.3476, 32.5825))->toBeTrue();
    // The same pair swapped — a point off the coast of Ghana. This is the
    // case ADR-0020 records range validation being unable to catch, and the
    // reason a service-area zone is worth having.
    expect($kampala->contains(32.5825, 0.3476))->toBeFalse();
    // Entebbe, genuinely outside a central-Kampala box.
    expect($kampala->contains(0.0424, 32.4435))->toBeFalse();
});
