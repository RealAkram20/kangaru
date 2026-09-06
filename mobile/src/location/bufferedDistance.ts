import type { Ping } from './pings';

/**
 * How far the handset thinks this trip went, from the pings it still holds
 * (ADR-0045 §5).
 *
 * **This is a claim, not evidence.** The server measures the same trace
 * properly — cleaned, snapped to roads, gaps routed — and that figure is what
 * settles the fare. This one exists for the two moments the server cannot
 * reach: the warning at the keypad when a typed odometer reading disagrees
 * with what the phone saw, and the provisional fare a cash passenger pays at
 * the kerb before the resolver has spoken.
 *
 * It is deliberately the *simplest* honest measurement — great-circle hops
 * over kept pings, with the same two rules that would otherwise inflate it:
 *
 * - **mock-location fixes are dropped entirely.** A faked position is not
 *   evidence of anything, and a driver must never be shown a fare built on
 *   one.
 * - **hops under the noise floor are dropped**, because a parked vehicle
 *   still pings and its receiver wanders; over a twenty-minute wait that
 *   jitter sums to a few hundred metres nobody drove.
 *
 * It has no road network and no gap routing, so it under-reads: real roads
 * are longer than the crow's flight. That is the right direction to be wrong
 * in for a figure a passenger is about to pay, and the settled fare corrects
 * it either way.
 */

/** Metres. The server's own default (`tracking.min_segment_metres`). */
const NOISE_FLOOR_METRES = 5;

/** Mean Earth radius in metres (IUGG), as the server uses. */
const EARTH_RADIUS_METRES = 6_371_008.8;

export function metresBetween(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const latFrom = toRadians(from.lat);
  const latTo = toRadians(to.lat);
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLng = toRadians(to.lng - from.lng);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(latFrom) * Math.cos(latTo) * Math.sin(deltaLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Kilometres to two decimals, or **null** when there are fewer than two
 * usable pings.
 *
 * Null and zero are different answers and stay different: null is "the phone
 * has nothing to say about this trip", zero is "it says the vehicle did not
 * move". A screen shows an em dash for the first and a real figure for the
 * second.
 */
export function bufferedDistanceKm(pings: Ping[]): number | null {
  const usable = pings.filter((ping) => !ping.isMock);

  if (usable.length < 2) {
    return null;
  }

  let metres = 0;
  let previous = usable[0]!;

  for (const ping of usable.slice(1)) {
    const hop = metresBetween(previous.position, ping.position);

    if (hop >= NOISE_FLOOR_METRES) {
      metres += hop;
      previous = ping;
    }
  }

  return Math.round((metres / 1000) * 100) / 100;
}

/**
 * Whether a typed odometer delta disagrees with what the phone measured by
 * more than the office's threshold (ADR-0045 §5).
 *
 * Compared as a share of the **typed** figure, exactly as
 * `TripStateMachine::reconcileAgainstGps()` does, so the app warns about the
 * same trips the server flags rather than a subtly different set.
 *
 * Returns false whenever there is nothing to compare — no measurement, no
 * threshold, or a zero delta. A warning nobody can act on is noise, and this
 * one sits between a driver and the only button on the screen.
 */
export function disagreesWithBuffer(
  typedKm: number,
  measuredKm: number | null,
  thresholdPercent: number | null,
): boolean {
  if (measuredKm === null || thresholdPercent === null || typedKm <= 0) {
    return false;
  }

  return (Math.abs(typedKm - measuredKm) / typedKm) * 100 > thresholdPercent;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
