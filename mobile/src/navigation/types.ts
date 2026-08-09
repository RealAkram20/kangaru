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
  Today: undefined;
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
