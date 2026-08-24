import type { ClientSummary } from './tenant'
import type { Trip } from './trip'

/** Mirrors Modules/Bookings/Enums/BookingStatus.php. */
export type BookingStatus = 'pending' | 'approved' | 'rejected' | 'assigned' | 'cancelled'

/**
 * Mirrors Modules/Bookings/Enums/OrderRequestServiceType.php — the same
 * triad the walk-in order form offers, on the internal channel since
 * ADR-0064.
 */
export type BookingServiceType = 'ride' | 'delivery' | 'self_drive'

/**
 * The per-service extras, exactly as `BookingResource` emits them: the
 * service's own keys all present (missing values as null), and null on a
 * ride, whose absence of details is the fact itself.
 */
export interface BookingDetails {
  // Delivery
  item_type?: string | null
  package_size?: string | null
  payer?: string | null
  payment_method?: string | null
  recipient_name?: string | null
  recipient_phone?: string | null
  confirm_with_pin?: boolean | null
  // Self drive
  start_date?: string | null
  end_date?: string | null
  kyc_documents?: string | null
}

export interface BookingUser {
  id: number
  name: string
  email: string
  role: string
}

export interface Booking {
  id: number
  tenant_id: number
  /**
   * Present only when the reader is platform-level — Shanitah's own staff,
   * whose queue spans every client (ADR-0006). Absent, not null, for a
   * client's own listing, which is all one client's by definition.
   *
   * `tenant_id` above is not a substitute: nobody reads "3" as a bank.
   */
  client?: ClientSummary
  requested_by_user_id: number
  requested_by?: BookingUser
  /**
   * The colleague this was raised for, when a client raised it; null for
   * the walk-ins and callers Shanitah's own desk books. The link, not the
   * source — the name and number below are the snapshot the driver was
   * dispatched against, and stay authoritative.
   */
  passenger_user_id: number | null
  passenger_name: string
  passenger_phone: string
  passenger_count: number
  /**
   * The kind of vehicle the client asked for (ADR-0051), or null when they
   * stated none.
   *
   * **Null is a real answer.** "No preference" and "asked for a van, got a
   * sedan" are different facts, and a client's auditor is entitled to tell
   * them apart — so this is never rendered as a default or coerced to one.
   */
  vehicle_category: string | null
  service_type: BookingServiceType
  details: BookingDetails | null
  /** Null on a self-drive rental, which has no route (ADR-0064). */
  origin: string | null
  destination: string | null
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
