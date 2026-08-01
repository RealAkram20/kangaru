import type { BookingStatus } from '../types/booking'

type Tone = 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'brand'

/**
 * Presentation only — the legal transition graph lives in
 * Modules/Bookings/Enums/BookingStatus.php and is enforced server-side.
 */
const STATUS: Record<BookingStatus, { label: string; tone: Tone; icon: string }> = {
  pending: { label: 'Pending', tone: 'warning', icon: 'clock' },
  approved: { label: 'Approved', tone: 'info', icon: 'check' },
  rejected: { label: 'Rejected', tone: 'error', icon: 'x' },
  assigned: { label: 'Assigned', tone: 'success', icon: 'user-check' },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: 'ban' },
}

export function bookingStatusLabel(status: BookingStatus): string {
  return STATUS[status]?.label ?? status
}

export function bookingStatusTone(status: BookingStatus): Tone {
  return STATUS[status]?.tone ?? 'neutral'
}

export function bookingStatusIcon(status: BookingStatus): string {
  return STATUS[status]?.icon ?? 'circle'
}

/**
 * "Now" for an immediate booking, otherwise the pickup time. Dispatchers
 * scan this column, so it stays short.
 */
export function pickupLabel(booking: { is_immediate: boolean; scheduled_for: string | null }): string {
  if (booking.is_immediate || booking.scheduled_for === null) return 'Now'

  const when = new Date(booking.scheduled_for)
  const today = new Date()
  const sameDay =
    when.getFullYear() === today.getFullYear() &&
    when.getMonth() === today.getMonth() &&
    when.getDate() === today.getDate()

  const time = when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  return sameDay ? time : `${when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${time}`
}
