import type { ClientSummary } from './tenant'
import type { Driver } from './driver'
import type { Vehicle } from './vehicle'
import type { DistanceGrade } from './report'

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
  /**
   * The client this trip is for. Present only for a platform-level reader,
   * whose list spans clients (ADR-0006) — see `ClientSummary`.
   */
  client?: ClientSummary
  vehicle_id: number
  vehicle?: Vehicle
  driver_id: number
  driver?: Driver
  origin: string
  destination: string
  status: TripStatus
  /**
   * Legal next states for this trip, served by the API so no client copy
   * of the lifecycle graph exists. This is what the *state* permits, not
   * what the current user may do — the server still authorises each
   * attempt and can answer 403.
   */
  allowed_transitions: TripStatus[]
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

/**
 * One row of the distance review queue (ADR-0045 §2) — a trip whose distance
 * is holding money up.
 *
 * Deliberately not a `Trip`: a queue row is which trip, whose, who drove it,
 * what the resolver said, and how long it has waited. No fare, no payment
 * method, no passenger's phone number.
 */
export interface HeldTrip {
  trip_id: number
  tenant_id: number | null
  /** Absent for a client's own user, who has exactly one; null on a walk-in. */
  client?: string | null
  origin: string
  destination: string
  completed_at: string | null
  driver_name: string | null
  vehicle_registration: string | null
  grade: DistanceGrade
  grade_label: string
  billed_km: number | null
  odometer_km: number | null
  resolved_at: string | null
  /** Whole days since the resolution — PROJECT.md's two-business-day metric. */
  waiting_days: number | null
  /** A held walk-in has an unsettled fare and an unpaid driver behind it. */
  is_walk_in: boolean
  fare_settled: boolean
}

/** One resolution of a trip's distance — `GET /trips/{trip}/distance`. */
export interface DistanceEvidence {
  id: number
  resolved_at: string
  policy: 'gps_primary' | 'route_capped' | 'odometer'
  grade: DistanceGrade
  grade_label: string
  billed_km: number
  reason: string
  odometer_km: number | null
  gps_km: number | null
  matched_km: number | null
  inferred_km: number | null
  haversine_km: number | null
  route_km: number | null
  reference_source: 'pins' | 'trace' | null
  coverage_percent: number | null
  inferred_share_percent: number | null
  pings_total: number
  pings_kept: number
  gaps_routed: number
  dropped: Record<string, number>
  provider: 'osrm' | 'haversine' | null
  matched_polylines: string[]
  thresholds: Record<string, number | boolean>
}
