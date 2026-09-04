import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';

import { runsInExpoGo } from '../push/expoNotifications';

/**
 * The Android settings screens a driver has to visit in person.
 *
 * Some permissions cannot be granted from inside an app at all. Android decides
 * that, not this codebase: a *special app access* and a battery-optimisation
 * exemption are both settings a user must change themselves, by design, so that
 * an app cannot quietly award itself the right to interrupt them or to run
 * forever.
 *
 * Every function here therefore does one thing — **open the right page** — and
 * resolves either way. None of them can report whether the driver then granted
 * anything, which is why `permissions.ts` models those states as `unreadable`
 * rather than guessing.
 */

/** This build's Android package name, as Android matches on it. */
function applicationId(): string {
  // Required lazily so this file stays importable in a test environment where
  // the native constants module is not present — the same reason
  // `fullScreenIntent.ts` does it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose, see above
  const Constants = require('expo-constants').default as {
    expoConfig?: { android?: { package?: string } };
  };

  return Constants.expoConfig?.android?.package ?? 'ug.co.kangaruride.driver';
}

/**
 * Where a driver turns a permission back on after refusing it.
 *
 * **The one door that always works.** Android will not re-prompt for a
 * permission a user has denied twice — `requestPermissionsAsync` returns denied
 * without showing anything — so for those the app's only honest move is to open
 * its own settings page and say what to look for. `Linking.openSettings()` is
 * the supported route and exists on both platforms.
 */
export async function openAppSettings(): Promise<boolean> {
  try {
    await Linking.openSettings();

    return true;
  } catch {
    // An OEM that has removed the screen. The caller says so rather than
    // leaving a row that was tapped and did nothing.
    return false;
  }
}

/**
 * Android's battery-optimisation list, where this app can be marked
 * unrestricted.
 *
 * ## One tap, because this is reliability and not a preference
 *
 * There are two intents. `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` asks the
 * driver once, in a yes/no dialog, and is what ships here.
 * `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` needs no manifest permission
 * but drops a driver into an alphabetical list of every app on the phone to
 * find themselves in — and a permission a driver cannot find is one they do not
 * grant.
 *
 * The dialog requires `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` in the manifest,
 * which `withLockScreenCallUi` correctly frames as *"a Play Store policy
 * commitment, not a build detail"*. **The owner made that commitment
 * deliberately**, on the ground that this is not about battery life: a driver
 * who has gone on duty has asked to be sent work, and a phone that quietly
 * stops the app is one that takes their income without telling them. Google's
 * own accepted use cases cover an app whose core function needs to keep running
 * in the background, and this app already declares `FOREGROUND_SERVICE_LOCATION`
 * for the same service — so the review category was already entered, not newly
 * chosen.
 *
 * ## Why this matters more here than almost anywhere
 *
 * `OnlineService` calls the location foreground service the keystone of the
 * whole feature: while it runs the process survives, the presence heartbeat
 * keeps its cadence, and a job offer can reach a closed app. An OEM battery
 * manager killing that service takes all three down at once, silently — and
 * this fleet runs Tecno, Infinix and Xiaomi, whose managers are the most
 * aggressive in the market.
 */
export async function openBatteryOptimisationSettings(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }

  /*
   * **Nothing to open in Expo Go, and saying so beats a silent no-op.**
   *
   * The intent names `package:ug.co.kangaruride.driver`, which is not installed
   * when the runtime is Expo Go — that package is `host.exp.exponent`. Android
   * finds no such app and the dialog never appears. `REQUEST_IGNORE_BATTERY_
   * OPTIMIZATIONS` is not in Expo Go's manifest either, so it would be refused
   * even if the package matched.
   *
   * This was reported as *"on click they did nothing"*, and it was exactly
   * that: a real row, a real intent, an impossible target, and a `catch` that
   * swallowed the failure. The caller now tells the driver instead.
   */
  if (runsInExpoGo()) {
    return false;
  }

  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      // `package:` names who is asking. Without it Android has no app to
      // exempt and the dialog cannot be shown — the same requirement, and the
      // same silent failure, that `fullScreenIntent.ts` documents for its own
      // intent.
      { data: `package:${applicationId()}` },
    );

    return true;
  } catch {
    // An OEM that has removed the dialog, or a handset that refuses it. The
    // list is the fallback: worse to use, always present.
    try {
      await IntentLauncher.startActivityAsync(
        'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS',
      );

      return true;
    } catch {
      return openAppSettings();
    }
  }
}

/**
 * Where "Allow all the time" is granted.
 *
 * `expo-location` can *ask* for background location, but only once, and only
 * while the driver has not refused it before — after that Android returns
 * denied without prompting. The screen offers the ask first and falls back to
 * here, which is the page carrying the radio button the app cannot press.
 */
export async function openLocationSettings(): Promise<boolean> {
  if (Platform.OS !== 'android' || runsInExpoGo()) {
    // Expo Go's own settings page is the honest destination there: the
    // permissions a driver would change are Expo Go's, because that is the app
    // actually holding them.
    return openAppSettings();
  }

  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.APPLICATION_DETAILS_SETTINGS',
      // `package:` is required. Without it this opens the *system-wide* app
      // list and leaves a driver scrolling alphabetically to find themselves —
      // the same trap `fullScreenIntent.ts` documents for its own intent.
      { data: `package:${applicationId()}` },
    );

    return true;
  } catch {
    return openAppSettings();
  }
}
