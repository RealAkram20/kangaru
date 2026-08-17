import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';

/**
 * The driver's inbox (ADR-0039).
 *
 * `offlineFirst` like every other read in this app: React Query's default
 * pauses a query when the device reports no connection, and a driver checking
 * what the office said is far better served by this morning's list than by a
 * spinner.
 *
 * **Not polled**, and that is deliberate rather than an omission. A job offer
 * is the only thing on this platform urgent enough to interrupt somebody, and
 * it already has its own channel — `useOffers` polls, `OfferPresenter` paints
 * over everything, and a push lands on the lock screen. Polling the inbox as
 * well would spend battery re-asking a question whose answer changes a few
 * times a day, to move a dot.
 */
export function useNotifications() {
  const { api } = useAuth();

  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => fetchNotifications(api),
    networkMode: 'offlineFirst',
    staleTime: 2 * 60_000,
    gcTime: 24 * 60 * 60 * 1000,
  });
}

/**
 * Marking one read.
 *
 * **Deliberately not through the offline outbox**, unlike every trip
 * transition. ADR-0023's queue exists so a driver in a dead zone loses no
 * *work*; a read receipt is not work, and a queued one would sit there for
 * hours to move a dot the driver has already stopped looking at. It fails
 * silently for the same reason — a toast saying "could not mark as read" is
 * noise about something nobody asked for.
 */
export function useMarkNotificationRead() {
  const { api } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => markNotificationRead(api, id),
    onSuccess: () => {
      // The unread count rides in the same payload, so one invalidation moves
      // both the list and the drawer's dot.
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/**
 * Clearing the lot, from the button at the foot of the inbox.
 *
 * **Deliberately not silent, unlike the single mark above.** That one is a
 * side effect of reading a message and nobody asked for it; this one is a
 * button somebody pressed, and a press that appears to do nothing is the
 * failure a driver retries until they give up. It reports, and the screen
 * keeps the button until the refetch says the list is clear.
 *
 * Also **not optimistic**, for the reason the same screen refuses invented
 * figures: an inbox that empties locally and fills again on the next refetch
 * has told the driver something that was not true. The round trip here is one
 * request on a screen nobody is timing.
 */
export function useMarkAllNotificationsRead() {
  const { api } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => markAllNotificationsRead(api),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
