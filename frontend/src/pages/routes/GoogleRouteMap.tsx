/// <reference types="google.maps" />
import { useCallback, useEffect, useRef } from 'react'
import { MapRecenterButton } from '../../components/map/MapRecenterButton'
import { loadGoogleMaps } from '../public/googleMaps'
import type { DraftStop, DrawnRoute } from './routeBuilder'

/** Kampala city centre; the map opens on the service area, not the world. */
const KAMPALA = { lat: 0.3476, lng: 32.5825 }

/**
 * A design token, resolved to the value Google's canvas needs.
 *
 * Returns an empty string when the stylesheet has not loaded — in jsdom, and
 * for one frame on a cold start. Google treats an empty `strokeColor` as its
 * own default rather than throwing, which is the right failure: a line in
 * the wrong colour beats no line at all, and there is nothing here worth a
 * hardcoded hex to avoid it.
 */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/**
 * The circuit, drawn (ADR-0045).
 *
 * Google rather than the console's MapLibre/CARTO pair, and that was the
 * owner's call for one reason: the officer pinning "Centenary Nakawa" needs
 * to *see* the branch on the tiles. OpenStreetMap does not carry most of
 * Kampala's business names, so on CARTO the same job becomes an address
 * hunt. `GoogleMapPanel` made the same trade for the public order flow and
 * records it at length.
 *
 * ## The line is the server's or there is no line
 *
 * `polyline` arrives already drawn by the routing provider (ADR-0031 §1 —
 * the Directions credential never leaves the server). When it is null this
 * map renders **numbered pins and nothing between them**. It must never
 * join the pins with a straight line: `PickupMap` refuses the same thing for
 * the reason that matters here too — a straight line is not a road, and one
 * drawn across Kampala tells somebody to turn where there may be no turn.
 *
 * ## When Google cannot load
 *
 * `RouteMap` decides that before this component is mounted: no key means the
 * keyless MapLibre engine instead, never a grey panel. What is left here is
 * the narrower case — a key that exists and a script that fails anyway, on a
 * flaky connection — and `onUnsupported` hands those back to the chooser so
 * they fall the same way.
 */
export function GoogleRouteMap({
  stops,
  drawn,
  selectedKey,
  onSelect,
  onMoveStop,
  onUnsupported,
}: {
  stops: DraftStop[]
  drawn: DrawnRoute | null
  selectedKey: string | null
  onSelect: (key: string) => void
  /** A pin dragged to a better spot — the ATM is round the back of the building. */
  onMoveStop: (key: string, latitude: number, longitude: number) => void
  /** Google was configured and still failed; fall to the keyless engine. */
  onUnsupported: () => void
}) {
  /**
   * Frame the whole circuit.
   *
   * One function for the draw pass and the recentre button, so the view the
   * button restores is the view the map gave them. Google animates
   * `fitBounds` itself and offers no duration to turn that off, which is
   * why this takes no `animate` flag where the MapLibre twin does.
   */
  const frame = useCallback(() => {
    const map = mapRef.current
    if (map === null || stops.length === 0) return

    const bounds = new google.maps.LatLngBounds()
    for (const stop of stops) {
      bounds.extend({ lat: stop.place.latitude, lng: stop.place.longitude })
    }
    map.fitBounds(bounds, 64)
  }, [stops])

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])
  const lineRef = useRef<google.maps.Polyline | null>(null)
  // No local "failed" state: a failure is the chooser's to act on, and two
  // components each holding an opinion about which engine is live is how one
  // ends up rendering a panel the other has already replaced.

  useEffect(() => {
    if (containerRef.current === null) return

    let cancelled = false

    void loadGoogleMaps()
      .then((maps) => {
        if (cancelled || containerRef.current === null) return

        mapRef.current = new maps.Map(containerRef.current, {
          center: KAMPALA,
          zoom: 12,
          disableDefaultUI: true,
          zoomControl: true,
        })
      })
      .catch(() => {
        if (!cancelled) onUnsupported()
      })

    return () => {
      cancelled = true
    }
  }, [onUnsupported])

  // Markers and the line are redrawn together whenever either changes: they
  // are one picture, and a frame where pin 3 has moved but the line has not
  // is a circuit nobody drew.
  useEffect(() => {
    const map = mapRef.current
    if (map === null || typeof google === 'undefined') return

    for (const marker of markersRef.current) marker.setMap(null)
    markersRef.current = []

    stops.forEach((stop, index) => {
      const marker = new google.maps.Marker({
        map,
        position: { lat: stop.place.latitude, lng: stop.place.longitude },
        draggable: true,
        // The number is the whole point: this is stop 3 of 7, and the
        // officer reads the circuit off the map as much as off the rail.
        // Same reason as the polyline: Google renders this label itself, so
        // the token is resolved rather than referenced.
        label: {
          text: String(index + 1),
          color: token('--kr-white'),
          fontSize: '12px',
          fontWeight: '600',
        },
        title: `${index + 1}. ${stop.place.name}`,
        zIndex: stop.key === selectedKey ? 2 : 1,
      })

      marker.addListener('click', () => onSelect(stop.key))
      marker.addListener('dragend', (event: google.maps.MapMouseEvent) => {
        const at = event.latLng
        if (at !== null && at !== undefined) onMoveStop(stop.key, at.lat(), at.lng())
      })

      markersRef.current.push(marker)
    })

    lineRef.current?.setMap(null)
    lineRef.current = null

    if (drawn !== null) {
      lineRef.current = new google.maps.Polyline({
        map,
        path: google.maps.geometry.encoding.decodePath(drawn.polyline),
        // Google draws this on its own canvas, so a CSS variable cannot
        // reach it — the token is resolved to a value instead. Reading it
        // rather than hardcoding is what keeps DESIGN.md §8 true here: the
        // palette still owns the colour, and a theme change still moves it.
        strokeColor: token('--map-route'),
        strokeOpacity: 0.9,
        strokeWeight: 4,
      })
    }

    // Frame the whole circuit, but only while it is being built up — once
    // the officer has panned somewhere deliberately, re-fitting on every
    // edit would fight them for control of the map. The recentre button
    // below is how that stays their decision rather than a dead end.
    if (markersRef.current.length !== 0) frame()
  }, [stops, drawn, selectedKey, onSelect, onMoveStop, frame])

  return (
    <div style={{ position: 'relative', height: '100%', minHeight: 320 }}>
      <div
        ref={containerRef}
        role="application"
        aria-label="Map of this route"
        style={{
          height: '100%',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          border: '1px solid var(--border-default)',
        }}
      />
      {stops.length > 0 && <MapRecenterButton label="Show the whole route" onClick={frame} />}
    </div>
  )
}
