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
  /** Financial report only; the server rejects it on the others. */
  group_by: FinancialPeriod
}

/** Mirrors Modules/Reports/Enums/ReportType. */
export type ReportType = 'trips' | 'drivers' | 'vehicles' | 'financial'

/** Mirrors Modules/Reports/Enums/FinancialPeriod. */
export type FinancialPeriod = 'day' | 'week' | 'month' | 'year'

/**
 * A row of any report whose columns arrive beside it rather than being
 * held here — the driver, vehicle and financial reports.
 *
 * Positional on purpose: the server defines the column list once for the
 * screen, the CSV, the workbook and the PDF, and a fourth copy in the
 * client is the one that would drift. The symptom of that drift is a
 * correctly-populated table under the wrong headings, which is worse than
 * an error because it looks right.
 */
export type PositionalReportRow = (string | number | null)[]

/** @deprecated Prefer PositionalReportRow — the shape is not fleet-specific. */
export type FleetReportRow = PositionalReportRow

/** The meta every positional report returns, whatever its summary holds. */
export interface PositionalReportMeta<TSummary> {
  report: ReportType
  title: string
  headers: string[]
  period: string
  summary: TSummary
}

/** A driver or vehicle report. */
export type FleetReportMeta = PositionalReportMeta<{
  entities_active: number
  trips: number
  trips_completed: number
  distance_km: number
  duration_minutes: number
  variance_flagged: number
  average_distance_km: number
}>

/**
 * The financial report.
 *
 * Money arrives as whole shillings under `*_minor`, the platform-wide
 * convention (UGX is zero-decimal — see lib/format.ts, never divide by
 * 100).
 */
export type FinancialReportMeta = PositionalReportMeta<{
  periods: number
  invoices: number
  invoiced_minor: number
  credit_notes: number
  credited_minor: number
  /**
   * Issued less credited. NOT less payments — see `payments_recorded`.
   */
  outstanding_minor: number
  currency: string
  /**
   * False while Modules/Billing records no payments, which is the whole
   * of Phase 1 so far. The caveat under the Outstanding tile is driven by
   * this rather than hardcoded, so it disappears on its own the day
   * payments land instead of becoming a stale warning.
   */
  payments_recorded: boolean
}>

export type ExportFormat = 'csv' | 'xlsx' | 'pdf'

export type ExportStatus = 'queued' | 'processing' | 'completed' | 'failed'

/** A requested report file and the state of producing it. */
export interface ReportExport {
  id: number
  report: string
  report_label: string
  format: ExportFormat
  format_label: string
  status: ExportStatus
  filters: Record<string, string>
  row_count: number | null
  /** What a row counts — "trips", "drivers", "periods". Server-defined. */
  row_noun: string
  file_size: number | null
  /** The server's own rule — completed and not expired. */
  is_downloadable: boolean
  /** No further polling needed once true. */
  is_terminal: boolean
  error: string | null
  requested_by?: string
  expires_at: string | null
  created_at: string
  finished_at: string | null
}
