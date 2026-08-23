import { placeLabel, type PlaceHit } from './places'
import type { PublicOrderPayload } from './publicOrder'

/**
 * Whether a picked place's coordinates still describe what the field says
 * (ADR-0020 §2).
 *
 * Its own module rather than a helper inside `OrderPage`: exporting a
 * non-component from a component file breaks Fast Refresh, and this rule is
 * worth testing directly — the order flow cannot express every case, since
 * once the device supplies the pickup that field renders as text rather
 * than an editable input.
 */

/**
 * `undefined` keys rather than nulls, so they are absent from the JSON
 * entirely. The server treats absent and null alike, and omitting them
 * keeps the payload honest about what is actually known.
 */
export function coordinatesFor(
  typed: string,
  place: PlaceHit | null,
  latKey: string,
  lngKey: string,
): Record<string, number> {
  // Compared against the *label the field was filled with*, not the place's
  // `name`. A device fix is stored as `{name: 'Current location', detail:
  // 'Plot 9, Bukoto Street'}` and the field shows the detail, so comparing
  // `name` dropped the coordinates for every order placed from the phone's
  // own position — which is most of them. The two spellings here mirror the
  // two `onChange` calls that fill these fields.
  const filledWith =
    place === null ? '' : place.name === 'Current location' ? place.detail : placeLabel(place)

  if (place?.lngLat === undefined || filledWith.trim() !== typed.trim()) return {}

  const [lng, lat] = place.lngLat

  return { [latKey]: lat, [lngKey]: lng }
}

export function pickupCoordinates(service: string, typed: string, place: PlaceHit | null) {
  return service === 'self_drive'
    ? {}
    : coordinatesFor(typed, place, 'pickup_latitude', 'pickup_longitude')
}

export function dropoffCoordinates(service: string, typed: string, place: PlaceHit | null) {
  return service === 'self_drive'
    ? {}
    : coordinatesFor(typed, place, 'dropoff_latitude', 'dropoff_longitude')
}

/**
 * Flattens the server's validation errors and re-labels the coordinate ones
 * onto the address fields the customer can actually edit (ADR-0021).
 *
 * The service-area check rejects `pickup_latitude`, and there is no
 * `pickup_latitude` input on the form — the customer types an address and a
 * geocoder supplies the point. Left as-is, a pickup outside the coverage
 * area sends them back to the details step with **no visible error at all**,
 * which reads as the form being broken.
 */
export function withCoordinateErrorsOnTheirFields(
  raw: Record<string, string[]>,
): Record<string, string> {
  return withCoordinateErrorsOnFields(
    Object.fromEntries(Object.entries(raw).map(([key, messages]) => [key, messages[0]])),
  )
}

/**
 * The same re-labelling for callers that already hold a flat map — the
 * console's `fieldErrors()` returns one.
 *
 * The alias table lives here alone. Two copies of "which invisible field
 * maps to which visible one" would drift the first time a field was
 * renamed, and the symptom is a form that fails silently.
 */
export function withCoordinateErrorsOnFields(flat: Record<string, string>): Record<string, string> {
  const alias: Record<string, string> = {
    pickup_latitude: 'pickup_location',
    pickup_longitude: 'pickup_location',
    dropoff_latitude: 'dropoff_location',
    dropoff_longitude: 'dropoff_location',
    // The console's booking form calls its pick-up field `origin`.
    origin_latitude: 'origin',
    origin_longitude: 'origin',
  }

  const mapped = { ...flat }

  for (const [from, to] of Object.entries(alias)) {
    // Never overwrite an error the field already has: a rejection of the
    // address itself is the more actionable of the two.
    if (mapped[from] !== undefined && mapped[to] === undefined) mapped[to] = mapped[from]
  }

  return mapped
}

/**
 * Fills in whichever end of the trip the form could not place, by geocoding
 * the text the customer typed — **before** the order is sent, so the platform
 * learns the destination rather than only the map on this screen.
 *
 * `coordinatesFor` is deliberately strict: it sends coordinates only for a
 * place picked from the list, and drops them the moment the text is edited.
 * That is right for a *picked* place, and it left a hole for a *typed* one:
 * an address keyed by hand, or arriving in the URL from the landing page's
 * hero form, went up as a bare string. The customer's ride screen then
 * geocoded it locally to draw its route — so the customer saw a line on a
 * map while the order the driver received had `dropoff_latitude: null`. On
 * the driver's phone that is an estimated fare of nothing, a journey of
 * nothing, and no route to draw, because every one of them is priced or
 * measured from the drop-off point (`TripResource::estimatedFare` →
 * `WalkInFareService::quote`). Found on a live handset, on order KR-7J4XT8.
 *
 * Geocoding *the typed text* keeps the rule that motivated the strictness:
 * "Acacia Mall, gate 3" is looked up as written, not replaced by the pin the
 * customer moved away from in their head.
 *
 * Best-effort, and it must stay so. A geocoder that is down or finds nothing
 * leaves the payload as it was — the order still goes, priced later by the
 * desk — rather than turning a slow third party into a failed order.
 */
export async function withGeocodedEnds(
  payload: PublicOrderPayload,
  geocode: (query: string) => Promise<PlaceHit[]>,
): Promise<PublicOrderPayload> {
  const filled: PublicOrderPayload = { ...payload }

  const ends = [
    ['pickup_location', 'pickup_latitude', 'pickup_longitude'],
    ['dropoff_location', 'dropoff_latitude', 'dropoff_longitude'],
  ] as const

  for (const [textKey, latKey, lngKey] of ends) {
    const text = filled[textKey]

    if (text === undefined || text.trim() === '') continue
    if (filled[latKey] !== undefined && filled[lngKey] !== undefined) continue

    try {
      const point = (await geocode(text.trim())).find((hit) => hit.lngLat !== undefined)?.lngLat
      if (point !== undefined) {
        filled[lngKey] = point[0]
        filled[latKey] = point[1]
      }
    } catch {
      // Left unplaced, on purpose — see the docblock.
    }
  }

  return filled
}
