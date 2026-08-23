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
   * to so far.
   *
   * **There is no `Today`.** It sat behind this one as a second assignment
   * list and answered the same question with the same components, reachable
   * only from a bell that now opens `Notifications` where it always looked
   * like it should. The route is deleted rather than kept unreachable, for the
   * reason the missing `Settings` on `ProfileStackParams` gives: a key left in
   * this table lets `navigate('Today')` typecheck against a screen that is not
   * registered, which fails on a handset and nowhere else.
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
   * The next drop-off, searched and added mid-run (ADR-0045 §4).
   *
   * Pushed from `TripInProgress` and returns there — a modal in spirit, like
   * `Odometer`: pick a destination or abandon the idea, no state worth
   * keeping in between. The search is the client's own place register (§10);
   * a walk-in trip gets the free-text row alone.
   */
  AddDropoff: { tripId: number };
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
   * "what have I done", where `TripsHome` answers "what now" and `TripDetail`
   * answers "what happened on this one".
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
   * Everything this phone has to allow before a job can reach it (ADR-0046,
   * ADR-0049).
   *
   * On the Profile stack because it is a fact about *this handset* rather than
   * about the work — the same reason `BankDetails` sits here. It replaces the
   * single "Show jobs over the lock screen" row that used to live inline on
   * `ProfileHome`: that row was one of six permissions the offer path depends
   * on, and being the only one with a door made it look like the only one that
   * could be wrong.
   */
  Permissions: undefined;
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
  /**
   * Where the office sends this driver's money (ADR-0042).
   *
   * On the Profile stack because that is where the mockup's row is, and
   * because it answers a question about the driver rather than about the work.
   * It is **not** a Wallet screen despite being about pay: the Wallet asks
   * "what am I owed", and this asks "where does it go" — the owner was
   * explicit that it is a real page rather than a link into the Wallet.
   */
  BankDetails: undefined;
  /**
   * How the driver is doing — six dials and the current bonus week
   * (ADR-0038).
   *
   * On the Profile stack rather than a tab of its own, and the mockup's own
   * tab bar agrees: it draws Profile as the active tab. It is also the right
   * home by what it answers. Home asks "what now", Earnings asks "what did I
   * make", Wallet asks "what am I owed" — this asks "how am I doing", which
   * is a question about the driver rather than about the work, and that is
   * what the Profile tab already holds.
   */
  Performance: undefined;
  /**
   * What the platform is currently offering — the weekly trip target still
   * open, tonight's peak window, and the referral code (ADR-0036, ADR-0037).
   *
   * On the Profile stack beside `Performance`, for the same reason and with
   * the same evidence: the mockup draws Profile as the active tab. The two are
   * neighbours rather than one screen because they answer opposite questions —
   * Performance is the record of how a driver has done, this is what is on
   * offer if they keep going.
   */
  Promotions: undefined;
  /**
   * What the office has told this driver (ADR-0039).
   *
   * On the Profile stack rather than as a drawer screen of its own, so it
   * keeps the tab bar like every other pushed screen in the app. The bell on
   * the home screen is **not** an entry point to it and does not count these —
   * that badge counts job offers, which have a fifteen-second clock. Two
   * different things, deliberately kept apart.
   */
  Notifications: undefined;
  /**
   * Writing a report to the office (ADR-0044).
   *
   * **The param is required and is one of the five Help Topics.** A driver
   * arrives here by tapping a row that already said what this is about, and a
   * screen that re-asked would be the app forgetting what it was just told.
   * Like `Support`, this file deliberately does not import `HelpTopicKey` — a
   * navigation param table that reaches into a feature module inverts the
   * dependency, and `findHelpTopic` treats an unrecognised key as no topic, so
   * a stale deep link degrades rather than crashes.
   */
  ReportIssue: { topic: string };
  /**
   * The reports this driver has sent, and the office's answers (ADR-0044).
   *
   * On the Profile stack beside `Notifications`, and for the same reason: it
   * is a pushed screen that keeps the tab bar, and it is the surface the
   * `driver.support.answered` notification is about.
   */
  MyReports: undefined;
  /**
   * Asking the office to close the account (ADR-0043).
   *
   * Named for what it does, not for the row that opens it. The row says
   * *Delete account* because that is the word a driver arrives with; this is a
   * closure request the office confirms, and a route called `DeleteAccount`
   * would be the first place the lie got written down.
   */
  CloseAccount: undefined;
  /*
   * **There is no `Settings`.** Its rows are grouped on `ProfileHome` under
   * *Work* and *Account* — the owner's *"so we don't need the settings page"*.
   * Deleted from the param list on purpose: leaving the key here would let
   * `navigate('Settings')` typecheck against a route that no longer exists,
   * which fails at runtime and nowhere else.
   */
  /** Getting help, and what to do when something goes wrong (ADR-0040). */
  Safety: undefined;
  /**
   * Reaching a person at the office.
   *
   * **The param is optional and must stay optional.** Three things route here
   * — the drawer, the Contact Support card on `Safety`, and the five Help
   * Topics rows — and only the last carries a topic. Without one the screen
   * renders exactly what it always did; with one it names the subject and lists
   * what the office will ask for.
   *
   * A `topic` is a `HelpTopicKey`, but this file deliberately does **not**
   * import that type: a navigation param table that reaches into a feature
   * module inverts the dependency, and `findHelpTopic` already treats an
   * unrecognised key as "no topic" so a stale deep link cannot crash the app.
   */
  Support: { topic?: string } | undefined;
};

/**
 * The drawer, which wraps everything above.
 *
 * **One screen.** Every destination the drawer lists lives inside one of the
 * four tab stacks, so the drawer holds the tab navigator and nothing else and
 * its content component navigates into the nesting. Registering the four new
 * screens as drawer screens instead would have taken the tab bar away from
 * exactly those four and made them the odd ones out.
 */
export type RootDrawerParams = {
  Main: undefined;
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
