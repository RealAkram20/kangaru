export interface Company {
  id: number
  tenant_id: number
  legal_name: string
  trading_name: string | null
  registration_number: string | null
  industry: string | null
  billing_email: string
  phone: string | null
  address_line1: string | null
  address_line2: string | null
  city: string
  country: string
  credit_limit_minor: number
  status: 'active' | 'suspended'
  /**
   * The fleets serving this client, served to head office alone.
   *
   * Absent for every other level on purpose: ADR-0060 section 4 refuses one
   * fleet the knowledge of which competitor also serves its client, so the
   * backend omits the key rather than sending an empty array everybody could
   * mistake for "nobody".
   */
  served_by?: { id: number; name: string | null }[]
  created_at: string
  updated_at: string
}
