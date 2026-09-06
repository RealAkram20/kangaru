import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fleetBounds,
  hasPosition,
  KAMPALA,
  planMarkers,
  speedLabel,
  statusLabel,
  toneFor,
  unitTitle,
  type FleetUnit,
  type Tone,
} from '../../lib/livePositions'
import { pinTitle, type RoutePin } from '../../lib/routeOverlay'
import { MapRecenterButton } from './MapRecenterButton'
import './fleetMap.css'

/**
 * The fleet on a map (ADR-0019, front end).
 *
 * Deliberately thin. Everything that *decides* anything — which markers to
 * add, move or drop, what a marker should say, how the viewport is framed —
 * lives in `lib/livePositions.ts` and is unit-tested there, because jsdom
 * cannot run a WebGL context and logic that only a human can exercise is
 * logic that rots. What is left here is the part that genuinely needs the
 * SDK: create a DOM node, hand it to MapLibre, move it.
 *
 * MapLibre is **dynamically imported** so it stays out of the main bundle
 * and out of the test environment. The project pins v5: v6's worker is
 * fetched at a path Vite does not serve, and the failure is a blank map with
 * a 404 nobody sees.
 */

/** CARTO's keyless Positron. Same basemap the public panel falls back to. */
const STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

/**
 * The same top-down sprite family the public order page draws — one visual
 * vocabulary for "a vehicle on a map" across the platform, so a dispatcher
 * and a customer are looking at the same fleet.
 */
const VEHICLE_SPRITES: Record<import('../../lib/livePositions').SpriteKind, string> = {
  sedan: '/assets/vehicles/sedan-top.svg',
  suv: '/assets/vehicles/suv-top.svg',
  pickup: '/assets/vehicles/pickup-top.svg',
  boda: '/assets/vehicles/boda-rider-top.svg',
}

/**
 * Always the light basemap, never a dark one, even when the OS asks for
 * dark. This map is content rather than chrome: the marker colours below
 * were picked against pale ground, and on dark tiles a grey stale marker
 * disappears into the streets — which is the one marker that must not.
 *
 * On a trip is blue, waiting for work is green — the dispatcher's question
 * this page answers is "who can take this job", and the convention the
 * office already speaks is counting green dots. Colour is never the only
 * carrier: every marker's tooltip and every list row says the same thing
 * in words.
 */
const TONE_COLOUR: Record<Tone, string> = {
  moving: 'var(--kr-info)',
  stopped: 'var(--kr-info)',
  waiting: 'var(--kr-success)',
  stale: 'var(--kr-neutral)',
}

/**
 * One unit's marker: the vehicle itself — the same top-down sprite the
 * public order page draws — rotated to its reported heading, with a small
 * status dot in the corner and the sprite greyed when the report is stale.
 *
 * This replaced a dot-and-arrow scheme after the owner read the green dot
 * as "a dot where the vehicle should be": a fleet map's subject is
 * vehicles, and the marker should look like one. The heading rotation is
 * only applied when the device reported one — a rotated vehicle reads as a
 * direction of travel, and inventing one would be a claim. An unrotated
 * sprite just points north, which reads as an icon, not a course.
 *
 * Status is never colour-only (DESIGN.md): the badge colour is paired with
 * the tooltip here and the labelled badge on the unit's row in the panel.
 */
function markerElement(unit: FleetUnit, selected: boolean): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'kr-fleet-marker'
  paintMarker(el, unit, selected)
  return el
}

function paintMarker(el: HTMLDivElement, unit: FleetUnit, selected: boolean): void {
  const tone = toneFor(unit)
  const colour = TONE_COLOUR[tone]
  const heading = unit.headingDegrees

  el.classList.toggle('kr-fleet-marker--selected', selected)
  el.classList.toggle('kr-fleet-marker--stale', tone === 'stale')

  // Rotation goes on the inner glyph, not on the marker root: MapLibre owns
  // the root's transform for positioning, and writing to it fights the SDK.
  el.innerHTML =
    `<span class="kr-fleet-unit"${heading === null ? '' : ` style="transform:rotate(${heading}deg)"`}>
       <img class="kr-fleet-vehicle" src="${VEHICLE_SPRITES[unit.spriteKind]}" width="44" height="44" alt="" />
     </span>
     <span class="kr-fleet-status" style="background:${colour}"></span>`

  // The accessible name, and the tooltip. A marker that is only a colour is
  // not information (DESIGN.md: status is never colour-only).
  el.title = [unitTitle(unit), unit.driverName, statusLabel(unit), speedLabel(unit)]
    .filter((part, index, parts) => Boolean(part) && parts.indexOf(part) === index)
    .join(' · ')
}

export interface FleetMapProps {
  units: FleetUnit[]
  /** The highlighted unit's key. The map flies to it when it changes. */
  selected?: string | null
  /** Called when a marker is clicked, so the page can highlight its row. */
  onSelect?: (key: string) => void
  height?: number | string
  /**
   * ADR-0045: the client's planned circuits, as numbered site pins.
   *
   * A separate marker set from `units` and drawn under them, because they
   * answer different questions and only one of them moves. Empty by default,
   * so every existing caller renders exactly what it rendered before.
   */
  routePins?: RoutePin[]
}

export function FleetMap({
  units,
  selected = null,
  onSelect,
  height = '100%',
  routePins = [],
}: FleetMapProps) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<import('maplibre-gl').Map | null>(null)
  const markers = useRef(new Map<string, import('maplibre-gl').Marker>())
  const gl = useRef<typeof import('maplibre-gl') | null>(null)
  const routeMarkers = useRef<import('maplibre-gl').Marker[]>([])
  const fitted = useRef(false)
  const lastFlown = useRef<string | null>(null)

  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)

  // The SDK and the map itself, once. Positions arrive on a separate effect
  // so a poll never rebuilds the map.
  useEffect(() => {
    let cancelled = false
    // The same Map instance the effect below mutates — captured here only so
    // the cleanup does not read `.current` after unmount, which is the shape
    // `react-hooks/exhaustive-deps` warns about. Copying is safe precisely
    // because it is a reference to a mutated object, not a snapshot of one.
    const onMap = markers.current

    Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')])
      .then(([mod]) => {
        if (cancelled || container.current === null) return

        gl.current = mod
        map.current = new mod.Map({
          container: container.current,
          style: STYLE,
          center: KAMPALA,
          zoom: 11,
          attributionControl: { compact: true },
        })
        map.current.addControl(new mod.NavigationControl({ showCompass: false }), 'top-right')
        map.current.on('load', () => !cancelled && setReady(true))
      })
      .catch(() => {
        // A blank pane with no explanation is the worst outcome; the page
        // renders its list instead and says the map could not load.
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      onMap.forEach((marker) => marker.remove())
      onMap.clear()
      for (const marker of routeMarkers.current) marker.remove()
      routeMarkers.current = []
      map.current?.remove()
      map.current = null
    }
  }, [])

  /**
   * Put every vehicle back in view.
   *
   * The one place the fleet's framing is decided, called from two: the first
   * poll, which frames silently, and the button, which animates because a
   * viewport that teleports leaves you working out where you now are.
   * Answers false when there is nothing to frame — a fleet with no fixes is
   * not a framing failure, it is a fleet nobody has heard from.
   */
  const frame = useCallback(
    ({ animate }: { animate: boolean }): boolean => {
      const instance = map.current
      if (instance === null) return false

      const bounds = fleetBounds(units)
      if (bounds === null) return false

      instance.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: animate ? 500 : 0 })

      return true
    },
    [units],
  )

  /*
   * The planned-circuit layer (ADR-0045).
   *
   * Rebuilt wholesale rather than diffed, unlike the unit markers above: a
   * route changes when somebody edits it, which is rarely, whereas a vehicle
   * moves every ten seconds. `planMarkers` exists for the second case and
   * would be ceremony here.
   *
   * Every pin reads the same — see `routeOverlay.ts`. There is no "visited"
   * state to colour, because trips do not carry stops yet.
   */
  useEffect(() => {
    const engine = gl.current
    const instance = map.current
    if (!ready || engine === null || instance === null) return

    for (const marker of routeMarkers.current) marker.remove()
    routeMarkers.current = []

    for (const pin of routePins) {
      const el = document.createElement('div')
      el.className = 'kr-route-site'

      const seq = document.createElement('span')
      seq.className = 'kr-route-site__seq'
      seq.textContent = String(pin.sequence)

      // The site's name beside its number, for the reason the builder gives:
      // a numbered dot is a riddle a dispatcher has to solve against a list
      // they are not looking at.
      const name = document.createElement('span')
      name.className = 'kr-route-site__name'
      name.textContent = pin.placeName

      el.append(seq, name)
      // The accessible name and the tooltip are the same sentence: a pin is
      // a number until something says which circuit it belongs to.
      el.title = pinTitle(pin)
      el.setAttribute('aria-label', pinTitle(pin))

      routeMarkers.current.push(
        new engine.Marker({ element: el }).setLngLat([pin.longitude, pin.latitude]).addTo(instance),
      )
    }
  }, [routePins, ready])

  // Units. Markers are moved, never rebuilt — see `planMarkers`.
  useEffect(() => {
    const engine = gl.current
    const instance = map.current
    if (!ready || engine === null || instance === null) return

    const plan = planMarkers(markers.current.keys(), units)

    for (const key of plan.remove) {
      markers.current.get(key)?.remove()
      markers.current.delete(key)
    }

    for (const unit of plan.add) {
      const el = markerElement(unit, unit.key === selected)
      el.addEventListener('click', () => onSelect?.(unit.key))
      const marker = new engine.Marker({ element: el })
        .setLngLat([unit.longitude as number, unit.latitude as number])
        .addTo(instance)
      markers.current.set(unit.key, marker)
    }

    for (const unit of plan.update) {
      const marker = markers.current.get(unit.key)
      if (marker === undefined) continue
      marker.setLngLat([unit.longitude as number, unit.latitude as number])
      paintMarker(marker.getElement() as HTMLDivElement, unit, unit.key === selected)
    }

    // Framed **once**, on the first fleet we see. Re-fitting on every poll
    // would drag the viewport out from under a dispatcher who had zoomed
    // into a junction to watch one van, every ten seconds, forever. The
    // recentre button below is how that decision stays reversible.
    if (!fitted.current && frame({ animate: false })) {
      fitted.current = true
    }
  }, [units, ready, onSelect, selected, frame])

  // Flying to a selection is an act, not a state, so it happens only when
  // the selection *changes* — a poll that re-renders with the same
  // selection must not re-centre a viewport the dispatcher has since moved.
  useEffect(() => {
    const instance = map.current
    if (!ready || instance === null) return
    if (selected === lastFlown.current) return
    lastFlown.current = selected

    if (selected === null) return
    const unit = units.find((u) => u.key === selected)
    if (unit === undefined || !hasPosition(unit)) return

    instance.flyTo({ center: [unit.longitude, unit.latitude], zoom: Math.max(instance.getZoom(), 14) })
    // A fleet framed by hand is a fleet framed; do not re-fit later.
    fitted.current = true
  }, [selected, units, ready])

  if (failed) {
    return (
      <div
        role="status"
        style={{
          height,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--surface-sunken)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--kr-gray-muted)',
          fontSize: 14,
        }}
      >
        The map could not load. The list is still live.
      </div>
    )
  }

  return (
    // Positioned, so the button below can sit over the canvas. `overflow`
    // stays on this element: the map's own corners are what the radius is
    // for, and the button is inside them.
    <div style={{ position: 'relative', height, minHeight: 320 }}>
      <div
        ref={container}
        data-testid="fleet-map"
        style={{ height: '100%', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}
      />
      {ready && <MapRecenterButton label="Show the whole fleet" onClick={() => frame({ animate: true })} />}
    </div>
  )
}
