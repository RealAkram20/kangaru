<?php

namespace Modules\Trips\Routing;

/**
 * Something that can draw a road through an ordered list of points
 * (ADR-0031 §2, widened for ADR-0045 §7).
 *
 * An interface with one method and two implementations, for the reason
 * `ContactChannel` has one: the seam is what makes the vendor choice
 * reversible. ADR-0031 records that self-hosted OSRM was offered and Google
 * chosen for its traffic data — the day that trade is revisited, these are
 * the only things that change.
 *
 * ## Why a list rather than four floats
 *
 * It was four floats — a from and a to — until corporate clients needed a
 * circuit drawn through seven ATMs (ADR-0045). Both vendors take waypoints
 * natively, so the widening is real in the providers and free at the seam;
 * the alternative was a second method that duplicated every failure path.
 *
 * A two-point call is simply a list of two, which is what
 * `RouteService::between()` now passes.
 *
 * **The order is the route.** Neither implementation may reorder the points
 * to shorten the drive, however tempting the provider's own optimisation
 * flag looks: ADR-0045 §7 refuses it, because a cash run's sequence is an
 * operational and security decision rather than a travelling-salesman
 * problem.
 *
 * **Implementations never throw.** A routing failure must degrade the map to
 * the straight-line drawing that already exists, never break the screen a
 * driver is reading with a passenger in the car (ADR-0031 §3). Fewer than
 * two points is not a failure to log but a question with no answer: return
 * null.
 */
interface RouteProvider
{
    /**
     * @param  array<int, array{float, float}>  $points  Ordered `[latitude, longitude]`
     *                                                   pairs, origin first. Two or more.
     */
    public function via(array $points): ?Route;
}
