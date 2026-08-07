/**
 * Mirrors Modules/Fleet's ZoneResource (ADR-0021).
 */

export type ZoneKind = 'service_area' | 'pricing' | 'client' | 'branch' | 'depot'

/**
 * One point on a boundary.
 *
 * Named keys, never GeoJSON's positional `[lng, lat]`. That ordering is the
 * most common coordinate bug there is, and ADR-0020 records this codebase
 * hitting exactly that swap — a Kampala pin landing off the coast of Ghana
 * with both numbers inside their valid ranges.
 */
export interface BoundaryPoint {
  lat: number
  lng: number
}

export interface Zone {
  id: number
  /** Null for a platform zone — a town, an upcountry band, the service area. */
  tenant_id: number | null
  name: string
  kind: ZoneKind
  boundary: BoundaryPoint[]
  /** Lower wins where zones overlap: client 10, depot 20, branch 30, pricing 50, service area 90. */
  priority: number
  active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

/**
 * The zones a rate card may attach a price to.
 *
 * Mirrors `StoreRateCardVersionRequest::priceableZones()`, and mirrors it
 * for a reason: only pricing and client zones are ever returned by
 * `ZoneResolver::pricingZoneAt()`, so a rate on a depot boundary would be
 * accepted by no endpoint and used by no invoice. Offering only these in the
 * picker means the 422 is a backstop rather than the first a user hears of
 * it.
 */
export function isPriceableZone(zone: Zone): boolean {
  return zone.active && (zone.kind === 'pricing' || zone.kind === 'client')
}
