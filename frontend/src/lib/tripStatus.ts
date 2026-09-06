import type { TripStatus } from '../types/trip'

type Tone = 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'brand'

/**
 * Presentation only. The legal transition graph lives in
 * Modules/Trips/Enums/TripStatus.php and is enforced server-side — nothing
 * here may be used to decide what a user is allowed to do.
 *
 * Kept in `lib/` rather than inside TripsPage because Dispatch and Bookings
 * will render the same statuses, and a second copy of this map would drift.
 */
const STATUS: Record<TripStatus, { label: string; tone: Tone; icon: string }> = {
  assigned: { label: 'Assigned', tone: 'info', icon: 'user-check' },
  rejected: { label: 'Rejected', tone: 'error', icon: 'user-x' },
  accepted: { label: 'Accepted', tone: 'info', icon: 'check' },
  driver_en_route: { label: 'Driver en route', tone: 'info', icon: 'navigation' },
  driver_arrived: { label: 'Driver arrived', tone: 'info', icon: 'map-pin' },
  no_show: { label: 'No show', tone: 'error', icon: 'user-minus' },
  passenger_onboard: { label: 'Passenger onboard', tone: 'info', icon: 'users' },
  trip_started: { label: 'Trip started', tone: 'brand', icon: 'play' },
  waiting: { label: 'Waiting', tone: 'warning', icon: 'pause' },
  trip_resumed: { label: 'Trip resumed', tone: 'brand', icon: 'play' },
  trip_completed: { label: 'Trip completed', tone: 'success', icon: 'flag' },
  invoice_generated: { label: 'Invoice generated', tone: 'success', icon: 'file-text' },
  disputed: { label: 'Disputed', tone: 'error', icon: 'alert-triangle' },
  closed: { label: 'Closed', tone: 'neutral', icon: 'archive' },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: 'x' },
}

export function tripStatusLabel(status: TripStatus): string {
  return STATUS[status]?.label ?? status
}

export function tripStatusTone(status: TripStatus): Tone {
  return STATUS[status]?.tone ?? 'neutral'
}

export function tripStatusIcon(status: TripStatus): string {
  return STATUS[status]?.icon ?? 'circle'
}

/** Ordered for a filter control: lifecycle order, not alphabetical. */
export const TRIP_STATUSES = Object.keys(STATUS) as TripStatus[]

/**
 * Transitions the backend requires extra input for. Mirrors
 * TransitionTripRequest's rules so the dialog asks for the right thing up
 * front — the server still validates and is the authority; getting this
 * wrong costs a 422, not a bad write.
 */
export function transitionNeeds(to: TripStatus): {
  odometer: 'start' | 'end' | null
  reason: boolean
} {
  return {
    odometer: to === 'trip_started' ? 'start' : to === 'trip_completed' ? 'end' : null,
    reason: (['cancelled', 'rejected', 'no_show', 'disputed'] as TripStatus[]).includes(to),
  }
}

/**
 * Transitions that end or curtail the journey, styled as destructive so a
 * dispatcher does not cancel a trip with the same button weight as
 * advancing one.
 */
export function isDestructiveTransition(to: TripStatus): boolean {
  return (['cancelled', 'rejected', 'no_show', 'disputed'] as TripStatus[]).includes(to)
}

/**
 * "1h 35m" / "45m". The API sends whole minutes (Bank acceptance criterion
 * #6 asks for hours/minutes), so no rounding happens here.
 */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '—'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** Distance arrives as a decimal string ("42.00") — never a float. */
export function formatDistance(km: string | null): string {
  if (km === null) return '—'
  return `${Number(km).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`
}

export function formatOdometer(reading: number | null): string {
  return reading === null ? '—' : reading.toLocaleString('en-US')
}

/**
 * The verdict on a finished trip's mileage record, for the reader who is
 * billed by it (Centenary's letter, points 4–6).
 *
 * - `verified`   — both odometer readings present and the GPS trace agrees
 *                  with them (ADR-0016's reconciliation did not flag it).
 * - `check`      — the readings and the GPS trace disagree beyond the
 *                  tolerance; the platform flagged it itself, and the client
 *                  should see that before they ask.
 * - `unverified` — the readings are there but no GPS trace exists to check
 *                  them against (a handset with no fix, an old record).
 * - `incomplete` — a reading is missing, so there is no distance to bill.
 * - `null`       — the trip has not finished; there is nothing to judge yet.
 *
 * Read from what the API stores, never inferred: `distance_variance_flagged`
 * is the server's own verdict and this only names it.
 */
export type RecordVerdict = 'verified' | 'check' | 'unverified' | 'incomplete'

const FINISHED: TripStatus[] = ['trip_completed', 'invoice_generated', 'closed']

export function recordVerdict(trip: {
  status: TripStatus
  odometer_start: number | null
  odometer_end: number | null
  gps_distance_km: string | null
  distance_variance_flagged: boolean
}): RecordVerdict | null {
  if (!FINISHED.includes(trip.status)) return null
  if (trip.odometer_start === null || trip.odometer_end === null) return 'incomplete'
  if (trip.distance_variance_flagged) return 'check'
  if (trip.gps_distance_km === null) return 'unverified'
  return 'verified'
}

export const RECORD_VERDICT: Record<RecordVerdict, { label: string; tone: Tone; icon: string; explain: string }> = {
  verified: {
    label: 'Verified',
    tone: 'success',
    icon: 'shield-check',
    explain: 'Both odometer readings were captured and the GPS trace agrees with them.',
  },
  check: {
    label: 'Check',
    tone: 'warning',
    icon: 'triangle-alert',
    explain: 'The odometer readings and the GPS trace disagree beyond tolerance. Flagged by the platform for review.',
  },
  unverified: {
    label: 'Unverified',
    tone: 'neutral',
    icon: 'shield-question-mark',
    explain: 'Both readings were captured, but no GPS trace exists to check them against.',
  },
  incomplete: {
    label: 'Incomplete',
    tone: 'error',
    icon: 'circle-alert',
    explain: 'An odometer reading is missing, so no distance can be established for this trip.',
  },
}
