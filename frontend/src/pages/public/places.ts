/**
 * Place search for the public order flow. Mirrors the map's dual-engine
 * approach: Mapbox Geocoding once VITE_MAPBOX_TOKEN is configured, komoot's
 * keyless Photon (OSM data) until then. Both are biased toward Kampala so
 * "Acacia" finds Acacia Mall before anything abroad. Everything fails soft:
 * a geocoder outage degrades to plain text typing, never an error screen.
 */

export interface PlaceHit {
  name: string
  detail: string
  /** Where it is, when known. Set for a device fix so the map can centre there. */
  lngLat?: [number, number]
}

const KAMPALA = { lat: 0.3476, lng: 32.5825 }

function mapboxToken(): string | undefined {
  return import.meta.env.VITE_MAPBOX_TOKEN
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceHit[]> {
  if (import.meta.env.MODE === 'test') return []
  try {
    const token = mapboxToken()
    const url = token
      ? `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?proximity=${KAMPALA.lng},${KAMPALA.lat}&country=ug&limit=6&access_token=${token}`
      : `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=${KAMPALA.lat}&lon=${KAMPALA.lng}&limit=6`
    const response = await fetch(url, { signal })
    if (!response.ok) return []
    const data: unknown = await response.json()
    return token ? fromMapbox(data) : fromPhoton(data)
  } catch {
    return []
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (import.meta.env.MODE === 'test') return null
  try {
    const token = mapboxToken()
    const url = token
      ? `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=address,poi,neighborhood,locality&limit=1&access_token=${token}`
      : `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`
    const response = await fetch(url)
    if (!response.ok) return null
    const hits = token ? fromMapbox(await response.json()) : fromPhoton(await response.json())
    if (hits.length === 0) return null
    return placeLabel(hits[0])
  } catch {
    return null
  }
}

/**
 * The device's position, resolved to a place. `name` is the label a person
 * reads ("Current location"); `detail` is the street address a dispatcher
 * can actually drive to, which is what the order payload carries.
 *
 * Never throws and never rejects: a refused prompt, a timeout or a
 * geocoder outage all resolve to null, and the caller falls back to typing.
 */
export async function currentLocationPlace(): Promise<PlaceHit | null> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return null

  const position = await new Promise<GeolocationPosition | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (result) => resolve(result),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  })
  if (position === null) return null

  const { latitude, longitude } = position.coords
  const address = await reverseGeocode(latitude, longitude)
  return {
    name: 'Current location',
    detail: address ?? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
    lngLat: [longitude, latitude],
  }
}

/**
 * True when the browser has already refused geolocation, so the pickup
 * default can skip asking rather than throwing a prompt at someone who
 * said no once. Unknown support answers false: asking is the fallback.
 */
export async function geolocationRefused(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || navigator.permissions === undefined) return false
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
    return status.state === 'denied'
  } catch {
    return false
  }
}

/** "Acacia Mall, Kampala" — the display/payload form of a hit. */
export function placeLabel(hit: PlaceHit): string {
  const locality = hit.detail.split(',')[0]?.trim()
  return [hit.name, locality].filter(Boolean).join(', ')
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] }
  properties?: {
    name?: string
    street?: string
    housenumber?: string
    district?: string
    city?: string
    state?: string
    country?: string
  }
}

function fromPhoton(data: unknown): PlaceHit[] {
  const features = (data as { features?: PhotonFeature[] }).features ?? []
  const hits: PlaceHit[] = []
  for (const feature of features) {
    const p = feature.properties ?? {}
    const name = p.name ?? [p.street, p.housenumber].filter(Boolean).join(' ')
    if (!name) continue
    const detail = [p.district, p.city, p.country === 'Uganda' ? undefined : p.country]
      .filter((part): part is string => Boolean(part) && part !== name)
      .join(', ')
    hits.push({ name, detail, lngLat: feature.geometry?.coordinates })
  }
  return dedupe(hits)
}

interface MapboxFeature {
  text?: string
  place_name?: string
  center?: [number, number]
}

function fromMapbox(data: unknown): PlaceHit[] {
  const features = (data as { features?: MapboxFeature[] }).features ?? []
  const hits: PlaceHit[] = []
  for (const feature of features) {
    const name = feature.text
    if (!name) continue
    const detail = (feature.place_name ?? '')
      .split(',')
      .slice(1)
      .map((s) => s.trim())
      .filter((s) => s !== 'Uganda')
      .join(', ')
    hits.push({ name, detail, lngLat: feature.center })
  }
  return dedupe(hits)
}

/**
 * The driving line between two points, as the road network actually runs.
 * OSRM's public server is keyless and matches the keyless basemap; with a
 * Mapbox token the Directions API answers instead. Returns null on any
 * failure — the map then simply shows no route rather than a wrong one.
 */
export async function fetchRoute(
  from: [number, number],
  to: [number, number],
): Promise<[number, number][] | null> {
  if (import.meta.env.MODE === 'test') return null
  const token = mapboxToken()
  const url = token
    ? `https://api.mapbox.com/directions/v5/mapbox/driving/${from[0]},${from[1]};${to[0]},${to[1]}?geometries=geojson&overview=full&access_token=${token}`
    : `https://router.project-osrm.org/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?geometries=geojson&overview=full`
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const data = (await response.json()) as {
      routes?: { geometry?: { coordinates?: [number, number][] } }[]
    }
    const line = data.routes?.[0]?.geometry?.coordinates
    return line !== undefined && line.length > 1 ? line : null
  } catch {
    return null
  }
}

function dedupe(hits: PlaceHit[]): PlaceHit[] {
  const seen = new Set<string>()
  return hits.filter((hit) => {
    const key = `${hit.name}|${hit.detail}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/* ---- Trip history, kept on this device only. The list shown is the four
   most FREQUENT destinations (ties broken by recency); the store keeps a
   deeper pool so frequencies can accumulate beyond what is displayed. ---- */

const RECENT_KEY = 'kr.recent-destinations'
const RECENT_DISPLAY = 4
const RECENT_STORE = 12

interface StoredPlace extends PlaceHit {
  count?: number
}

function storedPlaces(): StoredPlace[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is StoredPlace =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as StoredPlace).name === 'string' &&
        typeof (entry as StoredPlace).detail === 'string',
    )
  } catch {
    return []
  }
}

export function recentDestinations(): PlaceHit[] {
  // Stored order is most-recent-first, so a stable sort by count keeps
  // recency as the tie-breaker.
  return storedPlaces()
    .slice()
    .sort((a, b) => (b.count ?? 1) - (a.count ?? 1))
    .slice(0, RECENT_DISPLAY)
    .map(({ name, detail }) => ({ name, detail }))
}

export function rememberDestination(hit: PlaceHit): void {
  try {
    const stored = storedPlaces()
    const existing = stored.find((place) => place.name === hit.name)
    const next: StoredPlace[] = [
      { name: hit.name, detail: hit.detail, count: (existing?.count ?? 0) + 1 },
      ...stored.filter((place) => place.name !== hit.name),
    ]
    localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, RECENT_STORE)))
  } catch {
    // Storage full or blocked - history is a nicety, not a requirement.
  }
}
