import { useInfiniteQuery } from '@tanstack/react-query';

import { fetchDriverTripHistory } from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';

/**
 * The driver's own finished work, a page at a time.
 *
 * `useInfiniteQuery` for the reason `useDriverLedger` gives: this is a whole
 * working history, unbounded and cursor-paginated at 25 on the server, so
 * paging is the shape of the thing rather than an optimisation over it.
 *
 * **The filter is part of the query key, not a predicate over loaded rows.**
 * Two consequences, and both are the point. The server does the narrowing, so
 * "Deliveries" means every delivery in the history rather than the deliveries
 * that happen to be in the twenty-five rows already fetched. And switching
 * back to a chip a driver has already looked at shows the cached answer
 * instantly instead of a spinner and a fresh round trip.
 *
 * `offlineFirst`, like every read in this app: React Query's default *pauses*
 * a query when the device reports no connection, which on a handset that
 * flickers in and out of coverage means a blank screen where last night's
 * cached history would do perfectly well. A record of finished work is the
 * least urgent thing here and the most reusable.
 *
 * **Not polled.** A history changes when a trip finishes, and that already
 * arrives through the outbox flush — `SyncProvider` invalidates this key
 * beside the ones it already invalidated. A timer would spend battery
 * re-asking a question whose answer almost never changes on its own.
 */
export function useTripHistory(serviceType: string | null) {
  const { api } = useAuth();

  return useInfiniteQuery({
    queryKey: ['trip-history', serviceType],
    queryFn: ({ pageParam }) => fetchDriverTripHistory(api, pageParam, serviceType),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    networkMode: 'offlineFirst',
    staleTime: 60_000,
    gcTime: 24 * 60 * 60 * 1000,
  });
}
