import type { NearbyVehicle } from '../../types/livePosition'

/**
 * The live ambient fleet's arithmetic, kept out of the map panels so it can
 * be tested without a map (the same split `lib/livePositions.ts` uses for
 * the console's map).
 *
 * `GET /public/nearby-vehicles` serves positions but no headings — the
 * presence heartbeat carries none. A top-down car sprite has to point
 * somewhere, so the heading is **derived from movement between polls**:
 * real data when the vehicle moved, the previous answer when it did not,
 * and a stable per-key rotation for a vehicle we are seeing for the first
 * time (presentation, not a claim — the alternative is a whole fleet
 * parked in formation facing north, which reads as fake precisely because
 * it is).
 */

/** How often the order page asks who is nearby. Matches the console's map. */
export const NEARBY_POLL_MS = 10_000

/** A vehicle as the map panels draw it: where, what shape, pointing where. */
export interface FleetSprite {
  key: string
  kind: NearbyVehicle['kind']
  lngLat: [number, number]
  /** Compass degrees. Derived from movement; see the module doc. */
  heading: number
}

/**
 * Movement below this is GPS jitter, not travel — the same reasoning as
 * the console's `STOPPED_UNDER_KPH`, in metres because this is per-poll.
 */
const MOVED_AT_LEAST_METRES = 8

/** Metres per degree of latitude, near enough at Kampala's latitude. */
const METRES_PER_DEGREE = 111_320

/** Compass bearing from one point to the next, 0 = north. */
export function bearingBetween(from: [number, number], to: [number, number]): number {
  const dLng = (to[0] - from[0]) * Math.cos((((from[1] + to[1]) / 2) * Math.PI) / 180)
  const dLat = to[1] - from[1]
  const degrees = (Math.atan2(dLng, dLat) * 180) / Math.PI
  return (degrees + 360) % 360
}

function metresApart(a: [number, number], b: [number, number]): number {
  const dLat = (b[1] - a[1]) * METRES_PER_DEGREE
  const dLng = (b[0] - a[0]) * METRES_PER_DEGREE * Math.cos((a[1] * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLng * dLng)
}

/**
 * A first-sighting rotation that is stable for the key: the same vehicle
 * does not spin between renders, and a lot full of newcomers does not all
 * face the same way.
 */
export function headingFromKey(key: string): number {
  let hash = 0
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

/**
 * Folds a fresh poll into the sprites already on the map.
 *
 * Keys that vanished are dropped (the driver went off duty, took a job, or
 * the hourly key rotated — either way the marker goes and a new one may
 * arrive). Keys that moved get a heading computed from the movement; keys
 * that sat still keep the heading they had, so a parked vehicle does not
 * twitch with every metre of jitter.
 */
export function mergeFleet(previous: FleetSprite[], next: NearbyVehicle[]): FleetSprite[] {
  const before = new Map(previous.map((sprite) => [sprite.key, sprite]))

  return next.map((vehicle) => {
    const lngLat: [number, number] = [vehicle.longitude, vehicle.latitude]
    const prior = before.get(vehicle.key)

    if (prior === undefined) {
      return { key: vehicle.key, kind: vehicle.kind, lngLat, heading: headingFromKey(vehicle.key) }
    }

    const heading =
      metresApart(prior.lngLat, lngLat) >= MOVED_AT_LEAST_METRES
        ? bearingBetween(prior.lngLat, lngLat)
        : prior.heading

    return { key: vehicle.key, kind: vehicle.kind, lngLat, heading }
  })
}
