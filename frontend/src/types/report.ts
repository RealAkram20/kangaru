import type { TripStatus } from './trip'

/** One row of the trip report — the Bank's six acceptance criteria, flat. */
export interface TripReportRow {
  trip_id: number
  booking_id: number | null
  status: TripStatus
  commenced_at: string | null
  completed_at: string | null
  vehicle_registration: string | null
  vehicle_description: string | null
  driver_name: string | null
  origin: string
  destination: string
  odometer_start: number | null
  odometer_end: number | null
  /** Decimal string from the API, not a number. */
  distance_km: string | null
  duration_minutes: number | null
  /** False when the row cannot satisfy all six criteria. */
  is_complete: boolean
}

export interface TripReportSummary {
  trips: number
  trips_completed: number
  distance_km: number
  duration_minutes: number
  records_incomplete: number
  /** Null when nothing has completed — not 100%. */
  completeness_percent: number | null
}

export interface TripReportMeta {
  cursor: { next: string | null }
  summary: TripReportSummary
}

export interface TripReportFilters {
  from: string
  to: string
  vehicle_id: string
  driver_id: string
}
