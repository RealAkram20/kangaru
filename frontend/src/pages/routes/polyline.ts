/**
 * Google's encoded polyline, decoded.
 *
 * Both routing providers emit this format — `OsrmProvider` asks OSRM for
 * `geometries=polyline` **specifically so the encoding is shared**, and its
 * docblock says so: "the same encoding Google uses, so the app's decoder is
 * shared rather than forked". This is that decoder.
 *
 * ## Why it is written out rather than installed
 *
 * `google.maps.geometry.encoding.decodePath` exists and is already loaded on
 * the screens that use Google — but only there. The moment the map falls
 * back to MapLibre (no API key configured, which is the default), that
 * function is not on the page, and a line that only draws on the paid engine
 * is a line most deployments never see.
 *
 * Twenty lines of well-specified arithmetic, pure and testable, beats a
 * dependency or an engine-conditional line.
 *
 * ## Precision
 *
 * Precision 5 — the standard, and what both providers emit. Precision 6
 * exists (some OSRM deployments default to it) and would decode to
 * coordinates ten times too large, which is why a malformed or
 * wrong-precision string must not silently produce a plausible-looking line
 * somewhere in the ocean. `decodePolyline` returns only what it could read;
 * `looksLikeKampala` is what the caller uses to decide whether to trust it.
 */

/** `[longitude, latitude]` — GeoJSON order, which is what MapLibre wants. */
export type LngLat = [number, number]

export function decodePolyline(encoded: string, precision = 5): LngLat[] {
  const factor = 10 ** precision
  const points: LngLat[] = []

  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    const latDelta = nextValue()
    if (latDelta === null) break

    const lngDelta = nextValue()
    if (lngDelta === null) break

    lat += latDelta
    lng += lngDelta

    points.push([lng / factor, lat / factor])
  }

  return points

  /**
   * One varint: five-bit chunks, little end first, continuation bit set on
   * every chunk but the last, then zig-zag decoded.
   *
   * Returns null on a truncated string rather than a half-read number — a
   * partial delta would displace every point after it, so the honest answer
   * is to stop with what was read.
   */
  function nextValue(): number | null {
    let result = 0
    let shift = 0
    let byte: number

    do {
      if (index >= encoded.length) return null

      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    // Zig-zag: the low bit is the sign.
    return result & 1 ? ~(result >> 1) : result >> 1
  }
}

/**
 * Whether a decoded line is plausibly in this platform's service area.
 *
 * Not a validation of the provider — it is a guard against the one silent
 * failure this format has. A precision-6 string decoded at precision 5 (or
 * the reverse) yields perfectly well-formed coordinates that are simply in
 * the wrong place, and ADR-0020 records where a coordinate mistake put a
 * Kampala vehicle for real: 0°N 0°E, in the Atlantic off Ghana.
 *
 * Generous bounds on purpose — this asks "is this the right planet and
 * roughly the right continent", not "is this Kampala". A fleet expanding to
 * Kenya must not have its routes silently refused by a bounding box nobody
 * remembered was here.
 */
export function looksLikeUganda(points: LngLat[]): boolean {
  if (points.length === 0) return false

  return points.every(
    ([lng, lat]) => lng > 20 && lng < 45 && lat > -15 && lat < 15,
  )
}
