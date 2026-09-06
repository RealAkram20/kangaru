import { Platform } from 'react-native';

import { canReceivePush } from './expoNotifications';

/**
 * The one place that decides whether this build can show a call screen, and
 * the one place that imports `react-native-notify-kit` (ADR-0049 §3).
 *
 * ## Why this library, and why not the obvious one
 *
 * `expo-notifications` has no full-screen intent API and never has. It can
 * set importance, which buys a heads-up banner — a strip at the top of the
 * lock screen — and that is where ADR-0046 §6 deliberately stopped. Turning
 * that strip into the thing a driver actually asked for, an incoming-call
 * screen over a locked phone, needs `setFullScreenIntent`, and nothing in the
 * Expo notification stack exposes it.
 *
 * **Notifee is archived.** Invertase archived it on 7 April 2026 and its own
 * README names `react-native-notify-kit` as the community-maintained
 * successor. ADR-0046 §6 wrote that down in advance — *"Notifee itself must
 * not be added"* — so this is the library that decision picked, arrived at
 * rather than chosen fresh. The public API is Notifee's, unchanged, which is
 * why every Notifee article about call screens still reads true here.
 *
 * ## Why the import is dynamic, for the same reason as `expo-notifications`
 *
 * `expoNotifications.ts` documents the failure at length and it applies
 * identically: this is a native module, it is absent in Expo Go, and a static
 * import at module scope takes the whole app down before a screen renders
 * rather than failing where it is used. That already happened once to this
 * app. It does not need to happen twice.
 *
 * `canReceivePush` is reused rather than re-derived — one definition of "this
 * handset does notifications", checked by the registrar, the channel, the tap
 * router and now this.
 *
 * ## Everything through here is allowed to return null
 *
 * Expo Go, a simulator, an iPhone, a build that predates the dependency —
 * every one of them gets null and carries on. What the driver loses is the
 * call screen. What they keep is the whole of ADR-0046 stage one: the MAX
 * channel, the ringtone, the heads-up banner over the lock screen, the tap
 * routing, and the five-second poll underneath all of it.
 *
 * That degradation is not a consolation, it is the reason stage one was built
 * first (ADR-0046 §6): the day Google refuses this app the full-screen intent
 * permission, the fallback is already shipped and already good.
 */

export type NotifyKit = typeof import('react-native-notify-kit').default;

/**
 * Whether this build can show a full-screen call notification.
 *
 * **Android only, and not because iOS is unfinished.** iOS has no equivalent
 * of a full-screen intent at any privilege level. The only way to draw over a
 * locked iPhone is CallKit, which needs a PushKit VoIP push, which Apple
 * grants to calling apps, tests during review, and which terminates an app
 * that accepts a VoIP push without reporting a real call. ADR-0046 keeps that
 * as a separate submission precisely so an iOS rejection cannot hold an
 * Android release. On iOS a driver gets the time-sensitive banner and the
 * ringtone, which is what they have today.
 */
export function canShowCallScreen(): boolean {
  return Platform.OS === 'android' && canReceivePush();
}

/**
 * The module, or null where it must not be touched.
 *
 * Callers should treat null as "this handset shows offers as banners" and
 * carry on, never as a failure to report.
 */
export async function loadNotifyKit(): Promise<NotifyKit | null> {
  if (!canShowCallScreen()) {
    return null;
  }

  try {
    return (await import('react-native-notify-kit')).default;
  } catch {
    return null;
  }
}
