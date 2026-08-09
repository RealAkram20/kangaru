import { useQuery } from '@tanstack/react-query';

import { fetchAvailabilityRequests, fetchTrip, fetchTripEvents, fetchTrips } from '../api/endpoints';
import type { Trip } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { TRIP_POLL_INTERVAL_MS } from '../config';
import { orderTripsForToday } from './ordering';

/**
 * Reads.
 *
 * Writes do not live here: every mutation goes through the outbox
 * (`useSync().queueTransition`), because a mutation that only exists while the
 * app is running is a mutation that is lost in a dead zone.
 *
 * Everything is `offlineFirst`: React Query's default pauses a query when the
 * device reports no connection, which on a handset that flickers in and out of
 * coverage means a blank screen. Serving the last known answer and revalidating
 * is the behaviour a driver needs — and the persisted cache means it survives
 * a restart too.
 */
export function useTrips() {
  const { api } = useAuth();

  const query = useQuery({
    queryKey: ['trips'],
    queryFn: () => fetchTrips(api),
    // No push notifications in Phase 1, so this poll is the only way a new
    // assignment reaches the device. See `TRIP_POLL_INTERVAL_MS` for the
    // battery reasoning behind the number.
    refetchInterval: TRIP_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    networkMode: 'offlineFirst',
    // A day-old list is still worth showing while the fresh one loads. It is
    // the difference between a driver seeing their morning's work in a dead
    // zone and seeing a spinner.
    staleTime: 30_000,
    gcTime: 24 * 60 * 60 * 1000,
  });

  const trips: Trip[] = orderTripsForToday(query.data?.trips ?? []);

  return { ...query, trips };
}

export function useTrip(tripId: number) {
  const { api } = useAuth();

  return useQuery({
    queryKey: ['trips', tripId],
    queryFn: () => fetchTrip(api, tripId),
    networkMode: 'offlineFirst',
    staleTime: 15_000,
    gcTime: 24 * 60 * 60 * 1000,
  });
}

export function useTripEvents(tripId: number) {
  const { api } = useAuth();

  return useQuery({
    queryKey: ['trips', tripId, 'events'],
    queryFn: () => fetchTripEvents(api, tripId),
    networkMode: 'offlineFirst',
    gcTime: 24 * 60 * 60 * 1000,
  });
}

export function useAvailabilityRequests() {
  const { api } = useAuth();

  return useQuery({
    queryKey: ['availability'],
    queryFn: () => fetchAvailabilityRequests(api),
    networkMode: 'offlineFirst',
    gcTime: 24 * 60 * 60 * 1000,
  });
}
