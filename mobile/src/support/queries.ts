import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createSupportRequest, fetchSupportRequests } from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';

/**
 * The driver's own reports and the office's answers (ADR-0044).
 *
 * `offlineFirst` like every other read in this app: a driver checking what the
 * office said about last Tuesday is far better served by this morning's copy
 * than by a spinner.
 *
 * **Not polled.** An answer is written by a person at a desk, minutes or days
 * after the report; polling for it would spend battery re-asking a question
 * whose answer changes once. The push and the inbox row carry the news
 * (ADR-0044 §4), and opening this screen refetches.
 */
export function useSupportRequests() {
  const { api } = useAuth();

  return useQuery({
    queryKey: ['support-requests'],
    queryFn: () => fetchSupportRequests(api),
    networkMode: 'offlineFirst',
    staleTime: 2 * 60_000,
    gcTime: 24 * 60 * 60 * 1000,
  });
}

/**
 * Sending one.
 *
 * **`networkMode` is left at React Query's default**, which pauses the mutation
 * when the device reports no connection — the opposite of the reads above, and
 * deliberate. A driver who writes an account of what happened and is told it
 * was sent must be right about that. ADR-0044 §5 refuses the offline outbox for
 * the same reason, and the screen says plainly that this one needs signal.
 *
 * **Not optimistic**, for the reason `useMarkAllNotificationsRead` gives: a
 * list that shows a report which is not on the server has told the driver
 * something untrue about the one thing they are trusting it with.
 */
export function useCreateSupportRequest() {
  const { api } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { topic: string; body: string; tripId?: number | null }) =>
      createSupportRequest(api, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['support-requests'] });
    },
  });
}
