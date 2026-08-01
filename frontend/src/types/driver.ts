export interface Driver {
  id: number
  tenant_id: number
  name: string
  phone: string
  email: string | null
  license_number: string
  license_expiry: string
  status: 'active' | 'suspended' | 'inactive'
  created_at: string
  updated_at: string
}
