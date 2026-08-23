import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';

/**
 * The one place that decides whether this build can do notifications at all,
 * and the one place that imports `expo-notifications`.
 *
 * ## Why the import is dynamic, everywhere, without exception
 *
 * **Expo Go cannot do push since SDK 53, and the module does not fail
 * politely.** Importing it registers a token listener at module scope, which
 * throws `[runtime not ready]` and takes the entire app down before a single
 * screen renders. A static import bricked the app once already — in the one
 * environment the driver flow was being demonstrated in.
 *
 * `PushRegistrar` carried that reasoning and its own copy of the guard. Then
 * the notification channel needed the same two checks, and the tap router
 * needed them again, and three copies of a rule whose failure mode is *the
 * app does not start* is three chances to get it wrong. It lives here now.
 *
 * ## Everything through here is allowed to return null
 *
 * A refused permission, a simulator, an Expo Go session, an unconfigured
 * project id — none is an error worth showing a driver, and none stops the
 * app working. ADR-0025 §3 is what makes that true: push shortens the
 * latency and is not the transport. Offers are at `GET /me/offers`, which the
 * app polls while on duty.
 *
 * In Expo Go the driver gets every offer, a few seconds later than a push
 * would have delivered it, with no ringtone. That is the design working, not
 * a consolation.
 */

export type ExpoNotifications = typeof import('expo-notifications');

/**
 * Why this build cannot be pushed to, when it cannot.
 *
 * ## Why the reason is now carried, and not just the boolean
 *
 * `canReceivePush()` answered *whether*, every caller treated a false as
 * "carry on quietly", and the result was the longest-running bug this feature
 * has had: **the whole fleet ran in Expo Go, no handset ever registered a push
 * token, `device_tokens` stayed empty, and thirty-eight job offers were
 * dispatched with nothing to send them to.** Every guard behaved exactly as
 * designed and nothing anywhere said so.
 *
 * A boolean cannot be reported usefully — "push is off" is not actionable and
 * is the normal state of a simulator. A *reason* can: `expo_go` means somebody
 * is testing in the wrong runtime and needs a development build, and it is a
 * fact about the build rather than about the driver. `PushRegistrar` logs it,
 * which is the whole of the difference between this silence and the four
 * `observability.ts` already documents keeping on purpose.
 *
 * ## The two cases, and why they are not one
 *
 * - `expo_go` — `storeClient` is the Expo Go app itself; a development build
 *   reports `bare` or `standalone`. Push has been impossible here since SDK 53,
 *   and so are the location foreground service and the call notification, so
 *   this one reason means *none of the outside-the-app path exists*.
 * - `simulator` — no push token to give, and asking produces an error rather
 *   than a refusal. Ordinary, expected, and worth telling apart from the above
 *   so a developer's emulator does not read as a fleet-wide outage.
 */
export type PushUnavailableReason = 'expo_go' | 'simulator';

/**
 * Whether this is the Expo Go app rather than a build of ours.
 *
 * **One fact, three consequences**, which is why it is exported rather than
 * left inside the reason below. Expo Go cannot do push, cannot load a native
 * module like `react-native-notify-kit`, and — the one that reaches furthest —
 * *"Background location is limited in Expo Go: on Android, it is not available
 * at all"*, in `expo-location`'s own words.
 *
 * Anything that asks the OS about background work has to know this, or it
 * reports a limitation of the runtime as a fault of the handset. That is not
 * hypothetical: `readReliability` did exactly that on its first pass, telling a
 * driver on duty that *"this phone has stopped the app"* when nothing had
 * stopped anything.
 */
export function runsInExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

export function pushUnavailableReason(): PushUnavailableReason | null {
  if (runsInExpoGo()) {
    return 'expo_go';
  }

  // **Dev-only override, and the variable is the whole of it.** An Android
  // emulator with Google Play services can do everything this gate exists to
  // prevent asking of one that cannot — FCM, the channels, the call
  // notification — and the outside-the-app path is untestable anywhere else
  // on a desk. Inlined at bundle time like every EXPO_PUBLIC_*, absent from
  // every EAS profile, so a fleet build keeps the refusal below verbatim.
  if (process.env.EXPO_PUBLIC_ALLOW_EMULATOR_PUSH === '1') {
    return null;
  }

  if (!Device.isDevice) {
    return 'simulator';
  }

  return null;
}

/**
 * Whether this build can be pushed to.
 *
 * Unchanged in meaning and deliberately kept: `notifyKit.ts`, `channels.ts` and
 * `loadNotifications` below all ask the *whether* question and none of them has
 * anywhere to report a reason to. Only `PushRegistrar` does.
 */
export function canReceivePush(): boolean {
  return pushUnavailableReason() === null;
}

/**
 * The module, or null where it must not be touched.
 *
 * Callers should treat null as "this handset does not do notifications" and
 * carry on, never as a failure to report.
 */
export async function loadNotifications(): Promise<ExpoNotifications | null> {
  if (!canReceivePush()) {
    return null;
  }

  try {
    return await import('expo-notifications');
  } catch {
    return null;
  }
}
