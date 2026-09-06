import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  fetchAvailabilityRequests,
  fetchDriverStats,
  fetchPlaceSuggestions,
  fetchTrip,
  fetchTripEvents,
  fetchTripRoute,
  fetchTrips,
  fetchTripStopCandidates,
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

  // Memoized on the query's own data, which React Query keeps referentially
  // stable between fetches. Unmemoized, this sorted on every render *and*
  // handed every caller a fresh array identity — so `HomeScreen`'s
  // `useMemo([trips])` over the completed list could never hit its cache,
  // and each render re-ran two sorts with `Date.parse` in the comparator.
  const trips: Trip[] = useMemo(() => orderTripsForToday(query.data?.trips ?? []), [query.data]);

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

/**
 * The add-a-drop-off search (ADR-0045 §10) — the client's own place register,
 * filtered as the driver types.
 *
 * **`networkMode` is the default here, not `offlineFirst`.** Every other
 * query in this file serves a cached answer in a dead zone because a stale
 * trip is better than a spinner; a stale *search result* is a destination
 * the driver did not search for. Offline, the screen's free-text row is the
 * honest path, and this query simply pauses.
 *
 * **The empty query is asked, not withheld, and that is the primary flow.**
 * The bank case is five ATMs served one at a time by one driver: opening the
 * screen and seeing that estate is one tap, where making them type first is a
 * keyboard in a cradle for a list of twelve rows the server was going to send
 * whole anyway. The endpoint caps at twelve with or without `q`, so this is
 * one request on open rather than a page — and §10's bound is unchanged,
 * because it is the same register the same driver may already read.
 *
 * `enabled` is the caller's to withhold: `AddDropoffScreen` passes an empty
 * string for a walk-in trip, which has no register and would be a guaranteed
 * empty answer.
 */
export function useTripStopCandidates(tripId: number, query: string, enabled = true) {
  const { api } = useAuth();
  const trimmed = query.trim();

  return useQuery({
    queryKey: ['trips', tripId, 'stop-candidates', trimmed],
    queryFn: () => fetchTripStopCandidates(api, tripId, trimmed),
    enabled,
    // A register edited at a desk, read at a kerb: a minute of staleness is
    // fine, refetching per keystroke against one URL is not.
    staleTime: 60_000,
    retry: 1,
  });
}

/**
 * Geocoder suggestions under the same search box (the §10 follow-up, owner
 * decision 2026-08-22) — for the site nobody has pinned, typed by a
 * technician mid-circuit.
 *
 * ## The debounce lives here, because the web already decided its shape
 *
 * `usePlaceSearch` on the console settled the behaviour of place search
 * against a public geocoder: 300ms after the last keystroke, three characters
 * minimum, and only what the user actually typed. The keystroke-keyed query
 * below would otherwise fire per character — fine against the register's one
 * URL, rude against a free public service — so the key is the *settled* text,
 * not the live one.
 *
 * `retry: false` where the register above retries once: a suggestion that
 * needs a second attempt has already lost to the free-text row sitting under
 * it, and the server is itself a fail-soft proxy that answers `[]` on a
 * geocoder outage.
 */
export function usePlaceSuggestions(tripId: number, query: string) {
  const { api } = useAuth();
  const trimmed = query.trim();
  const [settled, setSettled] = useState(trimmed);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(trimmed), 300);

    return () => clearTimeout(timer);
  }, [trimmed]);

  return useQuery({
    queryKey: ['trips', tripId, 'place-suggestions', settled],
    queryFn: () => fetchPlaceSuggestions(api, tripId, settled),
    // The server 422s under three characters; two matches most of Kampala
    // and costs a geocoder call to say so (the console's own floor).
    enabled: settled.length >= 3,
    // Mirrors the server's own cache window on the same query.
    staleTime: 60_000,
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
