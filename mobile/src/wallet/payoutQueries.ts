import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type DriverPayoutAccount,
  type PayoutAccountKind,
  deletePayoutAccount,
  fetchPayoutAccount,
  savePayoutAccount,
} from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';

/**
 * Where the driver's money is sent (ADR-0042).
 *
 * In `wallet/` rather than `profile/` because that is what it is about — the
 * Wallet already owns settling up, and a payout destination read from the
 * Profile screen is still a fact about being paid. The screen it opens from is
 * navigation, not ownership.
 *
 * **Not polled.** A bank account changes roughly never, and a timer here would
 * spend battery re-asking a question whose answer almost never moves on its
 * own — the same argument `useDriverProfile` makes.
 */
export function usePayoutAccount() {
  const { api } = useAuth();

  return useQuery({
    queryKey: ['payout-account'],
    queryFn: () => fetchPayoutAccount(api),
    networkMode: 'offlineFirst',
    staleTime: 5 * 60_000,
    gcTime: 24 * 60 * 60 * 1000,
  });
}

export function useSavePayoutAccount() {
  const { api } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      kind: PayoutAccountKind;
      institution: string;
      account_holder: string;
      account_number: string;
    }) => savePayoutAccount(api, input),
    /*
     * Writes the server's answer into the cache rather than only invalidating.
     * The response carries the masked account the server actually stored, and
     * showing that — rather than what was typed — is the point: the tail the
     * driver checks must come from the record, not from the form.
     */
    onSuccess: (account: DriverPayoutAccount) => {
      queryClient.setQueryData(['payout-account'], account);
    },
  });
}

export function useDeletePayoutAccount() {
  const { api } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => deletePayoutAccount(api),
    onSuccess: () => {
      queryClient.setQueryData(['payout-account'], null);
    },
  });
}
