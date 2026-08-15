import { useQuery } from '@tanstack/react-query';

import { fetchDriverEarnings, type EarningsPeriod } from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';

/**
 * The earnings screen's figures.
 *
 * Keyed by period, so the three tabs each hold their own cached answer and
 * switching back to one a driver has already seen is instant rather than a
 * spinner. React Query keeps all three; they are small.
 *
 * `offlineFirst` like every other read in this app — the default pauses a
 * query when the device reports no connection, which on a handset that
 * flickers in and out of coverage means a blank screen where a slightly stale
 * answer would do. A driver checking what they made this morning is far
 * better served by this morning's cached figure than by a spinner.
 *
 * Not polled. Earnings move when a trip completes, and the outbox flush
 * already invalidates this key — see `SyncProvider`. A timer here would spend
 * battery re-asking a question whose answer only changes on an event the app
 * already knows about.
 */
export function useDriverEarnings(period: EarningsPeriod) {
  const { api } = useAuth();

  return useQuery({
    queryKey: ['driver-earnings', period],
    queryFn: () => fetchDriverEarnings(api, period),
    networkMode: 'offlineFirst',
    // Long enough that flicking between tabs does not refetch, short enough
    // that returning to the screen after a job shows the new figure.
    staleTime: 60_000,
    gcTime: 24 * 60 * 60 * 1000,
  });
}
