import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

import { runsInExpoGo } from './expoNotifications';

/**
 * The permission that decides whether a job takes over a locked phone
 * (ADR-0049 §2).
 *
 * ## Why this is a special access and not an ordinary permission
 *
 * `USE_FULL_SCREEN_INTENT` was a normal permission — granted at install, no
 * prompt — until Android 14. It is now a *special app access*, and Google's
 * April 2026 Play policy grants it automatically only to **alarm-clock and
 * phone/video-calling apps**. A dispatch app is neither. On Android 14 and
 * above this app is installed **without** it and has to ask a driver, once,
 * in Android's own settings.
 *
 * ADR-0046 §6 planned the whole feature around that fact, which is why stage
 * one — the MAX channel, the ringtone, the heads-up banner over the lock
 * screen — was built first and shipped alone. A review hold or a driver who
 * says no costs the takeover, not the offer.
 *
 * ## What refusal looks like, and why it is the dangerous part
 *
 * **Android does not refuse a full-screen intent it has not granted. It
 * silently downgrades it to a heads-up notification.** Nothing throws,
 * nothing logs, and `displayNotification` resolves exactly as it does on a
 * granted handset. So the failure mode of this whole feature is *it quietly
 * behaves like the version before it* — indistinguishable, from inside the
 * app, from success.
 *
 * That is why the degraded path had to be good on its own, and it is the
 * first thing to check when someone reports the popup not appearing on a
 * newer handset.
 *
 * ## Why there is no `isGranted()` here
 *
 * Because nothing in this stack can answer it. `NotificationManager
 * .canUseFullScreenIntent()` is the platform call, and neither
 * `expo-notifications` nor `react-native-notify-kit` exposes it —
 * notify-kit's `AndroidNotificationSettings` carries `alarm` and nothing
 * else. Reading it would take a native module of our own.
 *
 * So the app cannot show a driver whether they have granted this, and this
 * file does not pretend otherwise: it offers the door, and the row that uses
 * it is worded as an action rather than as a state. Inventing a
 * "Not granted" label we cannot verify would be worse than saying nothing —
 * it would be wrong on every handset that *had* granted it.
 */

/** Android 14. Below this the permission is granted at install and there is nothing to ask. */
const ANDROID_14 = 34;

/**
 * Whether this handset is one where the driver may have to grant it.
 *
 * "May", not "does" — see the note above on why granted state is unreadable.
 * Used to hide the settings row entirely on Android 13 and below, where
 * sending a driver to a settings screen for a permission they already hold is
 * an instruction that makes the app look broken.
 */
export function fullScreenIntentIsGrantable(): boolean {
  return Platform.OS === 'android' && Number(Platform.Version) >= ANDROID_14;
}

/**
 * Opens Android's own screen for this permission, on this app.
 *
 * `package:` data is required — without it the intent opens the *system-wide*
 * list of apps with this access rather than this app's own toggle, and a
 * driver is left scrolling an alphabetical list to find themselves.
 *
 * Resolves either way. A handset whose OEM has removed the screen throws, and
 * the honest response is to do nothing rather than to show an error about a
 * settings page: the driver has lost the takeover and kept the notification,
 * which is a working app.
 */
export async function openFullScreenIntentSettings(): Promise<boolean> {
  if (!fullScreenIntentIsGrantable()) {
    return false;
  }

  /*
   * **Impossible in Expo Go, and the caller must be able to say so.** The
   * intent names `package:ug.co.kangaruride.driver`, which is not installed
   * when the runtime is Expo Go — that package is `host.exp.exponent`. Android
   * finds nothing to open and the screen never appears, which was reported as
   * a row that "did nothing" when tapped.
   */
  if (runsInExpoGo()) {
    return false;
  }

  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT',
      // `applicationId` is the package the build was signed as, which is what
      // Android matches on. Reading it from the native constant rather than
      // repeating `ug.co.kangaruride.driver` here keeps a debug build — which
      // may carry a suffix — from opening a settings page for an app that is
      // not installed.
      { data: `package:${applicationId()}` },
    );

    return true;
  } catch {
    // An OEM without the screen, or an intent this Android build does not
    // know. Reported rather than swallowed, so the row that was tapped can
    // explain itself.
    return false;
  }
}

/**
 * This build's Android package name.
 *
 * `expo-application` would be the tidy source and is not a dependency; the
 * constant below is what `expo-constants` already exposes from the manifest,
 * and it is the same string the config plugin writes into the manifest.
 */
function applicationId(): string {
  // Required lazily so this file stays importable in a test environment where
  // the native constants module is not present. A top-level import would pull
  // `expo-constants` onto the launch path of every suite that touches the
  // `Platform.Version` check next door.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose, see above
  const Constants = require('expo-constants').default as {
    expoConfig?: { android?: { package?: string } };
  };

  return Constants.expoConfig?.android?.package ?? 'ug.co.kangaruride.driver';
}
