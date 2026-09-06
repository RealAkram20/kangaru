import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { CircleDot, Crosshair, MapPin } from 'lucide-react'
import { fetchRoute } from './places'
import { googleMapsAvailable } from './googleMaps'
import { GoogleMapPanel } from './GoogleMapPanel'
import type { FleetSprite } from './nearbyVehicles'
import './landing.css'

/** Kampala city centre; the map opens on the service area, not the world. */
const KAMPALA: [number, number] = [32.5825, 0.3476]

/**
 * The GL surface both engines share. The SDKs are dynamically imported so
 * they stay out of the main bundle and out of jsdom; if GL init fails the
 * panel falls back to OpenStreetMap's keyless embed rather than a blank pane.
 */
type MapEngine = Pick<
  typeof import('maplibre-gl'),
  'Map' | 'Marker' | 'AttributionControl' | 'NavigationControl'
>

/**
 * Mapbox GL once a token is configured; MapLibre GL over CARTO's keyless
 * Positron until then. Both expose the same Map/Marker surface, so the
 * single cast below is safe for everything this panel touches.
 *
 * Always the light basemap, never a dark one, even when the OS asks for
 * dark: this map is content rather than chrome. The white-bodied vehicle
 * sprites and the blue location halo were drawn for a pale ground, and on
 * dark tiles they glare and the streets stop being readable.
 */
async function loadMapEngine(token: string | undefined): Promise<{ gl: MapEngine; style: string }> {
  if (token) {
    const [mod] = await Promise.all([import('mapbox-gl'), import('mapbox-gl/dist/mapbox-gl.css')])
    mod.default.accessToken = token
    return {
      gl: mod.default as unknown as MapEngine,
      style: 'mapbox://styles/mapbox/light-v11',
    }
  }
  const [mod] = await Promise.all([
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl.css'),
  ])
  return { gl: mod, style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json' }
}

/**
 * The ambient fleet is **real** now: `GET /public/nearby-vehicles` serves
 * the actual dispatchable pool, anonymized to positions and silhouettes,
 * and the caller polls it and passes the result in as `fleet`. This
 * replaces six vehicles drawn at hardcoded offsets from the map centre —
 * honest ambience when the public API exposed no positions, a lie the
 * moment it did.
 */
export type VehicleKind = 'sedan' | 'suv' | 'pickup' | 'boda'

/** The fleet sprite set (see public/assets/vehicles/): one unified top-down
 * family, all on the same 512 canvas scale so relative sizes stay honest. */
const VEHICLE_SPRITES: Record<VehicleKind, string> = {
  sedan: '/assets/vehicles/sedan-top.svg',
  suv: '/assets/vehicles/suv-top.svg',
  pickup: '/assets/vehicles/pickup-top.svg',
  boda: '/assets/vehicles/boda-rider-top.svg',
}

/**
 * The palette, matched to the Google Maps look the ride apps here use.
 *
 * This reverses the panel's earlier choice, and the reason is worth
 * recording. The old palette painted grey ground and white roads, to stop
 * a near-white basemap dissolving into a near-white page. It worked, but
 * it made the map read as decoration — a texture behind a form — and the
 * apps people already trust in Kampala look the other way round: white
 * ground, roads drawn *on* it in pale blue-grey, so the network reads as
 * something laid over the city rather than carved out of it.
 *
 * Figure-ground against the page is now the sheet's job, which it does
 * with a border and a shadow, so the map no longer has to solve it with
 * colour.
 */
const MAP_PALETTE = {
  land: '#FFFFFF',
  water: '#CFE4F5',
  /** Parks and pitches: the only landcover that keeps any saturation. */
  green: '#DCF0DC',
  /** Roads are darker than the ground here, which is the whole inversion. */
  road: '#DFE6ED',
  /** Barely there — buildings are texture, not information, at this zoom. */
  building: '#F4F6F8',
}

/** The brand green as the stylesheet defines it, for canvas-drawn things. */
function brandGreen(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue('--kr-green').trim() || '#16a34a'
  )
}

/** Repaints ground, water, parks, buildings and roads to MAP_PALETTE. */
function applyMapPalette(map: import('maplibre-gl').Map): void {
  for (const layer of map.getStyle().layers ?? []) {
    const id = layer.id
    try {
      if (layer.type === 'background') {
        map.setPaintProperty(id, 'background-color', MAP_PALETTE.land)
      } else if (/water|ocean|sea|river/.test(id) && layer.type === 'fill') {
        map.setPaintProperty(id, 'fill-color', MAP_PALETTE.water)
      } else if (/park|grass|wood|forest|scrub|pitch|golf/.test(id) && layer.type === 'fill') {
        map.setPaintProperty(id, 'fill-color', MAP_PALETTE.green)
      } else if (/building/.test(id) && layer.type === 'fill') {
        map.setPaintProperty(id, 'fill-color', MAP_PALETTE.building)
      } else if (/road|street|highway|motorway|bridge|tunnel|transit/.test(id)) {
        if (layer.type === 'line') map.setPaintProperty(id, 'line-color', MAP_PALETTE.road)
      } else if (/landcover|landuse|earth|land/.test(id) && layer.type === 'fill') {
        map.setPaintProperty(id, 'fill-color', MAP_PALETTE.land)
      }
    } catch {
      // A layer whose paint property does not exist in this style: skip it
      // rather than lose the whole repaint.
    }
  }
}

/**
 * What still gets removed — and it is much less than it used to be.
 *
 * The panel previously stripped every POI and place label to keep the map
 * calm. Against the reference that reads as empty rather than calm: the
 * places *are* the map when you are finding a pickup, and "Shell Ssonde",
 * "Mukono" and a fuel pin are how somebody actually says where they are.
 *
 * What still goes is the *texture*, not the information: building
 * footprints and residential landuse, which at this zoom render as a grey
 * rash across the whole city and are the one thing the reference map has
 * none of; and house numbers, unreadable here and meaningless to a driver
 * being sent to a landmark.
 */
const NOISY_LAYERS = /^(housenumber|building|landuse_residential)|-housenumber|building-/

/** The blue "you are here" dot inside its soft accuracy halo (styled in landing.css). */
function userLocationElement(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'kr-loc'
  el.setAttribute('aria-hidden', 'true')
  return el
}

function vehicleElement(kind: VehicleKind): HTMLImageElement {
  const img = document.createElement('img')
  img.src = VEHICLE_SPRITES[kind]
  // One shared canvas size: the sprites carry honest relative scale, so a
  // boda naturally renders smaller than a pickup.
  img.width = 58
  img.height = 58
  img.className = 'kr-vehicle'
  img.alt = ''
  return img
}

/** The two ends of a drawn route: a green ring out, a solid pin in. */
function routeEndElement(kind: 'start' | 'end'): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'kr-route-end'
  el.setAttribute('aria-hidden', 'true')
  const green = brandGreen()
  el.innerHTML =
    kind === 'start'
      ? `<span style="display:block;width:16px;height:16px;border-radius:9999px;background:#fff;border:5px solid ${green};box-shadow:0 1px 5px rgba(0,16,40,.35)"></span>`
      : `<span style="display:block;width:18px;height:18px;border-radius:9999px;background:${green};border:3px solid #fff;box-shadow:0 1px 5px rgba(0,16,40,.35)"></span>`
  return el
}

/**
 * The panel the app renders. Google when a key is configured, the GL
 * engines when not.
 *
 * Two SDKs rather than one abstraction on purpose: Google's Map/Marker and
 * MapLibre's are different enough that a shared interface would be a
 * lowest-common-denominator of both, and the interesting parts (Google's
 * real ground circle, MapLibre's style repaint) live in exactly the places
 * such an interface would have to drop.
 */
export function MapPanel(props: MapPanelProps) {
  // Latches on failure, so a Google outage falls back for the rest of the
  // session rather than retrying the same broken load on every render.
  const [googleFailed, setGoogleFailed] = useState(false)
  const fallBack = useCallback(() => setGoogleFailed(true), [])

  if (googleMapsAvailable() && !googleFailed) {
    return <GoogleMapPanel {...props} onUnsupported={fallBack} />
  }
  return <GlMapPanel {...props} />
}

export interface MapPanelProps {
  pickup: string
  dropoff: string
  /** The device fix, once known. Falls back to the city while it resolves. */
  center: [number, number] | null
  /** Trip ends, once both are geocoded; the route is drawn between them. */
  from: [number, number] | null
  to: [number, number] | null
  /**
   * The order is placed and this map now belongs to one trip. The ambient
   * fleet stands down for the whole of it, not just while the search runs:
   * it answered "how many are near me", and once a captain is assigned it
   * would read as a fleet we are tracking for this ride. The marker also
   * turns green — it is the pickup point now, not the phone.
   */
  matching?: boolean
  /** Within matching, dispatch is still looking: draw the search radius. */
  searching?: boolean
  /**
   * The real vehicles nearby, from `/public/nearby-vehicles` via
   * `mergeFleet`. Absent or empty means none are drawn — an honest empty
   * street, never a decorative one.
   */
  fleet?: FleetSprite[]
  /** The matched captain's live position, once there is one to show. */
  captainAt?: [number, number] | null
  captainKind?: VehicleKind
  /**
   * How much of the mobile viewport the caller's bottom sheet covers, 0–1.
   * The map centres the subject in the strip that is left rather than in
   * the container, which is otherwise half-hidden behind the sheet, and it
   * hangs the recentre control just above it. Omitted, the panel keeps the
   * order form's hand-tuned framing and shows no control.
   */
  sheetFraction?: number
}

function GlMapPanel({
  pickup,
  dropoff,
  center,
  from,
  to,
  matching = false,
  searching = false,
  fleet = [],
  captainAt = null,
  captainKind = 'sedan',
  sheetFraction,
}: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('maplibre-gl').Map | null>(null)
  const followersRef = useRef<import('maplibre-gl').Marker[]>([])
  const fleetRef = useRef(new Map<string, import('maplibre-gl').Marker>())
  const endMarkersRef = useRef<import('maplibre-gl').Marker[]>([])
  const captainRef = useRef<import('maplibre-gl').Marker | null>(null)
  const markerCtorRef = useRef<MapEngine['Marker'] | null>(null)
  const [failed, setFailed] = useState(false)
  /** Flips once the GL map exists, so the recentre effect knows it can move it. */
  const [ready, setReady] = useState(false)

  const useGl = import.meta.env.MODE !== 'test' && !failed

  useEffect(() => {
    if (!useGl || containerRef.current === null) return

    let map: import('maplibre-gl').Map | undefined
    let cancelled = false
    // Captured once so the cleanup does not read `.current` after unmount —
    // the same shape FleetMap documents; safe because it is a reference to
    // a mutated Map, not a snapshot.
    const fleetOnMap = fleetRef.current

    void (async () => {
      try {
        const { gl, style } = await loadMapEngine(import.meta.env.VITE_MAPBOX_TOKEN)
        if (cancelled || containerRef.current === null) return

        // Opens on the city and glides to the device fix when it lands; the
        // recentre effect below owns that move.
        const start = KAMPALA
        const m = new gl.Map({
          container: containerRef.current,
          style,
          center: start,
          zoom: 14.1,
          attributionControl: false,
          // Zoom without hijacking the page: Ctrl + wheel on desktop,
          // two-finger pinch on touch.
          cooperativeGestures: true,
        })
        map = m
        mapRef.current = m
        markerCtorRef.current = gl.Marker
        m.on('load', () => {
          for (const layer of m.getStyle().layers ?? []) {
            if (NOISY_LAYERS.test(layer.id)) m.removeLayer(layer.id)
          }
          applyMapPalette(m)
        })
        m.addControl(new gl.AttributionControl({ compact: true }))
        m.addControl(new gl.NavigationControl({ showCompass: false }), 'top-right')
        // Deliberately no persistent camera padding here: it survives on
        // the map and then fights every fitBounds call, which is what left
        // the drawn route running underneath the sheet. Each move states
        // its own framing instead — see `lift` and the route's fitBounds.

        // The one thing that travels with the person: the halo. The fleet
        // is live data now and its own effect below owns it.
        const you = new gl.Marker({ element: userLocationElement() }).setLngLat(start).addTo(m)
        followersRef.current = [you]
        setReady(true)
      } catch {
        // No WebGL or blocked tile hosts — show the flat embed, never a blank pane.
        if (!cancelled) setFailed(true)
      }
    })()

    return () => {
      cancelled = true
      followersRef.current = []
      fleetOnMap.forEach((marker) => marker.remove())
      fleetOnMap.clear()
      endMarkersRef.current = []
      captainRef.current = null
      markerCtorRef.current = null
      mapRef.current = null
      setReady(false)
      map?.remove()
    }
  }, [useGl])

  /**
   * Once both ends of the trip are known, the map stops being ambience and
   * becomes the route: the driving line in brand green, the two ends
   * marked, the view fitted to it, and the decorative fleet hidden — they
   * answered "how many cars are near me", a question already settled by
   * the time someone has picked a destination.
   */
  useEffect(() => {
    const m = mapRef.current
    if (!ready || m === null) return

    const clear = () => {
      if (m.getLayer('kr-route') !== undefined) m.removeLayer('kr-route')
      if (m.getLayer('kr-route-casing') !== undefined) m.removeLayer('kr-route-casing')
      if (m.getSource('kr-route') !== undefined) m.removeSource('kr-route')
      endMarkersRef.current.forEach((marker) => marker.remove())
      endMarkersRef.current = []
    }

    if (from === null || to === null) {
      clear()
      // The halo comes back when the route goes — unless matching, where
      // the pickup marker owns the point. The live fleet is not touched
      // here; its own effect owns its visibility.
      if (!matching) {
        followersRef.current.forEach((marker) => {
          marker.getElement().style.display = ''
        })
      }
      return
    }

    let cancelled = false
    void fetchRoute(from, to).then((line) => {
      if (cancelled || mapRef.current === null) return
      if (line === null) return
      clear()

      m.addSource('kr-route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: line },
        },
      })
      // A white casing under the green keeps the line legible where it
      // crosses white roads.
      m.addLayer({
        id: 'kr-route-casing',
        type: 'line',
        source: 'kr-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#FFFFFF', 'line-width': 9 },
      })
      m.addLayer({
        id: 'kr-route',
        type: 'line',
        source: 'kr-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': brandGreen(), 'line-width': 5 },
      })

      endMarkersRef.current = [
        new markerCtorRef.current!({ element: routeEndElement('start') }).setLngLat(from).addTo(m),
        new markerCtorRef.current!({ element: routeEndElement('end') }).setLngLat(to).addTo(m),
      ]
      // The trip is the subject now: the route ends replace the halo, and
      // the fleet effect below sees `from`/`to` set and stands the fleet
      // down on the same render.
      followersRef.current.forEach((marker) => {
        marker.getElement().style.display = 'none'
      })

      const lngs = line.map((c) => c[0])
      const lats = line.map((c) => c[1])
      m.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        {
          // Mobile reserves the sheet's half of the screen (52dvh) plus a
          // margin, so the whole trip lands in the strip above it.
          padding: window.matchMedia('(min-width: 1024px)').matches
            ? 90
            : // Top clears the floating header and the From/To chip beneath it.
              { top: 170, bottom: Math.round(window.innerHeight * 0.56), left: 44, right: 44 },
          duration: 700,
        },
      )
    })
    return () => {
      cancelled = true
    }
  }, [ready, from, to, matching])

  /**
   * The search radius. Reuses the existing "you are here" marker rather
   * than adding a second one at the same coordinate — one element, two
   * class swaps, so the halo can never drift from the dot it belongs to.
   */
  useEffect(() => {
    if (!ready) return
    const el = followersRef.current[0]?.getElement()
    if (el !== undefined) {
      el.classList.toggle('kr-loc--green', matching)
      el.classList.toggle('kr-loc--searching', searching)
    }
  }, [ready, matching, searching])

  /**
   * The live fleet. One marker per key, moved rather than rebuilt (the
   * same rule as the console's map: a rebuilt marker blinks; a moved one
   * travels), rotated to the heading `mergeFleet` derived from movement.
   *
   * Visibility is data plus two vetoes: a drawn route or a running match
   * stands the fleet down — those cars answered "how many are near me", a
   * question already settled by then — and standing down means *removing*
   * the markers, so a poll landing mid-ride cannot repaint them behind the
   * route.
   */
  useEffect(() => {
    const m = mapRef.current
    const Marker = markerCtorRef.current
    if (!ready || m === null || Marker === null) return

    const visible = !matching && (from === null || to === null)
    const wanted = visible ? fleet : []
    const onMap = fleetRef.current
    const incoming = new Set(wanted.map((vehicle) => vehicle.key))

    for (const [key, marker] of onMap) {
      if (!incoming.has(key)) {
        marker.remove()
        onMap.delete(key)
      }
    }

    for (const vehicle of wanted) {
      const existing = onMap.get(vehicle.key)
      if (existing !== undefined) {
        existing.setLngLat(vehicle.lngLat)
        existing.setRotation(vehicle.heading)
      } else {
        onMap.set(
          vehicle.key,
          new Marker({
            element: vehicleElement(vehicle.kind),
            rotation: vehicle.heading,
            rotationAlignment: 'map',
          })
            .setLngLat(vehicle.lngLat)
            .addTo(m),
        )
      }
    }
  }, [ready, fleet, matching, from, to])

  /** The matched captain, moving toward the pickup. */
  useEffect(() => {
    const m = mapRef.current
    if (!ready || m === null || markerCtorRef.current === null) return

    if (captainAt === null) {
      captainRef.current?.remove()
      captainRef.current = null
      return
    }
    if (captainRef.current === null) {
      captainRef.current = new markerCtorRef.current({ element: vehicleElement(captainKind) })
        .setLngLat(captainAt)
        .addTo(m)
    } else {
      captainRef.current.setLngLat(captainAt)
    }

    /*
     * Pull back far enough to hold both the pickup and the captain. A
     * captain two kilometres out is off-screen at the search zoom, and a
     * map that says "on the way" while showing neither party is worse than
     * no map. Skipped when a route is drawn — that framing is the trip's.
     */
    if (center === null || (from !== null && to !== null)) return
    const desktop = window.matchMedia('(min-width: 1024px)').matches
    m.fitBounds(
      [
        [Math.min(center[0], captainAt[0]), Math.min(center[1], captainAt[1])],
        [Math.max(center[0], captainAt[0]), Math.max(center[1], captainAt[1])],
      ],
      {
        padding: desktop
          ? 120
          : {
              top: 110,
              bottom: Math.round(window.innerHeight * (sheetFraction ?? 0.5) + 40),
              left: 60,
              // Clears the recentre control, which would otherwise sit on
              // top of whichever of the two ends lands furthest right.
              right: 100,
            },
        maxZoom: 15,
        duration: 700,
      },
    )
  }, [ready, captainAt, captainKind, center, from, to, sheetFraction])

  // A fix usually lands after the map is already up: glide to it and bring
  // the halo along. The fleet does not follow — real vehicles are where
  // they are, which is the whole point of them being real.
  useEffect(() => {
    const m = mapRef.current
    if (!ready || m === null || (from !== null && to !== null)) return

    /*
     * With a sheet declared, re-centre even when no fix has arrived. The
     * order form only ever reaches this effect holding a fix, but the
     * matching screen can open without one — the auto-locate upstream is
     * skipped whenever the pickup came from the URL — and then the subject
     * of the screen sits at the container's centre, which is behind the
     * sheet. Falling back to where the map already is keeps the framing
     * right and moves nothing the user did not ask to move.
     */
    const target = center ?? (sheetFraction === undefined ? null : m.getCenter())
    if (target === null) return

    // Centre in the visible strip, not the container: half the sheet's
    // height is exactly the distance that does it. Desktop is unobstructed.
    const lift = window.matchMedia('(min-width: 1024px)').matches
      ? 0
      : Math.round(window.innerHeight * (sheetFraction === undefined ? 0.22 : sheetFraction / 2))
    m.easeTo({ center: target, offset: [0, -lift], duration: 600 })

    if (center === null) return
    followersRef.current[0]?.setLngLat(center)
  }, [center, ready, from, to, sheetFraction])

  /** Puts the subject back in frame after the map has been panned around. */
  /**
   * What the crosshair goes back to, in order of what the map is about.
   *
   * A drawn trip outranks a fix: once both ends are known the subject of the
   * map is the journey, and centring on one end of it while the other is off
   * screen is the framing this button exists to undo. With no trip, your own
   * position; with no fix — declined, or not asked yet — the pickup, which is
   * the only place the order is about.
   */
  const recentreTarget = (): [number, number] | null =>
    from !== null && to !== null ? null : (center ?? from)

  /**
   * Whether there is anywhere to go back to at all.
   *
   * `sheetFraction` counts as one on its own, and that is not a leftover:
   * with a sheet up, pressing this lifts whatever is centred out from behind
   * it, which is a real move even before any fix has landed. That was the
   * button's whole job on the matching screen before it appeared anywhere
   * else, and it still is.
   */
  const canRecentre = center !== null || from !== null || sheetFraction !== undefined

  const recentre = () => {
    const m = mapRef.current
    if (m === null) return

    // No sheet, no lift: the order page's map is unobstructed, so the
    // subject belongs in the middle of it rather than pushed up by half of
    // nothing.
    const lift =
      sheetFraction === undefined || window.matchMedia('(min-width: 1024px)').matches
        ? 0
        : Math.round(window.innerHeight * (sheetFraction / 2))

    const target = recentreTarget()
    if (target === null && from !== null && to !== null) {
      m.fitBounds(
        [
          [Math.min(from[0], to[0]), Math.min(from[1], to[1])],
          [Math.max(from[0], to[0]), Math.max(from[1], to[1])],
        ],
        { padding: 90, offset: [0, -lift], maxZoom: 15, duration: 500 },
      )

      return
    }

    m.easeTo({ center: target ?? m.getCenter(), offset: [0, -lift], duration: 500 })
  }

  return (
    <aside className="fixed inset-0 lg:relative lg:inset-auto" aria-label="Map of the service area">
      {/* The border matters on desktop: without it the map's ground and the
          form column's background meet with no seam. */}
      <div className="h-full lg:sticky lg:top-16 lg:h-[calc(100dvh-4rem)] lg:border-l lg:border-border">
        {useGl ? (
          <div ref={containerRef} className="h-full w-full" />
        ) : (
          <iframe
            title="Map of the Kampala service area"
            src="https://www.openstreetmap.org/export/embed.html?bbox=32.44%2C0.18%2C32.78%2C0.47&layer=mapnik&marker=0.3476%2C32.5825"
            className="h-full w-full border-0"
            loading="lazy"
          />
        )}
        {/* Shown whenever there is somewhere to go back to, not only on
            the matching screen. The order page draws the same map, gives it
            the same fix, and had no way back to it — you panned across
            Kampala to check a landmark and that was that. `center` is your
            own position here (`myPosition`), so this is Google's crosshair
            doing Google's job. */}
        {canRecentre && (
          <button
            type="button"
            onClick={recentre}
            aria-label="Recentre the map"
            // The sheet's height rides in a custom property so the desktop
            // override still wins — an inline `bottom` would outrank it.
            className="absolute right-5 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-surface-card text-text-heading shadow-lg transition-transform duration-150 ease-[var(--kr-ease-out)] active:scale-95 bottom-[calc(var(--kr-sheet)*1dvh+1rem)] lg:bottom-6"
            style={{ '--kr-sheet': (sheetFraction ?? 0) * 100 } as CSSProperties}
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
