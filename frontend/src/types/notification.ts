/** Mirrors Modules/Notifications/Enums/NotificationType.php. */
export type NotificationType = 'booking.approved' | 'booking.rejected' | 'report.export.ready'

/**
 * One delivered notification.
 *
 * `subject` and `body` are rendered server-side at dispatch time and frozen
 * — the row records what somebody was *told*, so the client displays them
 * rather than rebuilding the sentence from `context`. `context` is there to
 * branch on, not to re-render from.
 */
export interface AppNotification {
  id: number
  type: NotificationType
  type_label: string
  subject: string
  body: string
  /** Relative and SPA-local, e.g. "/bookings/41". Null when there is nowhere useful. */
  url: string | null
  context: Record<string, unknown> | null
  is_read: boolean
  read_at: string | null
  created_at: string
}

export interface NotificationMeta {
  unread: number
}
