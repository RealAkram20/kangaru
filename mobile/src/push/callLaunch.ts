import { offerIdFromCallNotificationId } from './callContent';
import { loadNotifyKit } from './notifyKit';

/**
 * Whether this launch of the app came from the call screen (ADR-0049 §5).
 *
 * ## The question it answers, and why the answer changes a screen
 *
 * A job offer has two surfaces now. In the app it is `OfferBanner` — a strip
 * over whatever the driver was doing, because a job they may decline should
 * not throw away a half-filled odometer form. Over a locked phone it is
 * `OfferScreen`, the full takeover, because there is nothing to interrupt and
 * the driver has just been woken by a ringing handset.
 *
 * The two differ by *how the app got here*, which is not something the offer
 * itself knows. A driver who was reading their earnings and a driver whose
 * phone just lit up in a cradle are looking at the same offer and need
 * different amounts of it.
 *
 * So this is asked once, at start-up: did Android bring this app up because
 * of a job? If it did, the offer opens expanded.
 *
 * ## Why `getInitialNotification` and not the event stream
 *
 * Because at the moment a full-screen intent fires, **no listener exists** —
 * the JavaScript runtime is being created by that intent. It is the same
 * cold-start hole `PushRouter` documents for `expo-notifications`, and
 * `getInitialNotification()` is notify-kit's equivalent of the answer:
 * a single question, asked once, about the notification that started this
 * process.
 *
 * Asking twice returns null the second time in some notifee versions, so the
 * answer is cached below rather than re-fetched per component.
 */

let asked = false;
let launchedForOffer: number | null = null;

/**
 * The offer this app was opened for, or null.
 *
 * Null on every ordinary launch — a tap on the icon, a resume from recents —
 * and on iOS, in Expo Go and on a simulator, where there is no call screen to
 * have been opened from.
 */
export async function openedFromCallScreen(): Promise<number | null> {
  if (asked) {
    return launchedForOffer;
  }

  asked = true;

  const notifee = await loadNotifyKit();

  if (notifee === null) {
    return null;
  }

  try {
    const initial = await notifee.getInitialNotification();

    // Keyed on the notification id rather than on the press action, because a
    // full-screen intent is not a press: Android started the activity, nobody
    // touched anything. The id is what identifies it as ours either way.
    launchedForOffer = offerIdFromCallNotificationId(initial?.notification?.id ?? null);

    return launchedForOffer;
  } catch {
    // Treated as an ordinary launch. The offer still appears — as the banner
    // rather than the full screen, which is a smaller surface for the same
    // job and not a failure.
    return null;
  }
}

/** Test seam. Nothing in the app calls this. */
export function resetCallLaunchForTest(): void {
  asked = false;
  launchedForOffer = null;
}
