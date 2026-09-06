/**
 * What a fleet pays to be on Kangaru (ADR-0058), as `/plans` serves it.
 *
 * A null limit means no ceiling — rendered as the word "Unlimited", never as
 * a dash (which reads as unknown) or a large figure (which reads as a ceiling
 * you have not hit yet).
 */
export interface Plan {
  id: number
  slug: string
  name: string
  description: string | null
  is_default: boolean
  price_minor: number
  currency: string
  period: 'none' | 'monthly' | 'annual'
  driver_limit: number | null
  vehicle_limit: number | null
  staff_limit: number | null
  fleets_count?: number
}
