import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type DriverClosureRequest,
  fetchClosureRequest,
  requestClosure,
  withdrawClosureRequest,
} from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';

/**
 * The driver's own closure request (ADR-0043).
 *
 * In `profile/` rather than `wallet/` because it is a fact about the account,
 * not about being paid — the mirror of the argument `payoutQueries` makes for
 * living in `wallet/`.
 *
 * **Not polled**, on the same reasoning as the payout account and with one
 * addition that matters more: the answer to this question arrives by *email*,
 * because a confirmed closure has just detached the sign-in and there is no
 * handset left to push to (ADR-0043 §4). A timer here would be spending a
 * driver's battery waiting for a state change it may never be able to read.
 *
 * `staleTime: 0` all the same, so opening the screen re-asks. The office may
 * have answered since the app was last opened, and a declined request with its
 * reason is the whole reason the endpoint returns the latest rather than only
 * the open one.
 */
export function useClosureRequest() {
  const { api } = useAuth();

  return useQuery({
    queryKey: ['closure-request'],
    queryFn: () => fetchClosureRequest(api),
    networkMode: 'offlineFirst',
    staleTime: 0,
    gcTime: 24 * 60 * 60 * 1000,
  });
}

export function useRequestClosure() {
  const { api } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (reason: string | null) => requestClosure(api, reason),
    /*
     * The server's row, written straight into the cache. It carries the
     * `requested_at` the screen shows, and taking that from the response rather
     * than stamping a local clock is the same rule the payout account follows:
     * what the driver reads back is the record, not the form.
     */
    onSuccess: (request: DriverClosureRequest) => {
      queryClient.setQueryData(['closure-request'], request);
    },
  });
}

export function useWithdrawClosureRequest() {
  const { api } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => withdrawClosureRequest(api),
    onSuccess: (request: DriverClosureRequest) => {
      queryClient.setQueryData(['closure-request'], request);
    },
  });
}
