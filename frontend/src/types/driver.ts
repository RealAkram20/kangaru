// Platform-level like Vehicle (ADR-0005): a driver works for Shanitah,
// not for a corporate client.
export interface Driver {
  id: number
  name: string
  phone: string
  email: string | null
  license_number: string
  license_expiry: string
  status: 'active' | 'suspended' | 'inactive'
  created_at: string
  updated_at: string
}
