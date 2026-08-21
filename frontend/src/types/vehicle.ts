// The fleet belongs to the platform, not to a client (ADR-0005), so
// there is no tenant_id here — Shanitah operates every vehicle.
export interface Vehicle {
  id: number
  registration_number: string
  make: string
  model: string
  year: number
  /**
   * The stored category key — `vehicle_categories.key` (ADR-0050).
   *
   * **A plain string, and it has to be.** This was a seven-member union,
   * and it had already drifted: `boda` and `tricycle` were on the fleet and
   * in the tariff and not in this type, so a boda coming back from the API
   * did not type-check. It cannot be a union at all now, because the office
   * adds categories through the console without a deploy — a union here
   * would be a build that has to ship before a new category can be read.
   *
   * Render it through `categoryLabel()` in `lib/vehicleCategories.ts`, never
   * directly: this is `suv`, and the screen says "SUV".
   */
  category: string
  seating_capacity: number
  color: string | null
  vin: string | null
  status: 'active' | 'maintenance' | 'inactive'
  created_at: string
  updated_at: string
}
