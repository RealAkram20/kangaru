/**
 * The fleet's category vocabulary (ADR-0050).
 *
 * Global, like the fleet itself (ADR-0005) — no `tenant_id`. A client does
 * not get their own idea of what a minibus is.
 */
export interface VehicleCategory {
  id: number
  /**
   * The stored key: what lives on `vehicles.category`,
   * `rate_card_rates.vehicle_category` and `invoice_lines.vehicle_category`.
   *
   * **Never rendered as a label.** It is `suv`, and every screen shows
   * `name`. It appears in this type because an operator reconciling a
   * report needs to be able to see the string their data holds, and because
   * it is what every payload sends.
   *
   * Immutable server-side: `UpdateVehicleCategoryRequest` answers 422 to a
   * request that carries it.
   */
  key: string
  name: string
  description: string | null
  /** Whether a new vehicle or a new rate card version may choose it. */
  active: boolean
  position: number

  /**
   * The three below are on the **list** response only, and are absent —
   * not zero — on a create or an edit.
   *
   * That distinction is load-bearing, which is why they are optional rather
   * than defaulted: `unpriced_rate_cards: []` reads as "priced on every
   * tariff", and for a category created one millisecond ago the truth is
   * the exact opposite.
   */
  vehicles_count?: number
  rate_cards_total?: number
  /**
   * The active rate cards whose **newest** version does not price this
   * category.
   *
   * A vehicle of this kind cannot be quoted or invoiced on any card named
   * here. Nothing can fix that in place: a rate card version is immutable,
   * so the price has to go on a *new* version (ADR-0050 §5).
   */
  unpriced_rate_cards?: { id: number; name: string }[]

  created_at: string
  updated_at: string
}
