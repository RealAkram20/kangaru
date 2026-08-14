<?php

namespace Modules\Trips\Routing;

/**
 * Something that can draw a road between two points (ADR-0031 §2).
 *
 * An interface with one implementation, for the reason `ContactChannel` has
 * one: the seam is what makes the vendor choice reversible. ADR-0031 records
 * that self-hosted OSRM was offered and Google chosen for its traffic data —
 * the day that trade is revisited, this is the only thing that changes.
 *
 * Four floats rather than a value object, matching `GreatCircle::kilometres`,
 * which is the only other thing in this codebase that takes a pair of points.
 *
 * **Implementations never throw.** A routing failure must degrade the map to
 * the straight-line drawing that already exists, never break the screen a
 * driver is reading with a passenger in the car (ADR-0031 §3).
 */
interface RouteProvider
{
    public function route(
        float $fromLatitude,
        float $fromLongitude,
        float $toLatitude,
        float $toLongitude,
    ): ?Route;
}
