import type { TripStatus } from '../api/types';

/**
 * Navigation shape.
 *
 * **Four tabs: Home, Earnings, Wallet, Profile.**
 *
 * This replaces the three the app shipped with — Work / Time off / Account —
 * and the change is deliberate rather than incidental, so the reasoning on
 * both sides is kept here.
 *
 * *The old argument*, which was right when it was written: "three tabs,
 * because a driver has three jobs: the work, their time off, and their
 * account. Deeper structure would be navigation for its own sake — this app
 * has six screens."
 *
 * *What changed*: the app no longer has six screens. Earnings, Wallet,
 * Transactions and Trips History are all real surfaces now, and the first two
 * were reachable only by tapping a card on Home — a driver checking what they
 * had made was going through a screen about what they were doing next. Three
 * separate mockups asked for this bar, and the Wallet and Earnings agents both
 * flagged it and left it alone because it reaches every screen in the app. The
 * owner has now taken it.
 *
 * **Time off is the cost, and it moves under Profile.** It is the one thing
 * that got quieter, and it is the right one to give up the slot: a driver
 * requests leave occasionally and checks their money daily.
 *
 * Each tab is its own stack rather than one shared one, so switching tabs does
 * not unwind where a driver was — coming back to Wallet from Home should still
 * be showing the statement they had opened.
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
   *
   * **`TripsHome`, not `Home`.** The tab that contains this stack is itself
   * named `Home` (`RootTabParams`), and React Navigation warns about screens
   * of the same name nested inside one another — "Home, Home > Home" — because
   * `navigate('Home')` from inside this stack is then ambiguous. The other
   * three tabs already name their roots `EarningsHome`, `WalletHome` and
   * `ProfileHome`; this one was the odd stack out.
   *
   * The tab keeps the name `Home`, so `getParent()?.navigate('Home')` from the
   * other tab roots is unchanged.
   */
  TripsHome: undefined;
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
  /**
   * The map, full screen. Where *Navigate* goes, so a driver checking the
   * route does not lose the app with a passenger in the car.
   */
  TripMap: { tripId: number };
  /**
   * Every job this driver has finished, newest first, grouped by day and
   * filtered by All / Rides / Deliveries.
   *
   * On the trips stack rather than a tab of its own, because it is *about the
   * work* — the mockup's own tab bar has no Trips tab either. It answers
   * "what have I done", where `Today` answers "what else is on today" and
   * `TripDetail` answers "what happened on this one".
   *
   * No `TripStatus` routes here: a history is the record of work that is
   * over. A row still opens through `tripDestination()`, so a trip that
   * somehow is not over lands on the screen that owns its status.
   */
  TripsHistory: undefined;
  TripDetail: { tripId: number };
  /**
   * The moment a trip ended: what it was worth, and where to go next.
   *
   * **Pushed by `Odometer` on the closing reading, never routed to from a
   * `TripStatus`.** `trip_completed` stays with `TripDetail`, which is the
   * record; this is the moment, and it is read once. Routing the status here
   * would congratulate a driver for opening last Tuesday's ride.
   */
  RideComplete: { tripId: number };
  Odometer: {
    tripId: number;
    /** The transition this reading accompanies. */
    to: Extract<TripStatus, 'trip_started' | 'trip_completed'>;
    from: TripStatus;
  };
};

/**
 * The Earnings tab.
 *
 * A stack of one, and deliberately so rather than mounting the screen on the
 * tab directly: every other tab is a stack, and a navigator that is uniform is
 * one where adding the next screen — a per-day breakdown, say — is a line
 * rather than a restructure. It also gives the screen a `navigation` object of
 * the same shape as its neighbours.
 */
export type EarningsStackParams = {
  EarningsHome: undefined;
};

/**
 * The Wallet tab: the balance and why it is what it is.
 *
 * `Transactions` is separate from `WalletHome` because the two answer
 * different questions — the wallet answers "what is my balance and why", and
 * this answers "what happened between these dates". It keeps its back arrow,
 * because unlike a tab root there genuinely is something behind it.
 */
export type WalletStackParams = {
  WalletHome: undefined;
  Transactions: undefined;
};

/**
 * The Profile tab — the account, and now time off as well.
 *
 * Time off moved here when the tab bar went to four. It is a pushed screen
 * rather than a modal, like the password form beside it: a modal says "finish
 * this or discard it", and a leave request is a thing a driver may reasonably
 * start, go and check with the office, and come back to.
 */
export type ProfileStackParams = {
  ProfileHome: undefined;
  TimeOff: undefined;
  ChangePassword: undefined;
  /**
   * The ADR-0033 agent's, added here so their `ProfileScreen` compiles against
   * this stack — their screen navigates to both and appeared in the tree while
   * the four-tab restructure was landing.
   *
   * **Neither is registered in `RootNavigator` yet**, because neither screen
   * exists: those are theirs to write and theirs to register. Declaring the
   * routes costs nothing and is the half of the seam that lives in this file.
   */
  Documents: undefined;
  SyncQueue: undefined;
};

/**
 * Kept as an alias because `AccountScreen` and `PasswordScreen` are typed
 * against it and neither is mine to rewrite. The route it names is now
 * `ProfileHome`; the shape is otherwise identical.
 */
export type AccountStackParams = ProfileStackParams;

export type RootTabParams = {
  Home: undefined;
  Earnings: undefined;
  Wallet: undefined;
  Profile: undefined;
};
