import type { LivePosition, NearbyVehicle, OnDutyDriver } from '../types/livePosition'
import type { TripStatus } from '../types/trip'
import { tripStatusLabel } from './tripStatus'

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
 * explicitly defers it. When it lands, this constant and the page's polling
 * effect are what it replaces.
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
 * One thing on the map — a vehicle on a trip, or a driver waiting for one.
 *
 * The two endpoints behind the page describe different objects (`/live-
 * positions` a vehicle, `/driver-presence` a driver), and a dispatcher
 * thinks in neither: they think "Grace, in the Noah, heading to pickup".
 * This is that sentence as data, built once by `buildUnits` so the list,
 * the markers, the filters and the search all read the same thing.
 */
export interface FleetUnit {
  /** Stable across polls: `v:<vehicle_id>` or `d:<driver_id>`. */
  key: string
  kind: 'on_trip' | 'waiting'
  /**
   * Where the coordinates came from. `vehicle` is the trip's own GPS
   * stream; `handset` is the driver's presence heartbeat, used only when a
   * driver is on a trip whose vehicle has not reported yet. The page says
   * which, because the two differ in cadence and in what they prove.
   */
  source: 'vehicle' | 'handset'
  vehicleId: number | null
  driverId: number | null
  tripId: number | null
  tripStatus: string | null
  plate: string | null
  /** "Toyota Noah", or null when the register has neither. */
  vehicleName: string | null
  driverName: string | null
  origin: string | null
  destination: string | null
  clientName: string | null
  /** Null when the platform has no position for this unit — never zero. */
  latitude: number | null
  longitude: number | null
  speedKph: number | null
  headingDegrees: number | null
  /** Null when never reported. */
  ageSeconds: number | null
  stale: boolean
  /** Which silhouette the map draws — from the vehicle's category. */
  spriteKind: SpriteKind
}

/** The four top-down sprites in public/assets/vehicles. */
export type SpriteKind = 'sedan' | 'suv' | 'pickup' | 'boda'

/**
 * Category → silhouette, the same nearest-honest-shape table the backend
 * uses for the public read's `kind`: a tricycle rendered with the rider
 * silhouette and a van with the SUV's box are as close as a four-sprite
 * set gets. Unknown or missing categories draw the sedan — a generic car,
 * not a claim.
 */
const SPRITE_KINDS: Record<string, SpriteKind> = {
  boda: 'boda',
  tricycle: 'boda',
  sedan: 'sedan',
  suv: 'suv',
  van: 'suv',
  minibus: 'suv',
  bus: 'suv',
  pickup: 'pickup',
  truck: 'pickup',
}

export function spriteKindFor(category: string | null | undefined): SpriteKind {
  return SPRITE_KINDS[category ?? ''] ?? 'sedan'
}

function vehicleName(vehicle: { make: string | null; model: string | null } | null | undefined): string | null {
  const name = [vehicle?.make, vehicle?.model].filter(Boolean).join(' ')
  return name === '' ? null : name
}

/**
 * The two lists, merged into one.
 *
 * A vehicle on a trip is the authority on that trip — its GPS stream is the
 * billing evidence and reports every few seconds — so a driver whose
 * presence names the same trip is folded into it, not drawn twice. A driver
 * whose trip has no vehicle position yet (the trip just started, or the
 * vehicle's device is dark) is drawn from their handset and says so. A
 * driver with no trip is waiting for work.
 *
 * Order is not meaningful here; `byAttention` sorts for the list.
 */
export function buildUnits(positions: LivePosition[], onDuty: OnDutyDriver[]): FleetUnit[] {
  const units: FleetUnit[] = positions.map((p) => ({
    key: `v:${p.vehicle_id}`,
    kind: 'on_trip',
    source: 'vehicle',
    vehicleId: p.vehicle_id,
    driverId: p.driver?.id ?? p.driver_id,
    tripId: p.trip_id,
    tripStatus: p.trip?.status ?? null,
    plate: p.vehicle?.registration_number ?? null,
    vehicleName: vehicleName(p.vehicle),
    driverName: p.driver?.name ?? null,
    origin: p.trip?.origin ?? null,
    destination: p.trip?.destination ?? null,
    clientName: p.trip?.client?.name ?? null,
    latitude: p.latitude,
    longitude: p.longitude,
    speedKph: p.speed_kph,
    headingDegrees: p.heading_degrees,
    ageSeconds: p.age_seconds,
    stale: p.stale,
    spriteKind: spriteKindFor(p.vehicle?.category),
  }))

  const tripsDrawn = new Set(positions.map((p) => p.trip_id))

  for (const d of onDuty) {
    if (d.trip !== null && tripsDrawn.has(d.trip.id)) continue

    units.push({
      key: `d:${d.driver_id}`,
      kind: d.trip === null ? 'waiting' : 'on_trip',
      source: 'handset',
      vehicleId: d.vehicle?.id ?? d.vehicle_id,
      driverId: d.driver_id,
      tripId: d.trip?.id ?? null,
      tripStatus: d.trip?.status ?? null,
      plate: d.vehicle?.registration_number ?? null,
      vehicleName: vehicleName(d.vehicle),
      driverName: d.driver?.name ?? null,
      origin: null,
      destination: null,
      clientName: null,
      latitude: d.latitude,
      longitude: d.longitude,
      speedKph: null,
      headingDegrees: null,
      ageSeconds: d.age_seconds,
      stale: d.stale,
      spriteKind: spriteKindFor(d.vehicle?.category),
    })
  }

  return units
}

/**
 * The anonymized pool, as a corporate client's live map sees it.
 *
 * `/driver-presence` refuses a client's people — the riders are Shanitah's
 * (security-gate F2) — so their capacity view is the same public read the
 * order page draws its ambient fleet from: positions and silhouettes, an
 * hourly-rotating key, nothing that joins back to the register. Each entry
 * becomes a waiting unit titled by its vehicle category, which is all this
 * surface knows about it and therefore all it says.
 */
export function nearbyToUnits(nearby: NearbyVehicle[]): FleetUnit[] {
  return nearby.map((vehicle) => ({
    key: `n:${vehicle.key}`,
    kind: 'waiting' as const,
    source: 'handset' as const,
    vehicleId: null,
    driverId: null,
    tripId: null,
    tripStatus: null,
    plate: null,
    vehicleName: categoryLabel(vehicle.category),
    driverName: null,
    origin: null,
    destination: null,
    clientName: null,
    latitude: vehicle.latitude,
    longitude: vehicle.longitude,
    speedKph: null,
    headingDegrees: null,
    ageSeconds: vehicle.age_seconds,
    stale: false,
    spriteKind: vehicle.kind,
  }))
}

/** "boda" → "Boda"; null → the honest generic. */
export function categoryLabel(category: string | null): string {
  if (category === null) return 'Vehicle'
  return category.charAt(0).toUpperCase() + category.slice(1).replaceAll('_', ' ')
}

/** Whether this unit can be drawn at all. */
export function hasPosition(unit: FleetUnit): unit is FleetUnit & { latitude: number; longitude: number } {
  return unit.latitude !== null && unit.longitude !== null
}

/**
 * The box containing every unit that has a position, or null when there is
 * nothing to fit.
 *
 * Returned rather than applied so the caller decides *when* to fit — see
 * `FleetMap`, which fits once and then leaves the viewport alone.
 */
export function fleetBounds(units: FleetUnit[]): Bounds | null {
  const placed = units.filter(hasPosition)
  if (placed.length === 0) return null

  const lngs = placed.map((p) => p.longitude)
  const lats = placed.map((p) => p.latitude)

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
 * matters to somebody deciding whether to call the driver. `waiting` is a
 * driver on duty with no trip — the dispatch pool.
 */
export type Tone = 'moving' | 'stopped' | 'waiting' | 'stale'

/**
 * A speed under this reads as stopped rather than moving.
 *
 * Not zero: GPS jitter on a parked vehicle routinely reports one or two
 * km/h, and a marker that alternates between "moving" and "stopped" while
 * a van sits in a yard is worse than one that commits.
 */
const STOPPED_UNDER_KPH = 3

export function toneFor(unit: FleetUnit): Tone {
  if (unit.stale) return 'stale'
  if (unit.kind === 'waiting') return 'waiting'
  if (unit.speedKph === null || unit.speedKph < STOPPED_UNDER_KPH) return 'stopped'
  return 'moving'
}

/**
 * What the status column and the badge say. Never colour-only, so this is
 * the text the tone is paired with everywhere.
 *
 * A unit on a trip says where in the trip it is — "Driver en route",
 * "Passenger onboard" — from the same table the trips list uses, so the
 * two pages never disagree about what a status is called.
 */
export function statusLabel(unit: FleetUnit): string {
  if (unit.stale) return unit.ageSeconds === null ? 'No position' : 'Not reporting'
  if (unit.kind === 'waiting') return 'Waiting for work'
  if (unit.tripStatus !== null) return tripStatusLabel(unit.tripStatus as TripStatus)
  return toneFor(unit) === 'moving' ? 'Moving' : 'Stopped'
}

/** Lucide icon for the status badge, paired with `statusLabel`. */
export function statusIcon(unit: FleetUnit): string {
  switch (toneFor(unit)) {
    case 'stale':
      return 'signal-zero'
    case 'waiting':
      return 'circle-dot'
    case 'moving':
      return 'navigation'
    case 'stopped':
      return 'circle-pause'
  }
}

/**
 * The one line that names a unit: the plate, else the driver, else the id.
 * A plate is what a dispatcher radios; a name is what they say on the
 * phone; an id is the honest fallback when the API predates both.
 */
export function unitTitle(unit: FleetUnit): string {
  if (unit.plate !== null) return unit.plate
  if (unit.driverName !== null) return unit.driverName
  // An anonymized nearby unit has no ids at all — its category is its name.
  if (unit.vehicleId === null && unit.driverId === null) return unit.vehicleName ?? 'Vehicle'
  if (unit.vehicleId !== null) return `Vehicle #${unit.vehicleId}`
  return `Driver #${unit.driverId ?? '?'}`
}

/**
 * Age as a dispatcher would say it.
 *
 * Deliberately coarse above a minute. "Last seen 4m ago" is actionable;
 * "4m 12s" invites somebody to read precision into a number whose input is
 * a phone's clock over a mobile network.
 */
export function freshnessLabel(ageSeconds: number | null): string {
  // Never reported. Not "—": the page pairs this with "No position", and
  // the two together say exactly what happened.
  if (ageSeconds === null) return 'never'
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
export function speedLabel(unit: FleetUnit): string | null {
  if (unit.speedKph === null) return null
  return `${Math.round(unit.speedKph)} km/h`
}

/**
 * What to do to the markers already on the map to make them match `next`.
 *
 * The map holds one marker per unit and **moves** it, rather than clearing
 * the layer and rebuilding it every ten seconds. Rebuilding is simpler and
 * is what the first attempt did; it also makes every marker blink on every
 * poll, drops any popup the dispatcher had open, and throws away the DOM
 * node MapLibre is mid-transition on. A dispatcher watching a van approach
 * a junction sees a flicker instead of a movement.
 *
 * A unit without a position is not a marker: it is planned for removal if
 * it had one (a handset that stopped reporting keeps its row in the list,
 * not a dot at its last place — the server has already told us that place
 * is not to be trusted by returning null).
 */
export interface MarkerPlan {
  add: FleetUnit[]
  update: FleetUnit[]
  /** Keys whose trip ended, which left this caller's scope, or which lost their position. */
  remove: string[]
}

export function planMarkers(existing: Iterable<string>, next: FleetUnit[]): MarkerPlan {
  const onMap = new Set(existing)
  const placed = next.filter(hasPosition)
  const incoming = new Set(placed.map((u) => u.key))

  return {
    add: placed.filter((u) => !onMap.has(u.key)),
    update: placed.filter((u) => onMap.has(u.key)),
    remove: [...onMap].filter((key) => !incoming.has(key)),
  }
}

/**
 * Sort order for the list beside the map: the ones needing attention first.
 *
 * Stale before moving before stopped before waiting, then oldest report
 * first inside each group. A dispatcher scanning the list is looking for
 * the vehicle nobody has heard from, and it should never be below the
 * twelve that are fine; the pool waiting for work is context, and goes
 * last.
 */
const TONE_ORDER: Record<Tone, number> = { stale: 0, moving: 1, stopped: 2, waiting: 3 }

export function byAttention(a: FleetUnit, b: FleetUnit): number {
  const byTone = TONE_ORDER[toneFor(a)] - TONE_ORDER[toneFor(b)]
  if (byTone !== 0) return byTone

  // Never reported sorts above the merely old: nothing is older than never.
  return (b.ageSeconds ?? Number.POSITIVE_INFINITY) - (a.ageSeconds ?? Number.POSITIVE_INFINITY)
}

/** The panel's filter chips. `all` is the absence of one. */
export type UnitFilter = 'all' | 'on_trip' | 'waiting' | 'stale'

export function matchesFilter(unit: FleetUnit, filter: UnitFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'stale':
      return unit.stale
    case 'on_trip':
      return unit.kind === 'on_trip'
    case 'waiting':
      return unit.kind === 'waiting'
  }
}

/**
 * Free-text search over what a dispatcher would type: a plate, a name, a
 * trip number, a client. Case- and space-insensitive on the plate, because
 * "ubk421h" is how it gets typed in a hurry.
 */
export function matchesQuery(unit: FleetUnit, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true

  const compact = q.replace(/\s+/g, '')
  const haystacks = [
    unit.plate?.toLowerCase().replace(/\s+/g, ''),
    unit.driverName?.toLowerCase(),
    unit.vehicleName?.toLowerCase(),
    unit.clientName?.toLowerCase(),
    unit.tripId === null ? null : `#${unit.tripId}`,
    unit.tripId === null ? null : String(unit.tripId),
  ]

  return haystacks.some((h) => h !== null && h !== undefined && (h.includes(q) || h.includes(compact)))
}

/** The headline counts: what is on the road, who is waiting, who is dark. */
export function summarise(units: FleetUnit[]): { onTrip: number; waiting: number; stale: number } {
  return {
    onTrip: units.filter((u) => u.kind === 'on_trip').length,
    waiting: units.filter((u) => u.kind === 'waiting').length,
    stale: units.filter((u) => u.stale).length,
  }
}
