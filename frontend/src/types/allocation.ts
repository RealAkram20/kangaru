import type { ClientSummary } from './tenant'
import type { Vehicle } from './vehicle'

/**
 * A period for which a vehicle is contracted to a client — what Centenary
 * Bank's letter means by "vehicles supplied to the Bank" (ADR-0005,
 * ADR-0009). Mirrors `VehicleAllocation` in the contract.
 */
export interface VehicleAllocation {
  id: number
  tenant_id: number
  /** Present only for a platform-level reader (ADR-0006). */
  client?: ClientSummary
  vehicle_id: number
  vehicle: Vehicle | null
  /** `YYYY-MM-DD`. */
  starts_on: string
  /** `YYYY-MM-DD`; null for an open-ended contract. The last day counts as in force. */
  ends_on: string | null
  exclusive: boolean
  in_force: boolean
  notes: string | null
  created_at: string
  updated_at: string
}
