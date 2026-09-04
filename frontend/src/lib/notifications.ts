import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from './apiClient'
import { apiError } from './apiError'
import type { ApiSuccess } from '../types/api'
import type { AppNotification, NotificationMeta, NotificationType } from '../types/notification'

/**
 * The inbox, shared by the bell and the notifications page.
 *
 * One hook rather than each surface fetching for itself: they show the same
 * rows and the same unread count, and two implementations of "mark this
 * read" is two chances for the badge and the list to disagree.
 */

/** Icon per type, so a kind of notification is recognisable before it is read. */
export function notificationIcon(type: NotificationType): string {
  switch (type) {
    case 'booking.approved':
      return 'circle-check'
    case 'booking.rejected':
      return 'circle-x'
    case 'report.export.ready':
      return 'download'
    case 'trip.assigned':
      return 'car'
    case 'trip.driver_arrived':
      return 'map-pin-check'
    case 'trip.completed':
      return 'flag'
    default:
      // An unknown type is a server that has shipped ahead of this client.
      // A generic icon renders it honestly; a thrown error would blank the
      // whole panel over one unrecognised row.
      return 'bell'
  }
}

export function notificationTone(type: NotificationType): 'success' | 'warning' | 'info' | 'neutral' {
  switch (type) {
    case 'booking.approved':
      return 'success'
    case 'booking.rejected':
      return 'warning'
    case 'report.export.ready':
      return 'info'
    case 'trip.assigned':
    case 'trip.driver_arrived':
      return 'info'
    case 'trip.completed':
      return 'success'
    default:
      return 'neutral'
  }
}

interface Options {
  /** Bell: a short list. Page: the lot. */
  limit?: number
  unreadOnly?: boolean
  /**
   * Poll interval in ms. The bell polls because nothing is pushed yet
   * (Reverb is unbuilt — see Modules/Notifications/README.md). Zero or
   * undefined means fetch once and stay quiet.
   */
  pollMs?: number
}

/**
 * The fetch, kept free of setState.
 *
 * Deliberate, and the same shape BookingsPage uses: the effect below must
 * only ever set state from a promise callback, never synchronously in its
 * body, or `react-hooks/set-state-in-effect` fails the build — and it is
 * right to, because a synchronous set there cascades renders.
 */
async function fetchInbox(limit: number, unreadOnly: boolean) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (unreadOnly) params.set('unread', '1')

  const response = await apiClient.get<ApiSuccess<AppNotification[], NotificationMeta>>(
    `/notifications?${params.toString()}`,
  )

  return { items: response.data.data, unread: response.data.meta?.unread ?? 0 }
}

export function useNotifications({ limit = 20, unreadOnly = false, pollMs }: Options = {}) {
  const [items, setItems] = useState<AppNotification[] | null>(null)
  const [unread, setUnread] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Held in a ref so a poll landing does not restart the timer that fired
  // it — an interval rebuilt on its own result never settles.
  const busy = useRef(false)

  const apply = useCallback((result: { items: AppNotification[]; unread: number }) => {
    setItems(result.items)
    setUnread(result.unread)
    setError(null)
  }, [])

  const load = useCallback(async () => {
    if (busy.current) return
    busy.current = true

    try {
      apply(await fetchInbox(limit, unreadOnly))
    } catch (failure) {
      setError(apiError(failure, 'Could not load your notifications.').message)
    } finally {
      busy.current = false
    }
  }, [limit, unreadOnly, apply])

  useEffect(() => {
    let cancelled = false

    /*
     * Deliberately NOT guarded by `busy`.
     *
     * StrictMode double-invokes effects in development, and main.tsx wraps
     * the app in it. With a `busy` guard here the sequence is: first run
     * takes the flag and starts fetching; cleanup marks that closure
     * cancelled; the second run finds the flag still held and does
     * nothing; the first fetch resolves into a cancelled closure and is
     * discarded. Nothing ever sets state and the page shows "Loading…"
     * forever.
     *
     * That was observed in a browser, not reasoned about — the unit tests
     * passed because Testing Library does not render in StrictMode by
     * default. `src/test/harness.tsx` now does, so this cannot come back
     * silently.
     *
     * `cancelled` is the only guard needed: it drops the stale result. Two
     * overlapping GETs on mount is a cost worth paying to be correct, and
     * at a 60s poll interval overlap does not otherwise arise.
     */
    const run = () => {
      fetchInbox(limit, unreadOnly)
        .then((result) => {
          if (!cancelled) apply(result)
        })
        .catch((failure: unknown) => {
          if (!cancelled) setError(apiError(failure, 'Could not load your notifications.').message)
        })
    }

    run()

    if (!pollMs) {
      return () => {
        cancelled = true
      }
    }

    const timer = window.setInterval(run, pollMs)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [limit, unreadOnly, pollMs, apply])

  /**
   * Marks one read, updating the row and the badge locally first.
   *
   * Optimistic because the server cannot refuse this — the endpoint is
   * scoped to the caller's own inbox, so the only failure is the network,
   * and a badge that lags a click by a round trip feels broken. The reload
   * afterwards reconciles.
   */
  const markRead = useCallback(async (id: number) => {
    setItems((current) =>
      current?.map((item) => (item.id === id ? { ...item, is_read: true } : item)) ?? current,
    )
    setUnread((count) => Math.max(0, count - 1))

    try {
      await apiClient.patch(`/notifications/${id}`)
    } catch (failure) {
      setError(apiError(failure, 'Could not mark that as read.').message)
    }
  }, [])

  const markAllRead = useCallback(async () => {
    setItems((current) => current?.map((item) => ({ ...item, is_read: true })) ?? current)
    setUnread(0)

    try {
      await apiClient.patch('/notifications')
    } catch (failure) {
      setError(apiError(failure, 'Could not mark everything as read.').message)
    }
  }, [])

  return { items, unread, error, reload: load, markRead, markAllRead, dismissError: () => setError(null) }
}
