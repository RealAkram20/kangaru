import type { TripStop } from '../api/types';

/**
 * Pure readers over a trip's itinerary (ADR-0045).
 *
 * In `places.ts`'s spirit: these are the parts that can be *wrong* rather
 * than merely ugly — which stop the map targets, which row gets the Arrived
 * button — and a component test would have to render and flush to reach
 * them.
 */

/**
 * The stop the run is heading for: the first still-pending stop in sequence
 * order, or null when the itinerary is empty or exhausted — in which case
 * the trip's own drop-off is the destination again.
 *
 * Sorted defensively rather than trusting payload order. The server serves
 * stops ordered by sequence, but this function is the one place the answer
 * is derived and a re-sorted copy costs nothing.
 */
export function nextPendingStop(stops: readonly TripStop[]): TripStop | null {
  const pending = stops
    .filter((stop) => stop.status === 'pending')
    .sort((a, b) => a.sequence - b.sequence);

  return pending[0] ?? null;
}

/**
 * The stop the driver is currently standing at — status `arrived`, of which
 * the lifecycle allows at most one: an arrival is a `waiting` transition and
 * the only exit from `waiting` is the resume that closes the stop.
 */
export function arrivedStop(stops: readonly TripStop[]): TripStop | null {
  return stops.find((stop) => stop.status === 'arrived') ?? null;
}

/**
 * Whether the trip's pickup is still the start of the leg being driven.
 *
 * The question a **progress** figure has to ask before it may say anything.
 * `GET /trips/{id}/route` with no origin answers the road from the *pickup*
 * to the current target, and that is only the road the driver is on while
 * they have not yet worked a stop: after the first arrival the leg runs
 * `stop 1 → stop 2`, and comparing what is left of it against a road starting
 * at the pickup compares two different journeys. On a circuit whose second
 * ATM is near the branch it started from, that arithmetic reads as *negative*
 * progress on a driver who has done most of the work.
 *
 * So the honest answer mid-circuit is no answer, which is what callers
 * render. A plain A→B trip — very nearly all of them — has no stops at all
 * and is never affected.
 *
 * `skipped` counts as worked, not as untouched: §6's case means the driver
 * passed it, and the leg moved on whether or not anybody stopped.
 */
export function pickupIsLegOrigin(stops: readonly TripStop[]): boolean {
  return stops.every((stop) => stop.status === 'pending');
}

/** Run order, restated locally for the same defensive reason as above. */
export function inRunOrder(stops: readonly TripStop[]): TripStop[] {
  return [...stops].sort((a, b) => a.sequence - b.sequence);
}
