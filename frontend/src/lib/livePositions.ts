import type { LivePosition } from '../types/livePosition'

/**
 * The live map's rules, kept out of the map component so they can be tested
 * without a WebGL context.
 *
 * The component below this is deliberately thin: create a marker, move a
 * marker, remove a marker. Everything that decides *which* of those to do,
 * and what a marker should say, is here — because jsdom cannot run MapLibre,
 * and logic that can only be exercised by hand is logic that quietly rots.
 */

/**
 * How often the map asks the server where the fleet is.
 *
 * Ten seconds, chosen against PROJECT.md's two numbers rather than by feel:
 * position freshness under 15 seconds, and 200 concurrent dashboard users.
 * At this interval a marker is never more than ten seconds behind the last
 * report, which sits inside the target with room for the request itself,
 * and the whole dashboard population costs the API about 20 requests per
 * second — one indexed read each (ADR-0019).
 *
 * Faster would spend that budget for an improvement no dispatcher can see:
 * devices report every few seconds, so polling at 2s mostly re-fetches
 * positions that have not changed.
 *
 * ADR-0019 names broadcasting over Reverb as the better answer and
 * explicitly defers it. When it lands, this constant and `useFleetPolling`
 * are what it replaces.
 */
export const POLL_MS = 10_000

/**
 * Kampala city centre — where the map opens before any position arrives.
 *
 * Longitude first, matching MapLibre's `LngLat` order. Written as a named
 * constant with the order in its type because this pair swapped is a valid
 * coordinate 3,500km away in the Gulf of Guinea, and the backend has been
 * caught by exactly that twice (ADR-0021).
 */
export const KAMPALA: [lng: number, lat: number] = [32.5825, 0.3476]

/** MapLibre's `LngLatBoundsLike` corner pair. */
export type Bounds = [southWest: [number, number], northEast: [number, number]]

/**
 * The box containing every vehicle, or null when there is nothing to fit.
 *
 * Returned rather than applied so the caller decides *when* to fit — see
 * `LiveMapPage`, which fits once and then leaves the viewport alone.
 */
export function fleetBounds(positions: LivePosition[]): Bounds | null {
  if (positions.length === 0) return null

  const lngs = positions.map((p) => p.longitude)
  const lats = positions.map((p) => p.latitude)

  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ]
}

/**
 * How a marker should read.
 *
 * `stale` comes from the server and outranks everything: a vehicle whose
 * last report is old is not "stopped", it is unknown, and the difference
 * matters to somebody deciding whether to call the driver.
 */
export type Tone = 'moving' | 'stopped' | 'stale'

/**
 * A speed under this reads as stopped rather than moving.
 *
 * Not zero: GPS jitter on a parked vehicle routinely reports one or two
 * km/h, and a marker that alternates between "moving" and "stopped" while
 * a van sits in a yard is worse than one that commits.
 */
const STOPPED_UNDER_KPH = 3

export function toneFor(position: LivePosition): Tone {
  if (position.stale) return 'stale'
  if (position.speed_kph === null || position.speed_kph < STOPPED_UNDER_KPH) return 'stopped'
  return 'moving'
}

/**
 * Age as a dispatcher would say it.
 *
 * Deliberately coarse above a minute. "Last seen 4m ago" is actionable;
 * "4m 12s" invites somebody to read precision into a number whose input is
 * a phone's clock over a mobile network.
 */
export function freshnessLabel(ageSeconds: number): string {
  // A device clock running slightly ahead of the server's yields a negative
  // age. It is not evidence of anything, so it reads as the newest thing it
  // could be rather than as "-3s ago", which looks like a bug in the map.
  if (ageSeconds <= 5) return 'just now'
  if (ageSeconds < 60) return `${Math.round(ageSeconds)}s ago`

  const minutes = Math.floor(ageSeconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

/** Speed as shown on a marker's label; null stays absent, never "0 km/h". */
export function speedLabel(position: LivePosition): string | null {
  if (position.speed_kph === null) return null
  return `${Math.round(position.speed_kph)} km/h`
}

/**
 * What to do to the markers already on the map to make them match `next`.
 *
 * The map holds one marker per vehicle and **moves** it, rather than
 * clearing the layer and rebuilding it every ten seconds. Rebuilding is
 * simpler and is what the first attempt did; it also makes every marker
 * blink on every poll, drops any popup the dispatcher had open, and throws
 * away the DOM node MapLibre is mid-transition on. A dispatcher watching a
 * van approach a junction sees a flicker instead of a movement.
 */
export interface MarkerPlan {
  add: LivePosition[]
  update: LivePosition[]
  /** Vehicle ids whose trip ended, or which left this caller's scope. */
  remove: number[]
}

export function planMarkers(existing: Iterable<number>, next: LivePosition[]): MarkerPlan {
  const onMap = new Set(existing)
  const incoming = new Set(next.map((p) => p.vehicle_id))

  return {
    add: next.filter((p) => !onMap.has(p.vehicle_id)),
    update: next.filter((p) => onMap.has(p.vehicle_id)),
    remove: [...onMap].filter((id) => !incoming.has(id)),
  }
}

/**
 * Sort order for the list beside the map: the ones needing attention first.
 *
 * Stale before moving before stopped, then oldest report first inside each
 * group. A dispatcher scanning the list is looking for the vehicle nobody
 * has heard from, and it should never be below the twelve that are fine.
 */
const TONE_ORDER: Record<Tone, number> = { stale: 0, moving: 1, stopped: 2 }

export function byAttention(a: LivePosition, b: LivePosition): number {
  const byTone = TONE_ORDER[toneFor(a)] - TONE_ORDER[toneFor(b)]
  if (byTone !== 0) return byTone

  return b.age_seconds - a.age_seconds
}
