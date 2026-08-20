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
 * ## Failing is cheap; staying failed is not
 *
 * This used to be `retry: false`, on the argument that a route is decoration
 * over a map that already works and three billed attempts buy nothing. Half of
 * that still holds — but the other half was a trap, found on the owner's
 * handset while the API happened to be down.
 *
 * **`WaitingForPassengerScreen` asks with no position on purpose**: the driver
 * is standing at the pickup, so the server routes from it. That makes the
 * query key *constant for the life of the screen*. One failed attempt, and
 * there is nothing left to change the key, nothing to retry, and no reconnect
 * event either — the phone never lost signal, only the office went away. The
 * map stayed on its dashed line until the screen was remounted, **however long
 * the API had been back**.
 *
 * So: one retry for a blip, and a poll that exists **only while the last
 * attempt failed**. `refetchInterval` is a function precisely so it can return
 * `false` in the ordinary case — a route that succeeded is never re-asked on a
 * timer, which is the whole cost argument above, intact. A route that failed
 * costs two requests a minute on one screen a driver is actively looking at,
 * and heals itself the moment the office answers.
 */
/**
 * How often a *failed* route is asked for again.
 *
 * Thirty seconds, matched against the thing being waited for: an office coming
 * back, a mast returning, a rate-limited routing server letting go. Faster
 * would bill for impatience; slower would leave a driver looking at a dashed
 * line long after the road was available.
 */
const ROUTE_RETRY_MS = 30_000;

export function useTripRoute(
  tripId: number,
  here: Coordinates | null,
  to: 'pickup' | 'dropoff' = 'dropoff',
  /**
   * Whether the leg above is known yet.
   *
   * `TripMapScreen` picks its leg off the trip's status, so on a cold open —
   * no cached trip — the leg is not decided at the moment this hook first
   * runs. Firing anyway would ask for the approach, then ask again for the
   * fare a tick later: two billed requests, one of which was a guess. So the
   * caller withholds the question until it knows which one it is asking.
   */
  enabled = true,
) {
  const { api } = useAuth();

  // Rounded *outside* the key so the value sent matches the value keyed on —
  // keying on a snapped pair and then sending the raw one would make the
  // client's cache and the server's disagree about which question was asked.
  const snapped =
    here === null
      ? null
      : { lat: Number(here.lat.toFixed(3)), lng: Number(here.lng.toFixed(3)) };

  return useQuery({
    queryKey: ['trips', tripId, 'route', to, snapped?.lat ?? null, snapped?.lng ?? null],
    queryFn: () => fetchTripRoute(api, tripId, snapped, to),
    enabled,
    networkMode: 'offlineFirst',
    // The road does not move; the traffic on it does, and the duration is the
    // half that goes stale. Matches the server's own TTL.
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    // One, not three. A blip deserves a second try; a route the server cannot
    // draw deserves the dashed line the map is built for.
    retry: 1,
    // Only while the last attempt failed — see the docblock. A succeeded route
    // returns `false` here and is never polled.
    refetchInterval: (query) => (query.state.status === 'error' ? ROUTE_RETRY_MS : false),
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
