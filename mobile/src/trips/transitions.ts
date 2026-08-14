import type { Trip, TripStatus } from '../api/types';

/**
 * What the driver may be asked for alongside a transition.
 *
 * Read off `Modules\Trips\Requests\TransitionTripRequest`, which is a
 * *validation* fact and not part of the lifecycle graph. Getting it wrong
 * costs a 422 the driver cannot act on, so the app asks first.
 */
export type TransitionRequirement = 'odometer_start' | 'odometer_end' | 'notes' | null;

export type TripAction = {
  to: TripStatus;
  label: string;
  tone: 'primary' | 'neutral' | 'danger';
  requires: TransitionRequirement;
};

/**
 * Statuses this app offers a driver.
 *
 * **This is not the transition graph and must never become one.** The graph
 * lives on the server and arrives per-trip in `allowed_transitions`; nothing
 * here says which state follows which, and adding an edge to the lifecycle
 * shows up in this app with no change to this file.
 *
 * What this *is* is a mirror of `TripPolicy::DRIVER_JOURNEY_STATES`, and it
 * exists because `allowed_transitions` answers a different question from the
 * one a button needs. `TripResource` says so in as many words: *"This is what
 * is legal from this state, not what this user may do."* From `assigned` the
 * server legally allows `cancelled`, and a driver posting it gets 403 —
 * cancelling is dispatch's act. Rendering the field verbatim would put a
 * button on the screen whose only outcome is a refusal.
 *
 * A flat list of statuses is a far weaker thing to duplicate than a graph: it
 * has no edges to drift, and the server remains the authority — a 403 is
 * handled like any other refusal rather than being assumed impossible. The
 * clean fix is a server-side `allowed_transitions_for_me`; that is raised in
 * `mobile/README.md` under "Raised with the backend", not worked around here.
 */
export const DRIVER_ACTIONABLE_STATUSES: readonly TripStatus[] = [
  'accepted',
  'rejected',
  'driver_en_route',
  'driver_arrived',
  'passenger_onboard',
  'trip_started',
  'waiting',
  'trip_resumed',
  'trip_completed',
];

const ACTION_LABELS: Record<string, string> = {
  accepted: 'Accept trip',
  rejected: 'Decline trip',
  driver_en_route: 'On my way',
  driver_arrived: "I've arrived",
  passenger_onboard: 'Passenger on board',
  trip_started: 'Start trip',
  waiting: 'Start waiting',
  trip_resumed: 'Resume trip',
  trip_completed: 'Complete trip',
};

const ACTION_TONES: Record<string, TripAction['tone']> = {
  rejected: 'danger',
  waiting: 'neutral',
};

const ACTION_REQUIREMENTS: Record<string, TransitionRequirement> = {
  trip_started: 'odometer_start',
  trip_completed: 'odometer_end',
  rejected: 'notes',
};

/**
 * The buttons to render for a trip, in the order the server listed them.
 *
 * Server order is kept deliberately rather than re-sorted: `TripStatus::
 * allowedTransitions()` lists the expected path first on every state that has
 * a choice (accept before decline, waiting before completion), so the server's
 * ordering already carries an opinion and second-guessing it here would be one
 * more thing to drift.
 */
export function driverActions(trip: Trip): TripAction[] {
  return trip.allowed_transitions
    .filter((to) => DRIVER_ACTIONABLE_STATUSES.includes(to))
    .map((to) => ({
      to,
      label: ACTION_LABELS[to] ?? humanise(to),
      tone: ACTION_TONES[to] ?? 'primary',
      requires: ACTION_REQUIREMENTS[to] ?? null,
    }));
}

/**
 * A trip the driver is currently working. Pinned to the top of the list and
 * shown as the app's headline.
 */
export function isInProgress(status: TripStatus): boolean {
  return (
    status === 'driver_en_route' ||
    status === 'driver_arrived' ||
    status === 'passenger_onboard' ||
    status === 'trip_started' ||
    status === 'waiting' ||
    status === 'trip_resumed'
  );
}

/**
 * Whether the driver is still *driving to* the passenger.
 *
 * The window `PickupScreen` owns: the job is theirs, and they have not got
 * there yet. **It ends at `driver_en_route`, not at `driver_arrived`** — see
 * `isWaitingForPassenger` below, and `docs/agent-worklog.md`, which holds the
 * one map of status to screen. The driver's own "I've arrived" press is the
 * handoff between the two.
 *
 * `accepted` is included and `assigned` is not. An `assigned` trip is one the
 * driver has not answered — the decision surface for that is `OfferScreen`,
 * and sending them to a pickup map for a job they have not taken would be the
 * app assuming an answer.
 *
 * Deliberately **not** derived from `isInProgress`: that one exists to decide
 * what to pin to the top of `HomeScreen`, and it starts at `driver_en_route`.
 * Two questions, two predicates — collapsing them would mean one of the two
 * screens quietly changing the day the other's rule did.
 */
export function isPickupPhase(status: TripStatus): boolean {
  return status === 'accepted' || status === 'driver_en_route';
}

/**
 * Whether the driver is at the kerb, waiting for the passenger to appear.
 *
 * One status, and it is `WaitingForPassengerScreen`'s. Kept beside
 * `isPickupPhase` rather than inlined at the call site because the pair is
 * the seam between two screens: read together, it is obvious that the drive
 * ends exactly where the wait begins, and that no status belongs to both.
 *
 * **Not to be confused with `TripStatus.waiting`**, which is a billable
 * in-trip pause after `trip_started` — a different thing at a different point
 * in the journey, and the reason this predicate is named for the passenger
 * rather than for the waiting.
 */
export function isWaitingForPassenger(status: TripStatus): boolean {
  return status === 'driver_arrived';
}

/**
 * Whether the passenger is in the car and the journey is running.
 *
 * The third and last of the live-leg predicates, kept beside the other two so
 * the whole split reads in one place: the drive to the passenger, the wait at
 * the kerb, then the ride. `docs/agent-worklog.md` holds the same map as a
 * table, and no status appears in more than one of the three.
 *
 * **`passenger_onboard` is deliberately absent.** It is the gap between the
 * doors closing and the odometer being read, and `OdometerScreen` owns it —
 * "Start Trip" on the waiting screen queues that transition and pushes
 * straight to the reading, which posts `trip_started` on its way out. Adding
 * it here would put a screen in front of the form a driver is mid-way
 * through.
 *
 * **`waiting` here is not the kerb.** `TripStatus.waiting` is a billable pause
 * *during* a journey — a passenger who asks the driver to hold outside a shop
 * — and `WaitingTimeCalculator` charges for it. The wait for somebody to come
 * out and get in is `driver_arrived`, above, and is charged for by nothing.
 * The two are one word and two different facts.
 */
export function isTripInProgress(status: TripStatus): boolean {
  return status === 'trip_started' || status === 'waiting' || status === 'trip_resumed';
}

/**
 * Whether the driver is on this trip *right now*.
 *
 * The union of the three live-leg predicates plus `passenger_onboard`, which
 * belongs to the odometer — in other words, every status that has a screen of
 * its own. It answers "what am I doing", where `isInProgress` answers "what is
 * moving", and the two differ by exactly one status that matters.
 *
 * **`accepted` is here and is not in `isInProgress`, and that gap was a bug.**
 * A driver accepted an offer, the trip landed in `accepted`, and `HomeScreen`
 * — which picked its active trip with `isInProgress` — showed nothing at all.
 * The passenger was waiting; the app looked idle. Found on a handset, by
 * accepting a real offer.
 *
 * `isInProgress` is deliberately *not* widened to fix it. `ordering.ts` groups
 * `assigned` and `accepted` as **upcoming** rather than in progress, and it is
 * right to: a corporate trip accepted for four o'clock is not something the
 * driver is doing at ten. Two questions, two predicates — the same reasoning
 * `isPickupPhase` gives for not deriving itself from `isInProgress`.
 */
export function isLiveLeg(status: TripStatus): boolean {
  return (
    isPickupPhase(status) ||
    isWaitingForPassenger(status) ||
    status === 'passenger_onboard' ||
    isTripInProgress(status)
  );
}

/** Where `HomeScreen`'s active-trip card sends a driver, by status. */
export type ActiveTripRoute =
  | 'Pickup'
  | 'WaitingForPassenger'
  | 'Odometer'
  | 'TripInProgress'
  | 'TripDetail';

/**
 * The one function that decides which screen a live trip opens on.
 *
 * Extracted from `HomeScreen` so the decision can be tested — the branching
 * lived inside a component with no component test, which is exactly where the
 * gap below survived unnoticed.
 *
 * **`passenger_onboard` goes to the odometer, and that is the bug this fixes.**
 * It fell through every predicate and landed on `TripDetail` — a record view,
 * read at a standstill — when the only legal move from that state is
 * `trip_started`, and the only thing standing between the driver and it is the
 * opening reading. A driver who backs out of the odometer modal (or whose app
 * is killed mid-capture) taps the active card again and is put back exactly
 * where they left off, rather than on a page that reads like an audit trail
 * with one button on it. Found on a real handset.
 *
 * `TripDetail` stays the answer for everything else, which is every status
 * this app has no live screen for — and it is still reachable for all of them
 * through Today's list.
 */
export function activeTripRoute(status: TripStatus): ActiveTripRoute {
  if (isPickupPhase(status)) {
    return 'Pickup';
  }

  if (isWaitingForPassenger(status)) {
    return 'WaitingForPassenger';
  }

  if (status === 'passenger_onboard') {
    return 'Odometer';
  }

  if (isTripInProgress(status)) {
    return 'TripInProgress';
  }

  return 'TripDetail';
}

/**
 * Whether GPS should be streaming for a trip in this status.
 *
 * Bounded at `trip_started`, not at `driver_en_route`, and the narrower window
 * is the point. `RouteDistanceCalculator` sums **every** ping on a trip with no
 * time window, and `TripStateMachine::reconcileAgainstGps` compares that total
 * against `odometer_end - odometer_start` — a figure that by definition
 * excludes the drive to the pickup. Streaming while en route would add
 * kilometres to one side of a comparison and not the other, and flag a
 * variance on trips where the driver did nothing wrong.
 *
 * That matters beyond a stray boolean: PROJECT.md commits to reviewing
 * variance flags within two business days, and a flag that fires on every
 * trip with a long pickup leg is a flag that gets ignored.
 *
 * `waiting` keeps streaming. A stationary vehicle still proves it was
 * stationary, and the calculator already drops sub-noise-floor segments so
 * the jitter costs no billed distance.
 */
export function shouldStreamGps(status: TripStatus): boolean {
  return status === 'trip_started' || status === 'waiting' || status === 'trip_resumed';
}

/**
 * Which trip, if any, GPS should be streaming for.
 *
 * Derived from the whole list rather than from whichever screen happens to be
 * open. A driver who force-quits mid-trip and reopens the app on the Time-off
 * tab must still be recording their route — a trip that ends with
 * `gps_distance_km` null is a trip whose odometer reading has nothing to be
 * reconciled against, which is half of what the anchor client is buying.
 *
 * `TripAssignmentGuard`'s pessimistic locks mean a driver should never hold
 * two live trips at once, but this picks the most recently started rather than
 * asserting that. If the invariant ever breaks, recording the wrong route is a
 * worse outcome than recording the newer one, and a crash here would be worse
 * than both.
 */
export function streamingTripId(trips: Trip[]): number | null {
  const live = trips.filter((trip) => shouldStreamGps(trip.status));

  if (live.length === 0) {
    return null;
  }

  const newest = live.reduce((latest, candidate) =>
    startedAt(candidate) >= startedAt(latest) ? candidate : latest,
  );

  return newest.id;
}

function startedAt(trip: Trip): number {
  const parsed = trip.started_at === null ? NaN : Date.parse(trip.started_at);

  return Number.isNaN(parsed) ? 0 : parsed;
}

const STATUS_LABELS: Record<TripStatus, string> = {
  assigned: 'Assigned to you',
  rejected: 'Declined',
  accepted: 'Accepted',
  driver_en_route: 'On the way',
  driver_arrived: 'Arrived at pickup',
  no_show: 'No show',
  passenger_onboard: 'Passenger on board',
  trip_started: 'Trip in progress',
  waiting: 'Waiting',
  trip_resumed: 'Trip in progress',
  trip_completed: 'Completed',
  invoice_generated: 'Invoiced',
  disputed: 'Disputed',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export function statusLabel(status: TripStatus): string {
  return STATUS_LABELS[status] ?? humanise(status);
}

function humanise(status: string): string {
  const spaced = status.replace(/_/g, ' ');

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
