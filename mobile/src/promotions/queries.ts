import { useQuery } from '@tanstack/react-query';

import { fetchDriverPromotions } from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';

/**
 * What the platform is currently offering this driver (ADR-0036, ADR-0037).
 *
 * `offlineFirst` like every other read in this app: React Query's default
 * pauses a query when the device reports no connection, which on a handset
 * that flickers in and out of coverage means a blank screen where the last
 * known answer would do. A driver checking their weekly progress in a car park
 * is better served by this morning's figure than by a spinner.
 *
 * **Not polled**, and the staleness is deliberately long. Two of the three
 * cards change on a timescale of days — a referral qualifies when somebody
 * else finishes their tenth trip, and the peak window is a setting — and the
 * third moves only when this driver completes a trip, which already flushes
 * the outbox and invalidates this key. A timer here would spend battery
 * re-asking a question whose answer almost never changes on its own.
 */
export function useDriverPromotions() {
  const { api } = useAuth();

  return useQuery({
    queryKey: ['driver-promotions'],
    queryFn: () => fetchDriverPromotions(api),
    networkMode: 'offlineFirst',
    staleTime: 5 * 60_000,
    gcTime: 24 * 60 * 60 * 1000,
  });
}
