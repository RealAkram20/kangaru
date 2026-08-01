import type { Driver } from './driver'
import type { Vehicle } from './vehicle'

/**
 * Mirrors Modules/Trips/Enums/TripStatus.php. The backend enforces the
 * transition graph — this union exists only so the UI can label and tint a
 * status, never to decide what is legal.
 */
export type TripStatus =
  | 'assigned'
  | 'rejected'
  | 'accepted'
  | 'driver_en_route'
  | 'driver_arrived'
  | 'no_show'
  | 'passenger_onboard'
  | 'trip_started'
  | 'waiting'
  | 'trip_resumed'
  | 'trip_completed'
  | 'invoice_generated'
  | 'disputed'
  | 'closed'
  | 'cancelled'

export interface Trip {
  id: number
  tenant_id: number
  vehicle_id: number
  vehicle?: Vehicle
  driver_id: number
  driver?: Driver
  origin: string
  destination: string
  status: TripStatus
  odometer_start: number | null
  odometer_start_photo_path: string | null
  odometer_end: number | null
  odometer_end_photo_path: string | null
  /** Decimal string from the API (`"42.00"`), not a number. */
  distance_km: string | null
  gps_distance_km: string | null
  distance_variance_flagged: boolean
  cancellation_charge_applicable: boolean | null
  started_at: string | null
  completed_at: string | null
  /** Bank acceptance criterion #6; null until started AND completed. */
  duration_minutes: number | null
  created_at: string
  updated_at: string
}

/** One row of the append-only trip_events timeline. */
export interface TripEvent {
  id: number
  trip_id: number
  from_status: TripStatus | null
  to_status: TripStatus
  user_id: number | null
  /** Absent on system-written events (no actor). */
  user?: { id: number; name: string; role: string }
  notes: string | null
  created_at: string
}

export interface CursorMeta {
  cursor: { next: string | null }
}
