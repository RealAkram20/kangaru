import { useQuery } from '@tanstack/react-query';

import { fetchDriverPerformance } from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';

/**
 * The Performance screen's figures.
 *
 * `offlineFirst` like every other read in this app: the default pauses a query
 * when the device reports no connection, which on a handset that flickers in
 * and out of coverage means a blank screen where a slightly stale answer would
 * do. A driver checking how their week is going is far better served by this
 * morning's cached figures than by a spinner.
 *
 * **Not polled, and the reason is stronger here than on the earnings screen.**
 * Nothing on this screen changes on a timer: rates move over a 30-day window,
 * the trip count moves when a trip completes, and the online hours move — but
 * a driver *reading this screen* is by definition not driving, so the figure
 * they are looking at is the figure they want. The outbox flush already
 * invalidates on completion (`SyncProvider`). A timer would spend battery
 * re-asking a question whose answer only changes on events the app knows
 * about.
 */
export function useDriverPerformance() {
  const { api } = useAuth();

  return useQuery({
    queryKey: ['driver-performance'],
    queryFn: () => fetchDriverPerformance(api),
    networkMode: 'offlineFirst',
    // Long enough that leaving the screen and coming straight back does not
    // refetch; short enough that opening it after a job shows the new count.
    staleTime: 60_000,
    gcTime: 24 * 60 * 60 * 1000,
  });
}
