import type { Trip } from './trip'

/** Mirrors Modules/Bookings/Enums/BookingStatus.php. */
export type BookingStatus = 'pending' | 'approved' | 'rejected' | 'assigned' | 'cancelled'

export interface BookingUser {
  id: number
  name: string
  email: string
  role: string
}

export interface Booking {
  id: number
  tenant_id: number
  requested_by_user_id: number
  requested_by?: BookingUser
  passenger_name: string
  passenger_phone: string
  passenger_count: number
  origin: string
  destination: string
  /** Null for an immediate request. */
  scheduled_for: string | null
  is_immediate: boolean
  status: BookingStatus
  approved_by_user_id: number | null
  approved_by?: BookingUser
  approved_at: string | null
  /** Carries the rejection or cancellation reason; which one is in `status`. */
  decision_reason: string | null
  notes: string | null
  trip?: Trip
  created_at: string
  updated_at: string
}
