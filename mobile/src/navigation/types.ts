import type { TripStatus } from '../api/types';

/**
 * Navigation shape.
 *
 * Three tabs, because a driver has three jobs: the work, their time off, and
 * their account. Deeper structure would be navigation for its own sake — this
 * app has six screens.
 *
 * Odometer capture is a **modal on the trips stack**, not a tab and not a step
 * inside the detail screen. It is a form that must be completed or abandoned
 * as a unit: half an odometer reading is not a state worth persisting, and a
 * driver who backs out of it should find the trip exactly as they left it.
 */
export type TripsStackParams = {
  /**
   * The landing screen: duty, the trip in progress, and what today has come
   * to so far. `Today` sits behind it as the full assignment list — home
   * answers "what now?", the list answers "what else?".
   */
  Home: undefined;
  Today: undefined;
  /**
   * The drive to the passenger, for a trip in the pickup phase.
   *
   * A separate screen from `TripDetail` rather than a mode of it, because the
   * two answer different questions. `TripDetail` is the record — odometer,
   * timeline, every transition the lifecycle allows — and is read at a
   * standstill. This is the live leg: a map, a phone number and one button,
   * read at a glance from a cradle. Folding them together would have given
   * the busiest moment in the app the layout of an audit trail.
   */
  Pickup: { tripId: number };
  /**
   * The wait at the kerb, for a trip at `driver_arrived`.
   *
   * Where `Pickup` hands off. The two are separate screens because the
   * questions are: `Pickup` answers "where is it and how far", this answers
   * "how long have I been here". `docs/agent-worklog.md` holds the one map of
   * trip status to screen, and `isWaitingForPassenger` implements this row.
   */
  WaitingForPassenger: { tripId: number };
  /**
   * The journey itself, once the passenger is aboard.
   *
   * Separate from `TripDetail` for the same reason `Pickup` is: this is read
   * at speed from a cradle and answers "how far still, and how long so far",
   * while `TripDetail` is the record and is read at a standstill.
   */
  TripInProgress: { tripId: number };
  TripDetail: { tripId: number };
  Odometer: {
    tripId: number;
    /** The transition this reading accompanies. */
    to: Extract<TripStatus, 'trip_started' | 'trip_completed'>;
    from: TripStatus;
  };
};

/**
 * The Account tab is a stack so the password form can be pushed onto it. A
 * pushed screen rather than a modal, unlike odometer capture: a modal says
 * "finish this or discard it", and changing a password is a thing a driver may
 * reasonably start, go and check with the office, and come back to.
 */
export type AccountStackParams = {
  AccountHome: undefined;
  ChangePassword: undefined;
};

export type RootTabParams = {
  Work: undefined;
  TimeOff: undefined;
  Account: undefined;
};
