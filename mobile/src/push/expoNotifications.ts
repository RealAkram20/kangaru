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
 * Whether this build can be pushed to.
 *
 * `storeClient` is the Expo Go app itself; a development build reports `bare`
 * or `standalone`. A simulator has no push token to give, and asking produces
 * an error rather than a refusal.
 */
export function canReceivePush(): boolean {
  return (
    Constants.executionEnvironment !== ExecutionEnvironment.StoreClient && Device.isDevice
  );
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
