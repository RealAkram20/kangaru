/**
 * The route builder's types and its arithmetic (ADR-0045).
 *
 * Pure functions over server payloads, kept out of the components for the
 * reason `mobile/src/trips/places.ts` gives: these are the parts that can be
 * **wrong** rather than merely ugly, and a component test would have to
 * render and flush to reach them.
 *
 * ## What this module refuses to produce
 *
 * **A distance the platform did not measure.** `distanceLabel` renders an em
 * dash whenever the server sent no drawn route, and it never falls back to a
 * straight-line sum over the pins. ADR-0020 §3 refused exactly that
 * arithmetic, and `OsrmProvider`'s docblock records what it costs: on the
 * Misindye-to-Acacia run the crow's flight says 14.3 km where the road is
 * 19.8, a 39% understatement, on a figure a client would price against.
 *
 * **A duration.** Same rule, one step stronger: the server sends
 * `duration_seconds` only when the provider supplied one for every leg
 * (ADR-0031 §6), so a null here means "not stated" and never "quick".
 */

/** A location the client has pinned. Both coordinates are always present. */
export interface ClientPlace {
  id: number
  name: string
  address: string | null
  latitude: number
  longitude: number
  arrival_radius_m: number | null
  notes: string | null
  is_active: boolean
  route_count?: number
}

/** A place's position in a circuit, as the server returns it. */
export interface RouteStop {
  id: number
  sequence: number
  expected_dwell_minutes: number | null
  driver_notes: string | null
  place?: ClientPlace
}

export interface RouteMember {
  id: number
  name: string
}

export interface ClientRoute {
  id: number
  name: string
  reference: string | null
  notes: string | null
  is_active: boolean
  stop_count?: number
  stops?: RouteStop[]
  members?: RouteMember[]
}

/** What `POST /routes/preview` draws, or null when it could draw nothing. */
export interface DrawnRoute {
  polyline: string
  distance_km: number
  duration_seconds: number | null
  provider: 'google' | 'osrm'
  is_estimate: true
}

/**
 * A stop while it is being edited.
 *
 * Carries its own `key` because a circuit may legitimately visit one place
 * twice — head office at both ends is the ordinary shape of a cash run — and
 * a list keyed by `place.id` would give React two children with one key and
 * make the second undraggable. The key is local to the editing session and
 * is never sent.
 */
export interface DraftStop {
  key: string
  place: ClientPlace
  expected_dwell_minutes: number | null
  driver_notes: string | null
}

/** The em dash every figure this platform cannot produce renders as. */
export const NO_FIGURE = '—'

let nextKey = 0

export function draftStop(place: ClientPlace): DraftStop {
  nextKey += 1

  return { key: `stop-${nextKey}`, place, expected_dwell_minutes: null, driver_notes: null }
}

export function toDraft(stops: RouteStop[]): DraftStop[] {
  return stops
    .filter((stop): stop is RouteStop & { place: ClientPlace } => stop.place !== undefined)
    .map((stop) => ({
      ...draftStop(stop.place),
      expected_dwell_minutes: stop.expected_dwell_minutes,
      driver_notes: stop.driver_notes,
    }))
}

/**
 * Move one stop to another position, returning a new list.
 *
 * The single operation behind every way of reordering this screen offers —
 * the drag, the keyboard, and the move-up/move-down buttons — so all three
 * cannot disagree. Out-of-range indices return the list untouched rather
 * than throwing: a drop outside the rail is a cancelled drag, not an error.
 */
export function reorder<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return list
  if (from < 0 || from >= list.length) return list
  if (to < 0 || to >= list.length) return list

  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)

  return next
}

/** The ordered place ids a save or a preview sends. */
export function placeIds(stops: DraftStop[]): number[] {
  return stops.map((stop) => stop.place.id)
}

/** Two points is the floor: one place is not a journey. */
export function canDraw(stops: DraftStop[]): boolean {
  return stops.length >= 2
}

/**
 * Road distance, or an em dash.
 *
 * One decimal because that is the precision a road distance is useful at and
 * the precision `Route::toArray()` rounds to; a second would imply a survey.
 */
export function distanceLabel(route: DrawnRoute | null): string {
  if (route === null) return NO_FIGURE

  return `${route.distance_km.toFixed(1)} km`
}

/**
 * Driving time, or an em dash — and never a bare number.
 *
 * The word "estimate" travels with the figure because `is_estimate` travels
 * with the payload, and for the same reason: a rule written in a docblock
 * somewhere else is a rule somebody forgets.
 */
export function durationLabel(route: DrawnRoute | null): string {
  if (route === null || route.duration_seconds === null) return NO_FIGURE

  const minutes = Math.round(route.duration_seconds / 60)

  if (minutes < 60) return `${minutes} min estimate`

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60

  return rest === 0 ? `${hours} h estimate` : `${hours} h ${rest} min estimate`
}

/**
 * The same duration, split so a panel can size the number and the qualifier
 * differently.
 *
 * Rendering `durationLabel` in a KPI slot put "estimate" on screen at 32px,
 * where it shouted louder than the figure it qualifies — caught by looking
 * at the screen, not by a test. The word still travels with the number
 * (`is_estimate` is why); it just stops being the headline.
 */
export function durationParts(route: DrawnRoute | null): { value: string; note: string | null } {
  const label = durationLabel(route)

  if (label === NO_FIGURE) return { value: NO_FIGURE, note: null }

  return { value: label.replace(' estimate', ''), note: 'estimate' }
}

/** "7 stops", "1 stop", "No stops yet" — i18n-safe as one whole sentence. */
export function stopCountLabel(count: number): string {
  if (count === 0) return 'No stops yet'

  return count === 1 ? '1 stop' : `${count} stops`
}

/**
 * Why the distance is an em dash, in a sentence the officer can act on.
 *
 * `docs/screen-rules.md` §1: a missing figure renders as a dash **and a
 * short line saying why**. The three reasons are genuinely different actions
 * — add a stop, wait, or ask Shanitah to switch routing on — and collapsing
 * them into "unavailable" would leave a transport officer staring at a dash
 * with nothing to do about it.
 */
export function whyNoLine(stops: DraftStop[], drawing: boolean, drawn: DrawnRoute | null): string | null {
  if (drawn !== null) return null
  if (drawing) return 'Measuring the route…'
  if (!canDraw(stops)) return 'Add a second stop and the road distance appears here.'

  return 'The mapping service did not return a route. The stops are saved; only the drawn line and its distance are missing.'
}

/**
 * The one-line summary under the route's name.
 *
 * Built by joining parts rather than by interpolating a template with holes
 * in it, so a circuit with no drawn line reads "7 stops" instead of
 * "7 stops · — · —".
 */
export function summaryLine(stops: DraftStop[], drawn: DrawnRoute | null): string {
  const parts = [stopCountLabel(stops.length)]

  if (drawn !== null) {
    parts.push(distanceLabel(drawn))

    if (drawn.duration_seconds !== null) parts.push(durationLabel(drawn))
  }

  return parts.join(' · ')
}
