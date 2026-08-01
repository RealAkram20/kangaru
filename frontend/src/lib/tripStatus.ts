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
