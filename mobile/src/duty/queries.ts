import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { acceptOffer, declineOffer, fetchDuty, fetchOffers, setDuty } from '../api/endpoints';
import type { DispatchOffer, DriverPresence, Trip } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { OFFER_POLL_INTERVAL_MS } from '../config';

/**
 * Duty state and job offers (ADR-0024 §2–§3).
 *
 * ## Why none of this goes through the outbox
 *
 * Every other mutation in this app is queued, because ADR-0023's whole thesis
 * is that a driver in a dead zone in Nakasongola must lose nothing. These
 * three are the exceptions, and each has the same shape of reason: **they are
 * statements about right now, and a delayed one is a lie.**
 *
 * - *Go on duty* queued for twenty minutes puts a driver into the dispatch
 *   pool after they have gone home.
 * - *Accept* queued at all is worse: an offer has a fifteen-second clock, so
 *   a queued accept arrives after the passenger has been collected by
 *   somebody else. The server refuses it (409 OFFER_NO_LONGER_OPEN), which is
 *   correct — but the driver's phone would have told them they had the job.
 * - *Decline* queued means the search does not move on, and the passenger
 *   waits out a full window for an answer that was given immediately.
 *
 * So all three need a connection and say so. The offline story here is not
 * queueing; it is that an offer whose clock ran out simply is not in the list
 * any more, and duty survives on the server whatever the handset does.
 */
export function useDuty() {
  const { api } = useAuth();

  return useQuery({
    queryKey: ['duty'],
    queryFn: () => fetchDuty(api),
    // `offlineFirst` like every other read: React Query's default pauses a
    // query when the device reports no connection, which on a handset that
    // flickers in and out of coverage means a driver cannot see whether they
    // are on duty. The last known answer is far better than a spinner.
    networkMode: 'offlineFirst',
    staleTime: 15_000,
    gcTime: 24 * 60 * 60 * 1000,
  });
}

export function useSetDuty() {
  const { api } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { onDuty: boolean; vehicleId?: number | null }) => setDuty(api, input),
    onSuccess: (presence: DriverPresence) => {
      // The server's answer replaces the cache rather than invalidating it.
      // Invalidating would leave the toggle showing its old position until a
      // refetch landed, which on a bad connection reads as the tap not having
      // registered — and a driver who taps twice has signed on and off again.
      queryClient.setQueryData(['duty'], presence);
      void queryClient.invalidateQueries({ queryKey: ['offers'] });
    },
  });
}

/**
 * The jobs in front of this driver.
 *
 * Polled far faster than the trip list, and only while on duty. The two
 * intervals answer different questions: a trip assigned by a dispatcher is
 * work for later today, while an offer is a countdown somebody is standing on
 * a kerb waiting out. See `OFFER_POLL_INTERVAL_MS`.
 *
 * `networkMode: 'online'`, unlike every other read in this app, and
 * deliberately: a cached offer is worse than no offer. It renders a countdown
 * from a stale `expires_in_seconds` and a button whose only outcome is a 409,
 * and the driver reaches for a job that was given away a minute ago.
 */
export function useOffers(enabled: boolean) {
  const { api } = useAuth();

  const query = useQuery({
    queryKey: ['offers'],
    queryFn: () => fetchOffers(api),
    enabled,
    refetchInterval: enabled ? OFFER_POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    networkMode: 'online',
    // Nothing is kept: an offer list is only ever true at the instant it was
    // fetched.
    staleTime: 0,
    gcTime: 0,
  });

  const offers: DispatchOffer[] = query.data ?? [];

  return { ...query, offers };
}

export function useAcceptOffer() {
  const { api } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<Trip, unknown, number>({
    mutationFn: (offerId: number) => acceptOffer(api, offerId),
    onSuccess: () => {
      // Both lists move: the offer is gone and a trip has appeared. Refetching
      // trips here is what puts the new job on the Today screen without the
      // driver waiting out the 60-second poll — which is a minute of a
      // passenger standing there while their driver's app shows nothing.
      void queryClient.invalidateQueries({ queryKey: ['offers'] });
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
    // A failed accept still refreshes the list, because the most likely
    // failure *is* the list being out of date — somebody else took it.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['offers'] });
    },
  });
}

export function useDeclineOffer() {
  const { api } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<void, unknown, { offerId: number; reason?: string }>({
    mutationFn: ({ offerId, reason }) => declineOffer(api, offerId, reason),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['offers'] });
    },
  });
}