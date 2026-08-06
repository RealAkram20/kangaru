/**
 * How far a trip is, and roughly how long it takes — worked out on the
 * device from the two geocoded ends.
 *
 * Deliberately not a routing call. The platform has no directions API
 * enabled (`googleMaps.ts` loads `marker` and `geometry` only) and the
 * summary screen needs a number the moment it opens, offline included. So
 * this is the great-circle distance with a road factor on top, which is
 * what every dispatcher's mental arithmetic does anyway — and it is why
 * the screen calls it an *estimate* and the dispatcher still confirms.
 *
 * Returns null rather than a guess when either end is un-geocoded: a
 * distance invented from a typed street name would be a number the
 * customer has no way to know is fiction.
 */

/** Kilometres, mean Earth radius. */
const EARTH_RADIUS_KM = 6371

/**
 * Straight line → road. Kampala's grid is not a grid; 1.35 is the usual
 * urban detour factor and lands within a few hundred metres of what the
 * odometer reads on the trips this screen quotes.
 */
const ROAD_FACTOR = 1.35

/** Door-to-door average through Kampala traffic, km/h. */
const CITY_SPEED_KMH = 20

export interface TripEstimate {
  /** Road kilometres, one decimal. */
  km: number
  /** Whole minutes, never less than one. */
  minutes: number
}

/** Both points are [lng, lat], the order MapLibre and Google both take. */
export function tripEstimate(
  from: [number, number] | null,
  to: [number, number] | null,
): TripEstimate | null {
  if (from === null || to === null) return null

  const [fromLng, fromLat] = from
  const [toLng, toLat] = to
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180

  const dLat = toRadians(toLat - fromLat)
  const dLng = toRadians(toLng - fromLng)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLng / 2) ** 2
  const straightKm = 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
  const km = straightKm * ROAD_FACTOR

  return {
    km: Math.round(km * 10) / 10,
    minutes: Math.max(1, Math.round((km / CITY_SPEED_KMH) * 60)),
  }
}

/** "4.6 km" — one decimal, because "4.63 km" claims a precision we lack. */
export function formatKm(km: number): string {
  return `${km.toFixed(1)} km`
}

/** "15 min", or "1 hr 20 min" once a trip stops being a city hop. */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`
}
