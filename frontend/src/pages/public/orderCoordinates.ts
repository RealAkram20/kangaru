import { placeLabel, type PlaceHit } from './places'

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
