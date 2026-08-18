import type { Trip } from '../api/types';
import { isInProgress } from './transitions';

/**
 * Orders a driver's trips for the Today screen: the trip in progress pinned,
 * then work that has not started, then everything finished.
 *
 * ## Why this is a proxy and not the real answer
 *
 * The brief asks for "soonest first". **The API cannot express that today.**
 * `TripResource` carries no scheduled pickup time — the schedule lives on
 * `Booking.scheduled_for`, the trip exposes only `booking_id`, and `/trips`
 * supports no `?include=booking`. `TripController::index` orders by
 * `created_at desc` and offers no sort parameter.
 *
 * So this sorts by `created_at` **ascending** within each group, on the
 * reasoning that a trip dispatched earlier is usually a trip due earlier. That
 * is a correlation, not the fact, and it breaks the moment a dispatcher
 * assigns tomorrow morning's booking before this afternoon's.
 *
 * The fix is a `scheduled_for` field on `TripResource` — additive, and so
 * permitted within v1 by AGENTS.md. It is raised in `mobile/README.md` rather
 * than papered over here, because a client that guesses at a schedule is worse
 * than one that admits it has none.
 */
export function orderTripsForToday(trips: Trip[]): Trip[] {
  return [...trips].sort((a, b) => {
    const groupDifference = group(a) - group(b);

    if (groupDifference !== 0) {
      return groupDifference;
    }

    return timestamp(a.created_at) - timestamp(b.created_at);
  });
}

const IN_PROGRESS = 0;
const UPCOMING = 1;
const FINISHED = 2;

function group(trip: Trip): number {
  if (isInProgress(trip.status)) {
    return IN_PROGRESS;
  }

  if (trip.status === 'assigned' || trip.status === 'accepted') {
    return UPCOMING;
  }

  return FINISHED;
}

/**
 * A trip with no `created_at` sorts last within its group rather than first.
 * `Date.parse` of null is NaN, and NaN in a comparator makes the whole sort
 * unstable — a list that reorders itself between renders for no reason the
 * driver can see.
 */
function timestamp(value: string | null): number {
  if (value === null) {
    return Number.MAX_SAFE_INTEGER;
  }

  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}
