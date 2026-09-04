import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

import {
  fullScreenIntentIsGrantable,
  openFullScreenIntentSettings,
  readFullScreenIntentGranted,
} from './fullScreenIntent';

/**
 * Asking a driver for the permission that puts a job on a locked screen
 * (ADR-0049 §2) — until they grant it.
 *
 * ## Why this exists at all
 *
 * `USE_FULL_SCREEN_INTENT` stopped being an install-time permission in Android
 * 14. It is now a *special app access*, and Google's April 2026 Play policy
 * grants it automatically only to alarm clocks and phone or video calling apps.
 * A dispatch app is neither, so on Android 14 and above **this app is installed
 * without it** and has to ask.
 *
 * The failure is invisible from inside the app, because **Android does not
 * refuse an ungranted full-screen intent, it silently downgrades it to a
 * heads-up notification**. Nothing throws. `displayNotification` resolves
 * exactly as it does on a granted handset. The driver simply never sees a job
 * take over a locked phone — they hear the ring, look, and find a banner to
 * tap, which is the report this file answers.
 *
 * ## Why at Go Online, and not at launch
 *
 * Because that is the moment the permission means something. A driver tapping
 * Go Online has just said *"send me work"*, so a sentence about how work will
 * reach them is an answer to a question they asked. The same sentence at first
 * launch — before they have signed in, been approved, or seen a job — is an
 * interruption about a thing that has not happened yet, and it gets dismissed.
 *
 * ## Why until granted, and why that used to be impossible
 *
 * The first version asked **once, ever**, because nothing in the stack could
 * read whether the permission had been granted — neither `expo-notifications`
 * nor `react-native-notify-kit` exposes `canUseFullScreenIntent()`. A driver
 * who said yes and one who said no were indistinguishable, so asking again
 * would have nagged every driver who had already granted it, every shift.
 * And a driver who tapped "Not now" once — or swiped the app away with the
 * question open — was never asked again, and had no way to learn why jobs
 * only ever arrived as a banner. That is exactly what happened.
 *
 * `modules/full-screen-intent` now reads the state, so the two are told
 * apart: **granted is never asked; not granted is asked at Go Online, at most
 * once a day.** The daily bound is the courtesy that keeps "Not now" meaning
 * something for a shift, without letting one tap silence the question for the
 * life of the install. Where the state still cannot be read — Expo Go, a build
 * without the module — it falls back to the old once-ever rule, for the old
 * reason.
 */

/** Last asked, as epoch milliseconds. An older install holds `'1'` here from the once-ever days. */
const ASKED_KEY = 'kangaruride.driver.lockScreenAsked';

/** A shift's worth of quiet after "Not now". */
export const ASK_AGAIN_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Whether to put the question in front of this driver now.
 *
 * Pure, and separated from the alert for the reason `jest.setup.ts` records:
 * the parts that can be *wrong* are worth testing, and a test of the real thing
 * would have to render a native dialog. What can be wrong here is asking a
 * driver who already holds the permission, asking one on Android 13 for a
 * permission they were born with, or asking twice in a shift.
 *
 * @param grantable   Android 14+, where there is something to ask for.
 * @param granted     The platform's answer, or `null` where it cannot be read.
 * @param lastAskedAt When this driver was last asked, or `null` if never.
 * @param now         The clock, injected so a test does not have to wait a day.
 */
export function shouldAskForLockScreen(
  grantable: boolean,
  granted: boolean | null,
  lastAskedAt: number | null,
  now: number,
): boolean {
  if (!grantable || granted === true) {
    return false;
  }

  // Unreadable: the old rule, for the old reason — we cannot tell a yes from
  // a no, so one ask is all that is safe.
  if (granted === null) {
    return lastAskedAt === null;
  }

  return lastAskedAt === null || now - lastAskedAt >= ASK_AGAIN_AFTER_MS;
}

/**
 * Asks, when `shouldAskForLockScreen` says to.
 *
 * Never throws and never blocks the caller: it is fired from the duty toggle,
 * which has a driver waiting on a switch. A storage read that fails is treated
 * as *already asked today* — the conservative direction, because the cost of
 * getting it wrong that way is a permission the driver can still grant from
 * Permissions, where getting it wrong the other way is a dialog on every tap.
 */
export async function askForLockScreen(): Promise<void> {
  try {
    if (!fullScreenIntentIsGrantable()) {
      return;
    }

    const raw = await AsyncStorage.getItem(ASKED_KEY);
    // The once-ever install stored `'1'`; `Number` reads it as "long ago",
    // which is the right migration — that driver was asked under a rule that
    // could not see they had said no, and this one can.
    const lastAskedAt = raw === null ? null : Number(raw) || 0;

    if (!shouldAskForLockScreen(true, readFullScreenIntentGranted(), lastAskedAt, Date.now())) {
      return;
    }

    // **Written before the dialog, not after.** A driver who swipes the app
    // away mid-question must not be asked again this shift, and there is no
    // callback for "the dialog went away without an answer".
    await AsyncStorage.setItem(ASKED_KEY, String(Date.now()));

    Alert.alert(
      'Let jobs reach you on a locked phone',
      // Says what they get and what it costs them, in that order, without
      // naming the Android permission — a driver does not need to know the
      // word `USE_FULL_SCREEN_INTENT` to make this decision.
      'Android needs your permission for a job to open on your screen like an incoming call. ' +
        'Without it a job still arrives and still rings, but only as a banner you have to notice and tap.\n\n' +
        'You can change this any time under Profile › Permissions.',
      [
        // Decline on the left, the way every answer in this app is laid out —
        // the destructive one does not sit under the thumb (`OfferScreen`).
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => void openFullScreenIntentSettings() },
      ],
      { cancelable: true },
    );
  } catch {
    // A storage failure, or an OEM without the dialog. The driver keeps the
    // ringing heads-up notification, which is the whole of the experience
    // minus the lock-screen takeover, and the Permissions row is still there.
  }
}

/** Test seam. Nothing in the app calls this. */
export async function forgetLockScreenPromptForTest(): Promise<void> {
  await AsyncStorage.removeItem(ASKED_KEY);
}
