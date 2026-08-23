import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

import { fullScreenIntentIsGrantable, openFullScreenIntentSettings } from './fullScreenIntent';

/**
 * Asking a driver, once, for the permission that puts a job on a locked screen
 * (ADR-0049 §2).
 *
 * ## Why this exists at all
 *
 * `USE_FULL_SCREEN_INTENT` stopped being an install-time permission in Android
 * 14. It is now a *special app access*, and Google's April 2026 Play policy
 * grants it automatically only to alarm clocks and phone or video calling apps.
 * A dispatch app is neither, so on Android 14 and above **this app is installed
 * without it** and has to ask.
 *
 * Until now the only way to grant it was a row in Profile that a driver had to
 * go looking for. Nothing pointed at it, so in practice nobody found it — and
 * the failure is invisible from inside the app, because **Android does not
 * refuse an ungranted full-screen intent, it silently downgrades it to a
 * heads-up notification**. Nothing throws. `displayNotification` resolves
 * exactly as it does on a granted handset. The driver simply never sees a job
 * take over a locked phone and has no way to know why.
 *
 * ## Why at Go Online, and not at launch
 *
 * Because that is the moment the permission means something. A driver tapping
 * Go Online has just said *"send me work"*, so a sentence about how work will
 * reach them is an answer to a question they asked. The same sentence at first
 * launch — before they have signed in, been approved, or seen a job — is an
 * interruption about a thing that has not happened yet, and it gets dismissed.
 *
 * ## Why once, ever, and why that is a limitation rather than a choice
 *
 * **Nothing in this stack can read whether the permission was granted.**
 * `NotificationManager.canUseFullScreenIntent()` is the platform call and
 * neither `expo-notifications` nor `react-native-notify-kit` exposes it —
 * `fullScreenIntent.ts` argues that at length.
 *
 * So a driver who granted it and a driver who refused are indistinguishable
 * from here. Asking again would therefore nag the drivers who already said yes,
 * every shift, forever — and an app that nags about a permission is one whose
 * notifications get switched off entirely, in Android's own settings, where the
 * office cannot see it.
 *
 * One ask, then the Profile row stands as the permanent door. If a way to read
 * the granted state ever appears, this should become "ask until granted" and
 * the reason it is not is the paragraph above.
 */

const ASKED_KEY = 'kangaruride.driver.lockScreenAsked';

/**
 * Whether to put the question in front of this driver now.
 *
 * Pure, and separated from the alert for the reason `jest.setup.ts` records:
 * the parts that can be *wrong* are worth testing, and a test of the real thing
 * would have to render a native dialog. What can be wrong here is asking a
 * driver on Android 13 for a permission they already hold, or asking the same
 * driver twice.
 */
export function shouldAskForLockScreen(grantable: boolean, alreadyAsked: boolean): boolean {
  return grantable && !alreadyAsked;
}

/**
 * Asks, at most once per install.
 *
 * Never throws and never blocks the caller: it is fired from the duty toggle,
 * which has a driver waiting on a switch. A storage read that fails is treated
 * as *already asked* — the conservative direction, because the cost of getting
 * it wrong that way is a permission the driver can still grant from Profile,
 * where getting it wrong the other way is a dialog on every shift.
 */
export async function askForLockScreenOnce(): Promise<void> {
  try {
    if (!fullScreenIntentIsGrantable()) {
      return;
    }

    const asked = await AsyncStorage.getItem(ASKED_KEY);

    if (!shouldAskForLockScreen(true, asked !== null)) {
      return;
    }

    // **Written before the dialog, not after.** A driver who swipes the app
    // away mid-question must not be asked again on their next shift, and there
    // is no callback for "the dialog went away without an answer".
    await AsyncStorage.setItem(ASKED_KEY, '1');

    Alert.alert(
      'Let jobs reach you on a locked phone',
      // Says what they get and what it costs them, in that order, without
      // naming the Android permission — a driver does not need to know the
      // word `USE_FULL_SCREEN_INTENT` to make this decision.
      'Android needs your permission for a job to open on your screen like an incoming call. ' +
        'Without it a job still arrives and still rings, but only as a banner you have to notice and tap.\n\n' +
        'You can change this any time under Profile.',
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
    // minus the lock-screen takeover, and the Profile row is still there.
  }
}

/** Test seam. Nothing in the app calls this. */
export async function forgetLockScreenPromptForTest(): Promise<void> {
  await AsyncStorage.removeItem(ASKED_KEY);
}
