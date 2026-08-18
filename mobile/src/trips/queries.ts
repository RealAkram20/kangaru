import { useQuery } from '@tanstack/react-query';

import {
  fetchAvailabilityRequests,
  fetchDriverStats,
  fetchTrip,
  fetchTripEvents,
  fetchTripRoute,
  fetchTrips,
} from '../api/endpoints';
import type { Coordinates, Trip } from '../api/types';
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

/**
 * The road ahead, refetched when the driver has actually moved (ADR-0031 §5).
 *
 * ## The query key is the cost control
 *
 * `here` is **snapped to roughly a hundred metres** before it enters the key,
 * which is what makes this deviation-driven rather than timer-driven. React
 * Query refetches when the key changes, so a driver sitting at a junction —
 * whose GPS jitters by a few metres a second — keeps one cached answer, and a
 * driver who has genuinely moved gets a new one.
 *
 * The arithmetic is why. At roughly $5 per 1,000 requests, a thirty-second
 * timer over a thirty-minute trip is sixty requests, about $0.30 a trip, and a
 * hundred trips a day is some $900 a month — for a route that does not change
 * while a driver waits at a light. The snap is the same precision the server
 * caches on, so the two agree about what "moved" means.
 *
 * `retry: false`: a route is decoration over a map that already works. Failing
 * three times to draw a line costs three billed requests and buys nothing, and
 * `null` is the answer the map is built for anyway.
 */
export function useTripRoute(tripId: number, here: Coordinates | null) {
  const { api } = useAuth();

  // Rounded *outside* the key so the value sent matches the value keyed on —
  // keying on a snapped pair and then sending the raw one would make the
  // client's cache and the server's disagree about which question was asked.
  const snapped =
    here === null
      ? null
      : { lat: Number(here.lat.toFixed(3)), lng: Number(here.lng.toFixed(3)) };

  return useQuery({
    queryKey: ['trips', tripId, 'route', snapped?.lat ?? null, snapped?.lng ?? null],
    queryFn: () => fetchTripRoute(api, tripId, snapped),
    networkMode: 'offlineFirst',
    // The road does not move; the traffic on it does, and the duration is the
    // half that goes stale. Matches the server's own TTL.
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
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

/**
 * The home screen's numbers.
 *
 * Refetched on the same rhythm as the trip list rather than polled: these
 * move when a trip finishes or an offer is answered, both of which already
 * invalidate their own caches.
 */
export function useDriverStats() {
  const { api } = useAuth();

  return useQuery({
    queryKey: ['driver-stats'],
    queryFn: () => fetchDriverStats(api),
    staleTime: 60_000,
  });
}
