export interface Vehicle {
  id: number
  tenant_id: number
  registration_number: string
  make: string
  model: string
  year: number
  category: 'sedan' | 'suv' | 'van' | 'minibus' | 'bus' | 'pickup' | 'truck'
  seating_capacity: number
  color: string | null
  vin: string | null
  status: 'active' | 'maintenance' | 'inactive'
  created_at: string
  updated_at: string
}
