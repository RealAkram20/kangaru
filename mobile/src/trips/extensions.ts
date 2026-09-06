import type { Trip, TripStop } from '../api/types';

/**
 * Reading a journey that may have grown past the drop-off it was agreed for
 * (ADR-0045 §4 amendment).
 *
 * ## Why the decisions live here and not in the screen
 *
 * Because they are the part that can be *wrong*, and `TripInProgressScreen`
 * cannot be rendered without a query client, an auth provider and a duty
 * poll — so a test of it is a test of all four. `jest.setup.ts` records the
 * rule this follows, and `offerSurface.ts` states it in the same words: the
 * suites worth trusting in this app are pure TypeScript over injected values.
 *
 * ## The one distinction everything here turns on
 *
 * A **stop** is a pause on the way to a destination nobody changed. An
 * **extension** moved the end of the journey, and is billed for the distance
 * it added. They share a table because the owner chose that, and every
 * function below asks `kind` first so the two can never be treated alike on a
 * screen that shows a driver what they are owed.
 */

/** The extensions on a trip, in run order, whatever their state. */
export function extensionsOf(trip: Trip): TripStop[] {
  return (trip.stops ?? []).filter((stop) => stop.kind === 'extension');
}

/**
 * The one a passenger has asked for and the driver has not answered.
 *
 * Singular on purpose. A passenger can only have one request outstanding in
 * practice — the screen shows it, the driver answers it, and the next one
 * arrives after — and a list would invite a UI that stacks unanswered
 * questions in front of somebody driving. If a second ever exists, the oldest
 * is the one being waited on, which is what `stops` order already gives.
 */
export function pendingRequest(trip: Trip): TripStop | null {
  return extensionsOf(trip).find((stop) => stop.status === 'proposed') ?? null;
}

/**
 * The extensions the trip is actually committed to, still to be driven.
 *
 * Mirrors the server's `scopeAcceptedExtensions` minus the ones already done:
 * `proposed` is nobody's commitment yet and `skipped` was answered. This is
 * what makes "there is more of this journey to run" true on the screen and at
 * completion, and the two must agree — a driver told they may finish by a
 * screen, and refused by the server, learns to distrust the screen.
 */
export function extensionsStillToRun(trip: Trip): TripStop[] {
  return extensionsOf(trip).filter(
    (stop) => stop.status === 'pending' || stop.status === 'arrived',
  );
}

/**
 * Whether the agreed drop-off has been reached.
 *
 * The boundary the owner asked for — *"mark it a drop off (Before) then
 * extension (after the first designation)"*. Before it, the journey is still
 * heading where it was booked to go; after it, the extensions are what is
 * left.
 */
export function dropoffReached(trip: Trip): boolean {
  return trip.dropoff_reached_at !== null;
}

/**
 * Whether the driver may still mark the drop-off.
 *
 * False once it is marked, because the act is idempotent on the server and a
 * button that does nothing is worse than no button — a driver who presses it
 * twice and sees no change has been told the screen is not listening.
 */
export function canMarkDropoff(trip: Trip): boolean {
  return !dropoffReached(trip);
}

/**
 * What the extend control should say on this trip.
 *
 * Two vocabularies, because the same tap means two different things and the
 * driver is the one who has to explain the fare afterwards.
 *
 * - A **walk-in** has one agreed destination and no itinerary. A place its
 *   passenger asks for mid-run is them going further, so it is billed, and
 *   the label says what the driver is doing rather than hiding it behind the
 *   old wording. This is the owner's 2026-08-28 decision, taken after the
 *   collision was raised: the button existed and quietly created an unbilled
 *   stop, which is why walk-in extensions were driven and not paid for.
 * - A **corporate circuit** is an itinerary of stops by design — the bank's
 *   five ATMs — and ADR-0045 §4 is explicit that those are never billed.
 *   That flow keeps its own word.
 */
export function extendLabel(trip: Trip): string {
  return isWalkIn(trip) ? 'Extend the trip' : 'Add a drop-off';
}

/**
 * Whether a place added mid-run should be billed on this trip.
 *
 * The single place that decision is made, so the label a driver reads and the
 * request the app sends cannot disagree. They did disagree before this
 * existed, and the symptom was silent: the screen said one thing and
 * `trip_stops.kind` recorded the other.
 */
export function addsExtension(trip: Trip): boolean {
  return isWalkIn(trip);
}

/**
 * A trip with no client behind it.
 *
 * `tenant_id` rather than a service-type check: a walk-in is defined by
 * having no client (ADR-0024 §1), and that is exactly what the column says.
 * Reading `service_type` instead would call a corporate delivery a walk-in.
 */
function isWalkIn(trip: Trip): boolean {
  return trip.tenant_id === null;
}

/**
 * The stops that happen *on the way* to the agreed drop-off.
 *
 * Everything ADR-0045 §4 already meant: the bank's five ATMs, served before
 * the run ends where it was contracted to end. Extensions are excluded
 * because they are the other side of the journey — see `journeyOrder` below.
 */
export function stopsBeforeDropoff(trip: Trip): TripStop[] {
  return (trip.stops ?? []).filter((stop) => stop.kind === 'stop');
}

/**
 * The next place the driver should actually be heading for.
 *
 * ## The bug this exists to stop
 *
 * Extensions live in the same list as stops, and the list is ordered by
 * `sequence` — so on a walk-in, whose only row is the extension, the app
 * called it "Next drop-off" and pointed the driver at it **before the**
 * **destination the passenger was actually hired to reach**. Found by
 * rendering the screen, not by a test: the fixtures had no extension on a
 * trip that also had a drop-off ahead of it.
 *
 * The server already draws this boundary — `TripRouteController` excludes
 * extensions from the drop-off leg until `dropoff_reached_at` is set, and
 * `RouteReference` routes pickup, then the agreed drop-off, then the
 * extensions. This is that same rule on the handset, so the map and the list
 * cannot tell a driver two different things.
 *
 * Null means the agreed drop-off is next, which is what the screen already
 * renders when there is no stop to visit.
 */
export function nextPlace(trip: Trip): TripStop | null {
  const pending = (row: TripStop) => row.status === 'pending';

  const stops = stopsBeforeDropoff(trip).filter(pending);

  if (stops.length > 0) {
    return stops[0] ?? null;
  }

  // Only once the passenger has been set down where they asked. Before that
  // the drop-off itself is next, however many extensions have been agreed.
  if (!dropoffReached(trip)) {
    return null;
  }

  return extensionsStillToRun(trip).filter(pending)[0] ?? null;
}
