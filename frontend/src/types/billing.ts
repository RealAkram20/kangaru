/**
 * Mirrors Modules/Billing's API resources.
 *
 * Every money field is an integer in the currency's minor unit, named
 * `*_minor`, exactly as the backend stores it (AGENTS.md Money & Billing
 * Standards). UGX is zero-decimal, so one minor unit is one whole shilling
 * and there is never a divide-by-100 anywhere in this app — see
 * `formatUgx` in lib/format.ts.
 */

export type RoundingMode = 'half_up' | 'half_down' | 'up' | 'down'

export type InvoiceLineType =
  | 'base_fare'
  | 'distance'
  | 'waiting'
  | 'minimum_charge_adjustment'
  | 'maximum_charge_adjustment'

export interface RateCardRate {
  vehicle_category: string
  base_fare_minor: number
  per_km_minor: number
  per_waiting_minute_minor: number
  minimum_charge_minor: number
  /** Null means uncapped, never "capped at zero". */
  maximum_charge_minor: number | null
}

export interface RateCardVersion {
  id: number
  version: number
  effective_from: string | null
  currency: string
  rounding_mode: RoundingMode
  rounding_mode_label: string
  free_waiting_minutes: number
  /** "22:00:00", or null when this version has no night rate. */
  night_starts_at: string | null
  night_ends_at: string | null
  /** Basis points: 12500 = 1.25x. An integer, never a float. */
  night_multiplier_bp: number
  /**
   * True once an invoice has cited this version. From that moment nothing
   * about it can change — which is the property that ends billing disputes.
   */
  is_locked: boolean
  locked_at: string | null
  notes: string | null
  rates?: RateCardRate[]
  created_at: string
}

export interface RateCard {
  id: number
  name: string
  description: string | null
  status: 'active' | 'archived'
  /** The card invoice generation uses when the caller names none. */
  is_default: boolean
  versions?: RateCardVersion[]
  created_at: string
  updated_at: string
}

/**
 * The inputs that produced a line, stored on the line itself so an invoice
 * is reproducible from what was saved (AGENTS.md Calculation).
 */
export interface InvoiceLineInputs {
  rate_card_version_id: number
  vehicle_category: string
  /** Always null until the geofencing engine exists. */
  zone: string | null
  /** Decimal string from the API ("42.00"), not a number. */
  distance_km: string | null
  waiting_minutes: number | null
  multiplier_bp: number
  rounding_mode: RoundingMode
}

export interface InvoiceLine {
  /** Needed to attribute a credit note line to the line it corrects. */
  id: number
  line_number: number
  type: InvoiceLineType
  type_label: string
  /** Rendered when the invoice was issued — the wording on the document. */
  description: string
  /** Decimal string: kilometres, minutes, or "1.00" for a flat line. */
  quantity: string
  unit_amount_minor: number
  /** Signed: a maximum-charge adjustment is negative. */
  amount_minor: number
  currency: string
  inputs: InvoiceLineInputs
}

export interface CreditNoteLine {
  line_number: number
  description: string
  amount_minor: number
  /** Null on a goodwill credit that corrects no single line. */
  invoice_line_id: number | null
}

export interface CreditNote {
  uuid: string
  credit_note_number: string
  invoice_id: number
  currency: string
  /** Positive: the amount taken off the invoice. */
  total_minor: number
  reason: string
  issued_at: string
  issued_by_user_id: number
  lines?: CreditNoteLine[]
}

export interface Invoice {
  /** The external reference. The integer id is never served. */
  uuid: string
  invoice_number: string
  trip_id: number
  rate_card_version_id: number
  currency: string
  total_minor: number
  credited_minor: number
  /** total less credited. There are no payments yet — see the README. */
  balance_minor: number
  issued_at: string
  issued_by_user_id: number
  notes: string | null
  lines?: InvoiceLine[]
  credit_notes?: CreditNote[]
}
