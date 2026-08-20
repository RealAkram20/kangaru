import type { ClientRoute } from '../pages/routes/routeBuilder'

/**
 * A client's planned circuits, flattened for the live map (ADR-0045).
 *
 * ## What this layer is, and what it deliberately is not
 *
 * It is the **plan**: where a crew is meant to go today. A dispatcher
 * watching a corporate vehicle can see the ATM estate it is working through
 * and answer "is that car anywhere near its next site" — which is the
 * question the owner asked this feature for.
 *
 * It is **not** progress. "Stop 3 of 7, arrived 14 minutes ago" is a fact
 * about a *trip*, and trips have no stops yet (`trip_stops` is ADR-0045 §1's
 * evidence half, still unbuilt). Drawing a pin in a "done" colour here would
 * be inventing a state the platform cannot observe — so every pin on this
 * layer reads the same, and the layer is labelled a plan.
 *
 * ## And it is pins, not lines
 *
 * The builder draws a road because it asks the routing provider for one, for
 * the one route being edited. Doing that per route on a map that may show
 * twenty would be twenty billed requests on every page load, to render lines
 * nobody opened this page to read. Pins carry the useful half — *where* —
 * at no cost, and never imply a road the platform did not measure.
 */
export interface RoutePin {
  /** Unique across the layer: a place may sit on several routes. */
  key: string
  routeId: number
  routeName: string
  /** 1-based, matching the badge in the builder's rail. */
  sequence: number
  placeName: string
  latitude: number
  longitude: number
}

/**
 * Flatten routes into the pins the map draws.
 *
 * Retired routes are dropped: `is_active` false means the client stopped
 * running it, and a live map is about today. Stops with no loaded place are
 * dropped too — the resource only nests `place` when the relation was
 * eager-loaded, and a pin with no coordinates is not a pin.
 */
export function routePins(routes: ClientRoute[]): RoutePin[] {
  const pins: RoutePin[] = []

  for (const route of routes) {
    if (!route.is_active) continue

    for (const stop of route.stops ?? []) {
      const place = stop.place
      if (place === undefined) continue

      pins.push({
        key: `route-${route.id}-stop-${stop.id}`,
        routeId: route.id,
        routeName: route.name,
        sequence: stop.sequence,
        placeName: place.name,
        latitude: place.latitude,
        longitude: place.longitude,
      })
    }
  }

  return pins
}

/**
 * What a pin says when somebody hovers it.
 *
 * Names the route as well as the site, because the same ATM is on three
 * circuits and "Nakawa ATM" alone does not tell a dispatcher whose run they
 * are looking at.
 */
export function pinTitle(pin: RoutePin): string {
  return `${pin.routeName} · stop ${pin.sequence}: ${pin.placeName}`
}

/** "3 routes · 21 stops", or null when there is nothing to say. */
export function overlaySummary(routes: ClientRoute[]): string | null {
  const pins = routePins(routes)

  if (pins.length === 0) return null

  const count = new Set(pins.map((pin) => pin.routeId)).size

  return `${count === 1 ? '1 route' : `${count} routes`} · ${
    pins.length === 1 ? '1 stop' : `${pins.length} stops`
  }`
}
