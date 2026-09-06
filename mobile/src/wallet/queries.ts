import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createSettlementRequest,
  fetchDriverLedger,
  fetchSettlementRequests,
  type LedgerRange,
  type SettlementRequestKind,
} from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';

/**
 * The wallet statement, a page at a time.
 *
 * `useInfiniteQuery` rather than a plain query: the ledger is append-only and
 * unbounded — a driver's whole working history — so it is cursor-paginated at
 * 25 on the server, and paging is the point rather than an optimisation.
 *
 * `offlineFirst` like every other read in this app: React Query's default
 * pauses a query when the device reports no connection, which on a handset
 * that flickers in and out of coverage means a blank screen where the last
 * known statement would do. A driver checking what the office recorded is far
 * better served by yesterday's cached page than by a spinner.
 *
 * Not polled. Entries appear when a trip completes or the office records a
 * settlement; the first is already an outbox flush, which invalidates this
 * key (see `SyncProvider`), and the second is rare enough that a pull to
 * refresh is the right cost. A timer here would spend battery re-asking a
 * question whose answer almost never changes on its own.
 */
export function useDriverLedger(range: LedgerRange = {}) {
  const { api } = useAuth();

  return useInfiniteQuery({
    // The range is part of the key, so switching filters shows a cached
    // answer instantly instead of a spinner, and going back to one a driver
    // has already seen costs nothing.
    queryKey: ['driver-ledger', range.from ?? null, range.to ?? null],
    queryFn: ({ pageParam }) => fetchDriverLedger(api, pageParam, range),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    networkMode: 'offlineFirst',
    staleTime: 60_000,
    gcTime: 24 * 60 * 60 * 1000,
  });
}

/**
 * The driver's own settlement requests (ADR-0032).
 *
 * Short and unpaginated — a driver holds at most one open request per kind
 * and settles weekly, not per trip.
 */
export function useSettlementRequests() {
  const { api } = useAuth();

  return useQuery({
    queryKey: ['settlement-requests'],
    queryFn: () => fetchSettlementRequests(api),
    networkMode: 'offlineFirst',
    staleTime: 30_000,
    gcTime: 24 * 60 * 60 * 1000,
  });
}

/**
 * Raising one.
 *
 * **Deliberately not through the offline outbox**, unlike every trip
 * transition this app makes. The outbox exists so a driver in a dead zone
 * loses nothing, and it is right for a transition that describes something
 * that already happened. This is a *message to a person*, and a queued one is
 * worse than a refused one: a driver would walk away believing the office had
 * been told, and find out days later that it had not. It needs a connection
 * and the sheet says so — the same call the password change and the duty
 * toggle make, for the same reason.
 *
 * On success the ledger is **not** invalidated, and that is the point: a
 * pending request changes no balance. Only the request list moves.
 */
export function useCreateSettlementRequest() {
  const { api } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      kind: SettlementRequestKind;
      amountMinor: number;
      note: string | null;
    }) => createSettlementRequest(api, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settlement-requests'] });
    },
  });
}
