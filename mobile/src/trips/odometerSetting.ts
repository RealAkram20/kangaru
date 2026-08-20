import { useQuery } from '@tanstack/react-query';

import { fetchOdometerEnabled } from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';

/**
 * Whether this deployment reads odometers (ADR-0047).
 *
 * Shared by every screen that would otherwise ask for a reading — the pickup
 * actions, the trip record, the waiting screen's opening form and the
 * in-progress screen's ending. One query, one cache entry, so the whole flow
 * agrees within a single trip: a driver who was asked for an opening reading
 * must be asked for a closing one, and a flag that flipped mid-journey
 * between two independent reads would produce exactly the mismatch the server
 * then refuses.
 *
 * **Defaults to `true` while it is loading or unreachable.** The reasoning is
 * in `fetchOdometerEnabled`, and it is worth restating because it inverts the
 * fail-closed rule the auth methods follow: being wrongly *off* strands a trip
 * behind a 422 the driver reads hours later on the sync queue, while being
 * wrongly *on* costs one screen. The default takes the cheaper mistake.
 *
 * Cached by the persisted query client, so the worst case on a bad connection
 * is this morning's answer rather than a spinner.
 */
export function useOdometerEnabled(): boolean {
  const { api } = useAuth();

  const { data } = useQuery({
    queryKey: ['odometer-enabled'],
    queryFn: () => fetchOdometerEnabled(api),
    // Five minutes, matching `useAuthMethods`. This changes about as often as
    // a sign-in method does — which is to say, almost never, and always by
    // somebody deliberately.
    staleTime: 5 * 60 * 1000,
    networkMode: 'offlineFirst',
  });

  return data ?? true;
}
