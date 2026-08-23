/**
 * What this app needs a driver's permission for, and which of it is stopping
 * work from reaching them.
 *
 * ## Why this is a module and not logic inside the screen
 *
 * `jest.setup.ts` records the rule: the suites worth trusting in this app are
 * pure TypeScript over injected values. What can be *wrong* here is the
 * counting — and getting it wrong tells a driver whose phone is perfectly set
 * up that two things are broken, or tells a driver who is missing the one
 * permission that matters that everything is fine. Both are worse than no
 * screen. The component renders; this decides.
 *
 * ## The rule the whole screen is built around
 *
 * **Two of these six cannot be read, and the screen must never pretend
 * otherwise.** `fullScreenIntent.ts` already argues it for its own permission:
 * *"a 'Not granted' label we cannot verify would be wrong on every handset that
 * had already said yes"*. `NotificationManager.canUseFullScreenIntent()` is
 * exposed by neither `expo-notifications` nor `react-native-notify-kit`, and
 * the battery-optimisation exemption has no Expo API at all.
 *
 * So `unreadable` is a first-class state. It is rendered as an action rather
 * than a status, and — this is the part that matters — it is **never counted**
 * as missing. An unreadable permission is not a known problem.
 */

export type PermissionKey =
  /** Android 13+. Without it no push is delivered at all. */
  | 'notifications'
  /** The prerequisite for everything positional. */
  | 'locationWhenInUse'
  /** "All the time". What keeps the driver in the dispatch pool with the app closed. */
  | 'locationAlways'
  /** The exemption that stops an OEM battery manager killing the online service. */
  | 'battery'
  /** `USE_FULL_SCREEN_INTENT` — a job taking over a locked screen. */
  | 'lockScreen'
  /** Odometer photographs. Nothing to do with offers. */
  | 'camera';

export type PermissionStatus =
  | 'granted'
  | 'missing'
  /** The platform will not tell us. See the docblock — this is not "missing". */
  | 'unreadable'
  /**
   * Cannot be asked for yet, because something else has to be granted first.
   *
   * Android will not offer "all the time" until while-using is held, and a row
   * that opens a settings screen with no such option on it is an instruction
   * that makes the app look broken.
   */
  | 'blocked';

export type PermissionStates = Record<PermissionKey, PermissionStatus>;

/**
 * The permissions a job depends on, in the order they stop one arriving.
 *
 * Camera is deliberately absent: an odometer photograph is evidence for a trip
 * already accepted, and a driver who declined it still gets every job. Counting
 * it would put a red badge on a screen for something that costs nobody a fare.
 */
const OFFER_CRITICAL: readonly PermissionKey[] = [
  'notifications',
  'locationWhenInUse',
  'locationAlways',
];

/**
 * Whether "all the time" can be asked for at all yet.
 *
 * Android's own rule, not ours: background location is only offered once
 * while-using is held. Modelled explicitly because the alternative — a row that
 * sends a driver to a settings page where the option they were promised does
 * not exist — is the kind of dead end that teaches somebody the app is broken.
 */
export function backgroundLocationIsAskable(whenInUse: PermissionStatus): boolean {
  return whenInUse === 'granted';
}

/**
 * The permissions that are *known* to be stopping jobs reaching this driver.
 *
 * **Known** is doing the work. `unreadable` never appears here, and neither
 * does `blocked` — a driver who has not yet granted while-using has one
 * problem, not two, and listing the consequence beside the cause would have the
 * screen shout twice about a single tap.
 */
export function blockingJobs(states: PermissionStates): PermissionKey[] {
  return OFFER_CRITICAL.filter((key) => states[key] === 'missing');
}

/**
 * Two facts about *right now* that no permission covers.
 *
 * ## Why these are not permissions, and why they matter more than some
 *
 * A driver can grant all six permissions, switch on Battery Saver, go on duty,
 * and receive nothing — and a screen showing six green rows would be telling
 * them everything was fine. **Battery Saver is a different mechanism from
 * battery optimisation**: the exemption is per-app and is what the battery row
 * asks for; Battery Saver is a system-wide switch the driver flips themselves,
 * and it throttles background work whatever any app is exempted from.
 *
 * `onlineService` is the more valuable of the two, because it is the *outcome*
 * rather than a proxy for it. `Location.hasStartedLocationUpdatesAsync` reports
 * whether the foreground service `OnlineService` calls the keystone is actually
 * running — and that single boolean answers "will a job reach this phone"
 * better than any permission row can, since every one of them exists only to
 * keep it alive.
 */
export type Reliability = {
  batterySaver: 'on' | 'off' | 'unknown';
  /** `off_duty` is not a fault: nothing runs when nobody has gone online. */
  onlineService: 'running' | 'stopped' | 'off_duty' | 'unknown';
};

/**
 * The single most important thing wrong, or null when nothing is.
 *
 * **One sentence, not a list.** The screen this feeds is read at a glance from
 * a cradle, and three stacked warnings are three things to read before acting
 * on any of them. The order below is by how completely each one stops work, so
 * a driver fixes the thing that is actually costing them first.
 *
 * Null when everything is fine, deliberately: a screen that congratulates a
 * driver every time they open it spends their attention on the one state that
 * needs none, and a banner that is always there is one nobody reads on the day
 * it matters.
 */
export function whatIsWrong(states: PermissionStates, live: Reliability): string | null {
  // **Worst first: on duty, and the phone has stopped the service anyway.**
  // Every permission may be granted and this can still be true — an OEM
  // battery manager needs no permission to kill a process. It is also the only
  // state here that means jobs are being missed *at this moment*.
  if (live.onlineService === 'stopped') {
    return 'You are online, but this phone has stopped the app. Jobs will not reach you.';
  }

  if (live.batterySaver === 'on') {
    return 'Battery saver is on. Your phone may stop the app and jobs will not reach you.';
  }

  // Delegated rather than repeated. The sentence has one home, so the screen
  // and anything else that ever counts permissions cannot drift apart on the
  // wording — AGENTS.md's rule about a thing that appears twice.
  return blockingSummary(states);
}

/**
 * The line at the top of the screen, or null when there is nothing to say.
 *
 * Null rather than a cheerful "All good": a screen that congratulates a driver
 * every time they open it spends their attention on the one state that needs
 * none. Silence is the reward.
 *
 * The count is spelled out in words for one and figures above it, because
 * *"1 thing is stopping"* reads as a typo where *"One thing"* reads as a
 * sentence — and this line is read at a glance, from a cradle, in sunlight.
 */
export function blockingSummary(states: PermissionStates): string | null {
  const blocked = blockingJobs(states);

  if (blocked.length === 0) {
    return null;
  }

  return blocked.length === 1
    ? '1 permission below is stopping jobs reaching you.'
    : `${blocked.length} permissions below are stopping jobs reaching you.`;
}

/**
 * The word shown at the right of a row, or null when there is none to show.
 *
 * `unreadable` returns null on purpose — that row carries an action and no
 * claim about state. `blocked` says what it is waiting for rather than
 * "Missing", because the driver has nothing to fix on that row yet.
 */
export function statusLabel(status: PermissionStatus): string | null {
  switch (status) {
    case 'granted':
      return 'Allowed';
    case 'missing':
      return 'Not allowed';
    case 'blocked':
      return 'Needs the one above';
    case 'unreadable':
      return null;
  }
}

/**
 * How the row is coloured — but never *only* coloured.
 *
 * `docs/screen-rules.md` §6: meaning is never carried by colour alone, which is
 * why every tone here is paired with `statusLabel` above. In direct Kampala sun
 * on a cradle-mounted phone, the word is what survives.
 */
export function statusTone(status: PermissionStatus): 'good' | 'warning' | 'muted' {
  switch (status) {
    case 'granted':
      return 'good';
    case 'missing':
      return 'warning';
    case 'blocked':
    case 'unreadable':
      return 'muted';
  }
}
