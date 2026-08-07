import { useEffect, useRef, useState } from 'react'
import { fleetBounds, KAMPALA, planMarkers, speedLabel, toneFor, type Tone } from '../../lib/livePositions'
import type { LivePosition } from '../../types/livePosition'
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
 * Always the light basemap, never a dark one, even when the OS asks for
 * dark. This map is content rather than chrome: the marker colours below
 * were picked against pale ground, and on dark tiles a grey stale marker
 * disappears into the streets — which is the one marker that must not.
 */
const TONE_COLOUR: Record<Tone, string> = {
  moving: 'var(--kr-success)',
  stopped: 'var(--kr-info)',
  stale: 'var(--kr-neutral)',
}

/**
 * One vehicle's marker: a heading arrow when the device reported one, a
 * plain dot when it did not.
 *
 * A north-pointing arrow on a vehicle whose heading is unknown would be an
 * invention, and a dispatcher reads an arrow as a direction of travel.
 */
function markerElement(position: LivePosition): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'kr-fleet-marker'
  paintMarker(el, position)
  return el
}

function paintMarker(el: HTMLDivElement, position: LivePosition): void {
  const tone = toneFor(position)
  const colour = TONE_COLOUR[tone]
  const heading = position.heading_degrees

  // Rotation goes on the inner glyph, not on the marker root: MapLibre owns
  // the root's transform for positioning, and writing to it fights the SDK.
  el.innerHTML =
    heading === null
      ? `<span class="kr-fleet-dot" style="background:${colour}"></span>`
      : `<span class="kr-fleet-arrow" style="color:${colour};transform:rotate(${heading}deg)">
           <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
             <path fill="currentColor" stroke="#fff" stroke-width="1.5"
                   d="M12 2 L19 21 L12 17 L5 21 Z" />
           </svg>
         </span>`

  // The accessible name, and the tooltip. A marker that is only a colour is
  // not information (DESIGN.md: status is never colour-only).
  const speed = speedLabel(position)
  el.title = [`Vehicle ${position.vehicle_id}`, tone === 'stale' ? 'no recent report' : speed]
    .filter(Boolean)
    .join(' · ')
}

export interface FleetMapProps {
  positions: LivePosition[]
  /** Called when a marker is clicked, so the page can highlight its row. */
  onSelect?: (vehicleId: number) => void
  height?: number | string
}

export function FleetMap({ positions, onSelect, height = 520 }: FleetMapProps) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<import('maplibre-gl').Map | null>(null)
  const markers = useRef(new Map<number, import('maplibre-gl').Marker>())
  const gl = useRef<typeof import('maplibre-gl') | null>(null)
  const fitted = useRef(false)

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
      map.current?.remove()
      map.current = null
    }
  }, [])

  // Positions. Markers are moved, never rebuilt — see `planMarkers`.
  useEffect(() => {
    const engine = gl.current
    const instance = map.current
    if (!ready || engine === null || instance === null) return

    const plan = planMarkers(markers.current.keys(), positions)

    for (const id of plan.remove) {
      markers.current.get(id)?.remove()
      markers.current.delete(id)
    }

    for (const position of plan.add) {
      const el = markerElement(position)
      el.addEventListener('click', () => onSelect?.(position.vehicle_id))
      const marker = new engine.Marker({ element: el })
        .setLngLat([position.longitude, position.latitude])
        .addTo(instance)
      markers.current.set(position.vehicle_id, marker)
    }

    for (const position of plan.update) {
      const marker = markers.current.get(position.vehicle_id)
      if (marker === undefined) continue
      marker.setLngLat([position.longitude, position.latitude])
      paintMarker(marker.getElement() as HTMLDivElement, position)
    }

    // Framed **once**, on the first fleet we see. Re-fitting on every poll
    // would drag the viewport out from under a dispatcher who had zoomed
    // into a junction to watch one van, every ten seconds, forever.
    if (!fitted.current) {
      const bounds = fleetBounds(positions)
      if (bounds !== null) {
        instance.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 0 })
        fitted.current = true
      }
    }
  }, [positions, ready, onSelect])

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
        The map could not load. The list below is still live.
      </div>
    )
  }

  return (
    <div
      ref={container}
      data-testid="fleet-map"
      style={{ height, borderRadius: 'var(--radius-md)', overflow: 'hidden' }}
    />
  )
}
