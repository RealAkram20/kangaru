import { useCallback, useEffect, useRef } from 'react'
import { KAMPALA } from '../../lib/livePositions'
import { MapRecenterButton } from '../../components/map/MapRecenterButton'
import '../../components/map/fleetMap.css'
import { decodePolyline, looksLikeUganda } from './polyline'
import type { DraftStop, DrawnRoute } from './routeBuilder'

const STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
const SOURCE = 'kr-route-line'

/**
 * The circuit on the keyless engine (ADR-0045).
 *
 * ## Why this exists at all
 *
 * The owner chose Google for this screen, and that choice stands: Kampala's
 * branch and business names are Google places, and on CARTO the officer
 * pinning "Centenary Nakawa" is reduced to an address hunt.
 *
 * But the key is optional and `frontend/.env.example` says so in as many
 * words — *"without it the map falls back to the engines below"*. Shipping a
 * builder whose map is a grey panel on every deployment that has not bought
 * a Directions plan is not a fallback, it is a broken screen. `FleetMap` and
 * `TripTraceMap` both already run this engine, so the console has one
 * anyway.
 *
 * The trade is stated rather than hidden: same pins, same line, same drag —
 * fewer business names on the tiles.
 *
 * ## The line is still the server's
 *
 * `polyline` is decoded, never derived, and the stops are **never joined
 * with a straight line** when there is no polyline to draw. That rule is not
 * about which engine renders it.
 */
export function LibreRouteMap({
  stops,
  drawn,
  selectedKey,
  onSelect,
  onMoveStop,
}: {
  stops: DraftStop[]
  drawn: DrawnRoute | null
  selectedKey: string | null
  onSelect: (key: string) => void
  onMoveStop: (key: string, latitude: number, longitude: number) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<import('maplibre-gl').Map | null>(null)
  const gl = useRef<typeof import('maplibre-gl') | null>(null)
  const markers = useRef<import('maplibre-gl').Marker[]>([])
  const ready = useRef(false)

  /**
   * Frame the whole circuit; a single stop just centres on it.
   *
   * Called from the draw pass, which frames silently while the officer is
   * still adding stops, and from the recentre button, which animates.
   * One function, so the view the button restores is the view the map gave
   * them — two `fitBounds` calls would be two answers to "where is this
   * route", and the button's would be the one that drifted.
   */
  const frame = useCallback(
    (animate: boolean) => {
      const instance = map.current
      const engine = gl.current
      if (instance === null || engine === null) return

      const duration = animate ? 500 : 0

      if (stops.length > 1) {
        const bounds = new engine.LngLatBounds()
        for (const stop of stops) bounds.extend([stop.place.longitude, stop.place.latitude])
        instance.fitBounds(bounds, { padding: 64, maxZoom: 15, duration })
      } else if (stops.length === 1) {
        instance.easeTo({
          center: [stops[0].place.longitude, stops[0].place.latitude],
          zoom: 14,
          duration,
        })
      }
    },
    [stops],
  )

  // v5 is pinned deliberately: v6's worker is fetched at a path Vite does
  // not serve, and the failure is a blank map with a 404 nobody sees.
  // `FleetMap` carries the same note.
  useEffect(() => {
    let cancelled = false

    void Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')])
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
        map.current.on('load', () => {
          if (!cancelled) ready.current = true
        })
      })
      .catch(() => {
        // Nothing to fall back to — this *is* the fallback. An empty map
        // container is the honest end state, and the rail beside it still
        // adds, orders and saves stops, which is the work.
      })

    return () => {
      cancelled = true
      map.current?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const instance = map.current
    const engine = gl.current
    if (instance === null || engine === null) return

    const draw = () => {
      for (const marker of markers.current) marker.remove()
      markers.current = []

      stops.forEach((stop, index) => {
        // Number *and* name. A row of numbered dots is unreadable without
        // constantly looking back at the rail to decode them — the officer
        // is checking that the circuit visits the right sites in the right
        // order, and that is a question about names.
        const el = document.createElement('div')
        el.className = 'kr-route-pin'
        el.title = `${index + 1}. ${stop.place.name}`

        const badge = document.createElement('span')
        badge.className = 'kr-route-pin__seq'
        badge.textContent = String(index + 1)

        const label = document.createElement('span')
        label.className = 'kr-route-pin__name'
        label.textContent = stop.place.name

        el.append(badge, label)

        if (stop.key === selectedKey) el.classList.add('kr-route-pin--selected')
        el.addEventListener('click', () => onSelect(stop.key))

        const marker = new engine.Marker({ element: el, draggable: true })
          .setLngLat([stop.place.longitude, stop.place.latitude])
          .addTo(instance)

        marker.on('dragend', () => {
          const at = marker.getLngLat()
          onMoveStop(stop.key, at.lat, at.lng)
        })

        markers.current.push(marker)
      })

      // The line, or nothing. `looksLikeUganda` guards the one silent
      // failure this format has — a wrong-precision string decodes to
      // well-formed coordinates in the wrong place, and drawing those would
      // put a plausible road across the Atlantic.
      const points = drawn === null ? [] : decodePolyline(drawn.polyline)
      // `as const` rather than a `GeoJSON.Feature` annotation: the ambient
      // GeoJSON namespace is not in this project's lib set, and `TripTraceMap`
      // builds the same object the same way.
      const line = {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: looksLikeUganda(points) ? points : [],
        },
      }

      const existing = instance.getSource(SOURCE)

      if (existing !== undefined) {
        ;(existing as import('maplibre-gl').GeoJSONSource).setData(line)
      } else {
        instance.addSource(SOURCE, { type: 'geojson', data: line })
        instance.addLayer({
          id: SOURCE,
          type: 'line',
          source: SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            // MapLibre paints on a canvas, so a CSS variable cannot reach
            // it — `TripTraceMap` resolves the token the same way.
            'line-color': token('--map-route', '#01903D'),
            'line-width': 4,
            'line-opacity': 0.9,
          },
        })
      }

      frame(false)
    }

    if (ready.current) {
      draw()
    } else {
      instance.once('load', draw)
    }
  }, [stops, drawn, selectedKey, onSelect, onMoveStop, frame])

  return (
    <div style={{ position: 'relative', height: '100%', minHeight: 320 }}>
      <div
        ref={container}
        role="application"
        aria-label="Map of this route"
        style={{
          height: '100%',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          border: '1px solid var(--border-default)',
        }}
      />
      {stops.length > 0 && (
        <MapRecenterButton label="Show the whole route" onClick={() => frame(true)} />
      )}
    </div>
  )
}

/** @see TripTraceMap — the same resolve-at-draw-time reason. */
function token(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()

  return value || fallback
}
