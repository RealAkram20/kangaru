/// <reference types="google.maps" />
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { CircleDot, Crosshair, MapPin } from 'lucide-react'
import { fetchRoute } from './places'
import { loadGoogleMaps } from './googleMaps'
import type { VehicleKind } from './MapPanel'
import './landing.css'

/** Kampala city centre; the map opens on the service area, not the world. */
const KAMPALA = { lat: 0.3476, lng: 32.5825 }

const VEHICLE_SPRITES: Record<VehicleKind, string> = {
  sedan: '/assets/vehicles/sedan-top.svg',
  suv: '/assets/vehicles/suv-top.svg',
  pickup: '/assets/vehicles/pickup-top.svg',
  boda: '/assets/vehicles/boda-rider-top.svg',
}

/** The brand green, for the things Google draws rather than CSS. */
const GREEN = '#01903D'

/**
 * The Google Maps rendering of the same panel.
 *
 * Deliberately close to Google's stock styling. The whole reason for moving
 * to Google was the places — "Shell Ssonde", the fuel and restaurant pins,
 * the business names OpenStreetMap does not carry in Mukono — and
 * restyling them away would be paying for data and then hiding it. The
 * brand lives in the markers, the radius and the sheet, which is exactly
 * where the apps people already use here put it.
 *
 * Markers use the classic `google.maps.Marker`. `AdvancedMarkerElement` is
 * the newer API and would allow real HTML markers, but it requires a cloud
 * Map ID to render at all; this works with nothing but an API key. When a
 * Map ID exists (it also unlocks cloud styling), that is the migration.
 */
export function GoogleMapPanel({
  pickup,
  dropoff,
  center,
  from,
  to,
  matching = false,
  searching = false,
  captainAt = null,
  captainKind = 'sedan',
  sheetFraction,
  onUnsupported,
}: {
  pickup: string
  dropoff: string
  center: [number, number] | null
  from: [number, number] | null
  to: [number, number] | null
  matching?: boolean
  searching?: boolean
  captainAt?: [number, number] | null
  captainKind?: VehicleKind
  sheetFraction?: number
  /** Called when Google cannot load, so the caller can fall back to GL. */
  onUnsupported: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const youRef = useRef<google.maps.Marker | null>(null)
  const radiusRef = useRef<google.maps.Circle | null>(null)
  const captainRef = useRef<google.maps.Marker | null>(null)
  const endsRef = useRef<google.maps.Marker[]>([])
  const routeRef = useRef<google.maps.Polyline[]>([])
  const [ready, setReady] = useState(false)

  /** Pixels of map hidden behind the mobile sheet. */
  const bottomInset = () =>
    window.matchMedia('(min-width: 1024px)').matches || sheetFraction === undefined
      ? 0
      : Math.round(window.innerHeight * sheetFraction)

  useEffect(() => {
    if (containerRef.current === null) return
    let cancelled = false

    void loadGoogleMaps()
      .then((maps) => {
        if (cancelled || containerRef.current === null) return

        const map = new maps.Map(containerRef.current, {
          center: KAMPALA,
          zoom: 15,
          // Our own controls only — the reference has a floating recentre
          // and nothing else, and Google's default cluster fights the sheet.
          disableDefaultUI: true,
          clickableIcons: false,
          // One finger pans. The map is its own fixed layer here, so it is
          // not stealing a scroll from the page behind it.
          gestureHandling: 'greedy',
          keyboardShortcuts: false,
        })
        mapRef.current = map

        youRef.current = new maps.Marker({
          map,
          position: KAMPALA,
          clickable: false,
          zIndex: 3,
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: GREEN,
            fillOpacity: 1,
            strokeColor: '#FFFFFF',
            strokeWeight: 3,
          },
        })

        setReady(true)
      })
      .catch(() => {
        // No key, blocked host, or a billing problem: hand back to GL
        // rather than leave a blank rectangle where the map was.
        if (!cancelled) onUnsupported()
      })

    return () => {
      cancelled = true
      youRef.current?.setMap(null)
      radiusRef.current?.setMap(null)
      captainRef.current?.setMap(null)
      endsRef.current.forEach((m) => m.setMap(null))
      routeRef.current.forEach((l) => l.setMap(null))
      youRef.current = null
      radiusRef.current = null
      captainRef.current = null
      endsRef.current = []
      routeRef.current = []
      mapRef.current = null
      setReady(false)
    }
  }, [onUnsupported])

  /** Follow the fix, framed into the strip the sheet leaves visible. */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || map === null) return

    if (center !== null) {
      youRef.current?.setPosition({ lat: center[1], lng: center[0] })
      radiusRef.current?.setCenter({ lat: center[1], lng: center[0] })
    }
    if (from !== null && to !== null) return

    const target = center === null ? null : { lat: center[1], lng: center[0] }
    if (target === null) return
    map.panTo(target)
    // Push the subject up by half the sheet, so it sits in the middle of
    // what is actually visible rather than the middle of the container.
    const inset = bottomInset()
    if (inset > 0) map.panBy(0, inset / 2)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bottomInset reads live layout, not state
  }, [ready, center, from, to, sheetFraction])

  /** The search radius, as a real circle on the ground rather than a blob. */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || map === null) return
    const maps = google.maps

    youRef.current?.setIcon({
      path: maps.SymbolPath.CIRCLE,
      scale: 8,
      fillColor: matching ? GREEN : '#2D74F6',
      fillOpacity: 1,
      strokeColor: '#FFFFFF',
      strokeWeight: 3,
    })

    if (!searching) {
      radiusRef.current?.setMap(null)
      radiusRef.current = null
      return
    }
    if (radiusRef.current === null) {
      radiusRef.current = new maps.Circle({
        map,
        // 1.2km: roughly how far a captain worth offering the ride to is.
        // A real radius, so zooming out shows the area honestly.
        radius: 1200,
        center:
          center === null ? KAMPALA : { lat: center[1], lng: center[0] },
        strokeWeight: 0,
        fillColor: GREEN,
        fillOpacity: 0.18,
        clickable: false,
        zIndex: 1,
      })
    }
  }, [ready, matching, searching, center])

  /** The captain, once one is actually coming. */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || map === null) return
    const maps = google.maps

    if (captainAt === null) {
      captainRef.current?.setMap(null)
      captainRef.current = null
      return
    }
    const position = { lat: captainAt[1], lng: captainAt[0] }
    if (captainRef.current === null) {
      captainRef.current = new maps.Marker({
        map,
        position,
        clickable: false,
        zIndex: 4,
        icon: {
          url: VEHICLE_SPRITES[captainKind],
          scaledSize: new maps.Size(46, 46),
          anchor: new maps.Point(23, 23),
        },
      })
    } else {
      captainRef.current.setPosition(position)
    }

    if (center === null || (from !== null && to !== null)) return
    const bounds = new maps.LatLngBounds()
    bounds.extend(position)
    bounds.extend({ lat: center[1], lng: center[0] })
    map.fitBounds(bounds, { top: 110, bottom: bottomInset() + 40, left: 60, right: 100 })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bottomInset reads live layout, not state
  }, [ready, captainAt, captainKind, center, from, to])

  /** The trip, once both ends are known. */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || map === null) return
    const maps = google.maps

    const clear = () => {
      routeRef.current.forEach((l) => l.setMap(null))
      routeRef.current = []
      endsRef.current.forEach((m) => m.setMap(null))
      endsRef.current = []
    }

    if (from === null || to === null) {
      clear()
      return
    }

    let cancelled = false
    void fetchRoute(from, to).then((line) => {
      if (cancelled || mapRef.current === null || line === null) return
      clear()
      const path = line.map(([lng, lat]) => ({ lat, lng }))

      // White casing under the green keeps the line legible over roads.
      routeRef.current = [
        new maps.Polyline({ map, path, strokeColor: '#FFFFFF', strokeWeight: 9, zIndex: 1 }),
        new maps.Polyline({ map, path, strokeColor: GREEN, strokeWeight: 5, zIndex: 2 }),
      ]
      endsRef.current = [
        new maps.Marker({
          map,
          position: path[0],
          clickable: false,
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: '#FFFFFF',
            fillOpacity: 1,
            strokeColor: GREEN,
            strokeWeight: 5,
          },
        }),
        new maps.Marker({
          map,
          position: path[path.length - 1],
          clickable: false,
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: GREEN,
            fillOpacity: 1,
            strokeColor: '#FFFFFF',
            strokeWeight: 3,
          },
        }),
      ]

      const bounds = new maps.LatLngBounds()
      path.forEach((point) => bounds.extend(point))
      map.fitBounds(bounds, {
        top: 170,
        bottom: bottomInset() + 40,
        left: 44,
        right: 44,
      })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bottomInset reads live layout, not state
  }, [ready, from, to])

  const recentre = () => {
    const map = mapRef.current
    if (map === null || center === null) return
    map.panTo({ lat: center[1], lng: center[0] })
    const inset = bottomInset()
    if (inset > 0) map.panBy(0, inset / 2)
  }

  return (
    <aside className="fixed inset-0 lg:relative lg:inset-auto" aria-label="Map of the service area">
      <div className="h-full lg:sticky lg:top-16 lg:h-[calc(100dvh-4rem)] lg:border-l lg:border-border">
        <div ref={containerRef} className="h-full w-full" />

        {sheetFraction !== undefined && (
          <button
            type="button"
            onClick={recentre}
            aria-label="Recentre the map"
            className="absolute right-5 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-surface-card text-text-heading shadow-lg transition-transform duration-150 ease-[var(--kr-ease-out)] active:scale-95 bottom-[calc(var(--kr-sheet)*1dvh+1rem)] lg:bottom-6"
            style={{ '--kr-sheet': sheetFraction * 100 } as CSSProperties}
          >
            <Crosshair className="h-5 w-5" aria-hidden />
          </button>
        )}

        {(pickup.trim() !== '' || dropoff.trim() !== '') && (
          <div className="pointer-events-none absolute left-4 top-20 max-w-xs rounded-xl border border-border bg-surface-card/95 px-4 py-3 shadow-md backdrop-blur lg:left-6 lg:top-6">
            {pickup.trim() !== '' && (
              <p className="flex items-center gap-2 text-sm font-medium text-text-heading">
                <CircleDot className="h-4 w-4 shrink-0 text-brand-green" aria-hidden />
                From {pickup.trim()}
              </p>
            )}
            {dropoff.trim() !== '' && (
              <p className="mt-1 flex items-center gap-2 text-sm font-medium text-text-heading">
                <MapPin className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
                To {dropoff.trim()}
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
