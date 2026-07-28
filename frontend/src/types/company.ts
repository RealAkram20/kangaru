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
  created_at: string
  updated_at: string
}
