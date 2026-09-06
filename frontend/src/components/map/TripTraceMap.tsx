import { useCallback, useEffect, useRef, useState } from 'react'
import { MapRecenterButton } from './MapRecenterButton'
import { KAMPALA } from '../../lib/livePositions'
import './fleetMap.css'

/** One recorded GPS fix, in the order the handset recorded it. */
export interface TracePoint {
  latitude: number
  longitude: number
}

/**
 * The road a finished trip actually took — the handset's recorded GPS
 * trace as a line, with the first and last fix marked. Read-only, no
 * polling, no interaction beyond pan and zoom.
 *
 * This is the *recorded* trace (`GET /trips/{id}/locations`), not the
 * planned road route the driver app draws before a trip: the record page
 * shows what happened, and what happened is what the odometer readings are
 * reconciled against (ADR-0016). Same basemap and bootstrap as `FleetMap`
 * so the two never look like two products.
 *
 * `points` empty renders nothing — the parent says "no trace recorded"
 * rather than showing an empty map that implies one exists.
 */
const STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
const SOURCE = 'kr-trace'

/**
 * MapLibre paints on a canvas, so a CSS custom property cannot reach a
 * layer's paint. Resolve the token at draw time instead of repeating its
 * hex here — the palette stays in one place (DESIGN.md §8) and the trace
 * follows the theme.
 */
function token(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

export function TripTraceMap({ points, height = 320 }: { points: TracePoint[]; height?: number | string }) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<import('maplibre-gl').Map | null>(null)
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')])
      .then(([mod]) => {
        if (cancelled || container.current === null) return
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
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      map.current?.remove()
      map.current = null
    }
  }, [])

  /**
   * Frame the whole trace, with breathing room; a single fix just centres.
   *
   * Shared by the draw effect and the recentre button, so the framing a
   * reader is put back to is the framing they were given — a second
   * `fitBounds` written for the button would be a second answer to "where
   * was this trip", and the two would drift.
   */
  const frame = useCallback(
    (animate: boolean) => {
      const instance = map.current
      if (instance === null || points.length === 0) return

      const coordinates = points.map((p) => [p.longitude, p.latitude] as [number, number])
      if (coordinates.length === 1) {
        instance.setCenter(coordinates[0])

        return
      }

      let west = Infinity
      let south = Infinity
      let east = -Infinity
      let north = -Infinity
      for (const [lng, lat] of coordinates) {
        west = Math.min(west, lng)
        east = Math.max(east, lng)
        south = Math.min(south, lat)
        north = Math.max(north, lat)
      }
      instance.fitBounds([[west, south], [east, north]], {
        padding: 40,
        maxZoom: 15,
        duration: animate ? 500 : 0,
      })
    },
    [points],
  )

  useEffect(() => {
    const instance = map.current
    if (!ready || instance === null || points.length === 0) return

    const coordinates = points.map((p) => [p.longitude, p.latitude] as [number, number])
    const line = {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates },
    }

    if (instance.getSource(SOURCE)) {
      ;(instance.getSource(SOURCE) as import('maplibre-gl').GeoJSONSource).setData(line)
    } else {
      instance.addSource(SOURCE, { type: 'geojson', data: line })
      // Casing then line, so the trace reads on both light roads and water.
      instance.addLayer({
        id: `${SOURCE}-casing`,
        type: 'line',
        source: SOURCE,
        paint: { 'line-color': token('--kr-white', 'white'), 'line-width': 7, 'line-opacity': 0.9 },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      })
      instance.addLayer({
        id: `${SOURCE}-line`,
        type: 'line',
        source: SOURCE,
        paint: { 'line-color': token('--kr-green', 'green'), 'line-width': 4 },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      })
    }

    frame(false)
  }, [ready, points, frame])

  if (failed) {
    return (
      <p style={{ margin: 0, padding: 'var(--space-6)', color: 'var(--text-secondary)', font: 'var(--type-body-dense)' }}>
        The map could not be loaded. The trace is still on record.
      </p>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100%', height }}>
      <div
        ref={container}
        role="img"
        aria-label={`Recorded GPS trace, ${points.length} positions`}
        style={{ width: '100%', height: '100%', borderRadius: 'var(--radius-card)', overflow: 'hidden' }}
      />
      {ready && points.length > 0 && (
        <MapRecenterButton label="Show the whole trace" onClick={() => frame(true)} />
      )}
    </div>
  )
}
