import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Asking for everything once, at the start, instead of one refusal at a time.
 *
 * ## Why up front, when the usual advice is "ask in context"
 *
 * Because the context arrives too late to be useful here. The moment a job
 * offer needs a notification permission is the moment a passenger is already
 * waiting and a forty-five-second clock is running — a permission dialog then
 * costs the driver the job it was asking to deliver. The same is true of
 * background location: the first time it matters is the first time the phone is
 * in a pocket, which is exactly when nobody is looking at the screen.
 *
 * So the owner's call is to ask on the first launch, while the driver is
 * sitting still and has just decided to work here. Every dialog is one Android
 * will only ever show once, so this is the single chance to get them.
 *
 * ## Why order matters, and is not arbitrary
 *
 * `locationAlways` is last of the runtime asks because **Android will not offer
 * "all the time" until while-using is held** — asked first it is refused
 * silently, and the one chance is spent on a dialog that could not have
 * succeeded. Notifications lead because that is the permission a job actually
 * arrives on.
 *
 * The two settings-screen permissions are deliberately **not** in this
 * sequence. They leave the app entirely, and a first launch that throws a
 * driver into Android's battery list before they have seen a single screen is
 * how an app gets uninstalled. Those stay on the Permissions screen, and the
 * lock-screen one is asked at the first Go Online, where it means something.
 */

const DONE_KEY = 'kangaruride.driver.permissionsAsked';

/**
 * The runtime permissions asked on first launch, in the order they are asked.
 *
 * Exported so the sequence itself is testable — the ordering rule above is the
 * part that can be wrong, and it fails silently when it is.
 */
export const FIRST_RUN_ORDER = ['notifications', 'locationWhenInUse', 'locationAlways', 'camera'] as const;

export type FirstRunPermission = (typeof FIRST_RUN_ORDER)[number];

/**
 * Whether the ask should happen at all.
 *
 * False once it has run, ever. Android shows each of these dialogs once and
 * remembers the answer; re-running the sequence would call four APIs that all
 * resolve instantly denied and show the driver nothing — a startup cost that
 * buys nothing. The Permissions screen is where a driver goes afterwards.
 */
export async function shouldAskOnFirstRun(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(DONE_KEY)) === null;
  } catch {
    // Unreadable storage is treated as "already asked", the quiet direction.
    // The cost is a driver who grants from the Permissions screen instead; the
    // opposite default would re-run this on every launch forever.
    return false;
  }
}

export async function rememberAskedOnFirstRun(): Promise<void> {
  try {
    await AsyncStorage.setItem(DONE_KEY, '1');
  } catch {
    // Losing this costs one repeat of a sequence that is nearly free the second
    // time — every dialog is already answered, so nothing is shown.
  }
}

/** Test seam. Nothing in the app calls this. */
export async function forgetFirstRunForTest(): Promise<void> {
  await AsyncStorage.removeItem(DONE_KEY);
}

/**
 * Runs the asks in order, stopping nothing on a refusal.
 *
 * **A refusal is not an error and must not end the sequence.** A driver who
 * says no to the camera still needs to be asked about location; treating the
 * first no as fatal would leave the rest unasked and unaskable, since Android
 * only offers each dialog once.
 *
 * `ask` is injected so the ordering rule can be tested without four native
 * modules behind it — the same reason `presence.ts` and `ringtone.ts` take
 * ports.
 */
export async function askFirstRunPermissions(
  ask: (permission: FirstRunPermission) => Promise<boolean>,
): Promise<Record<FirstRunPermission, boolean>> {
  const granted = {} as Record<FirstRunPermission, boolean>;

  for (const permission of FIRST_RUN_ORDER) {
    // **Sequential, never `Promise.all`.** Android shows one permission dialog
    // at a time and drops the rest; asked in parallel, three of these four are
    // silently refused without the driver ever seeing them. It also enforces
    // the ordering rule above, which parallel asks cannot.
    try {
      granted[permission] = await ask(permission);
    } catch {
      granted[permission] = false;
    }

    // "All the time" is only offered once while-using is held. Asking anyway
    // spends the one dialog Android will show on a refusal it had already
    // decided — so it is skipped, and the Permissions screen carries it
    // instead, where the driver can grant the prerequisite first.
    if (permission === 'locationWhenInUse' && !granted[permission]) {
      granted.locationAlways = false;

      break;
    }
  }

  // Camera is asked after the location pair, so a break above leaves it unset.
  // Recorded as not-granted rather than absent, so the caller's record is the
  // same shape however the sequence ended.
  for (const permission of FIRST_RUN_ORDER) {
    granted[permission] ??= false;
  }

  return granted;
}
