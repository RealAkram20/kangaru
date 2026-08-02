// The fleet belongs to the platform, not to a client (ADR-0005), so
// there is no tenant_id here — Shanitah operates every vehicle.
export interface Vehicle {
  id: number
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
