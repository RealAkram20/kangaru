import type { AppStateStatus } from 'react-native';

import type { DispatchOffer } from '../api/types';

/**
 * Which of the two surfaces is carrying a job offer right now (ADR-0049 §5).
 *
 * ## The boundary this exists to hold
 *
 * A job offer has exactly two presentations and they own different territory:
 *
 * - **the order request page** — `OfferBanner` / `OfferScreen`, painted by
 *   `OfferPresenter` over whatever the driver is doing. The right surface for a
 *   driver who is already in the app.
 * - **the call notification** — `showCallNotification`, the full-screen intent
 *   over the lock screen. The right surface for a driver who is not.
 *
 * The rule is one sentence: **whichever surface the driver can actually see is
 * the one that carries the offer, and the other one is taken down.** Two
 * surfaces up at once is not redundancy, it is two Accept buttons for one job —
 * the double answer `claimAnswer` exists to catch.
 *
 * ## Why this is a module and not three lines inside the component
 *
 * Because getting it wrong is invisible. `OfferPresenter` stays *mounted* while
 * the app is backgrounded, and its notification-clearing effect was keyed on
 * being mounted rather than on being visible — so a call notification raised
 * for a locked phone could be cancelled a beat later by a page nobody could
 * see. Nothing throws, nothing logs, and it only ever shows on a handset.
 *
 * `jest.setup.ts` records the rule this follows: the suites worth trusting in
 * this app are pure TypeScript over injected values. A component test would
 * have to render, background an app state and flush; this can be read.
 */
export type OfferSurface =
  /** The order request page. The driver is looking at the app. */
  | 'in_app'
  /** The call notification. The driver is not. */
  | 'notification'
  /** There is no live offer, so neither surface should be showing anything. */
  | 'none';

/**
 * Decides the surface from the two facts it depends on and nothing else.
 *
 * ## `'inactive'` counts as not-visible, and that is safe rather than lucky
 *
 * React Native reports `active | background` on Android and adds `inactive` on
 * iOS for transitional moments — a control centre pulled down, an incoming
 * call, the app switcher. Treating it as not-visible means a transient iOS
 * state would ask for the notification surface.
 *
 * That costs nothing, because there is no call notification on iOS at all:
 * `canShowCallScreen()` is Android-only and `showCallNotification` returns
 * having done nothing there. On Android, where the notification is real,
 * `inactive` is not a state the platform reports.
 *
 * The alternative — treating `inactive` as visible — would be wrong in the
 * expensive direction on the day Android starts reporting it: an offer
 * arriving while the app was half-backgrounded would clear its own notification
 * and show nothing.
 */
export function offerSurface(hasOffer: boolean, appState: AppStateStatus): OfferSurface {
  if (!hasOffer) {
    return 'none';
  }

  return appState === 'active' ? 'in_app' : 'notification';
}

/**
 * The ports `presentOffer` acts through.
 *
 * Both are `callNotification.ts` in the app and both are already documented as
 * safe to call unconditionally: `hideCallNotification` on a notification that
 * is not showing is a no-op, and `showCallNotification` is idempotent on the
 * offer and carries `onlyAlertOnce`, so re-raising one replaces it in place
 * without buzzing the handset again.
 */
export type OfferSurfacePorts = {
  show: (offer: DispatchOffer) => void;
  hide: (offerId: number) => void;
  /**
   * Start the app's own ringtone player.
   *
   * **Only ever on the in-app surface**, because outside the app the *channel*
   * rings — `offers.call.v2` carries `offer_ring.wav` and the notification
   * loops it. Letting both run gives a driver two copies of the same ringtone,
   * unsynchronised, neither stopping when the other does. That is the failure
   * `PushRouter`'s notification handler already avoids in the foreground and
   * which this avoids everywhere else.
   */
  ring: (offerId: number) => void;
  /** Stop it. Safe to call for an offer that is not ringing. */
  silence: (offerId: number) => void;
};

/**
 * Puts the live offer on the right surface and takes it off the wrong one.
 *
 * ## Why this is here rather than inside the effect that calls it
 *
 * Because it is the part that can be *wrong*, and `OfferPresenter` is a
 * component that cannot be rendered without a query client, an auth provider
 * and a duty poll — so a test of it would be a test of all four, and the
 * behaviour worth protecting is three lines of decision. `jest.setup.ts`
 * records the rule: the suites worth trusting in this app are pure TypeScript
 * over injected ports. The component keeps the `AppState` subscription, which
 * is plumbing, and this keeps the judgement.
 *
 * ## The stale-offer guard, which is not defensive noise
 *
 * `current` is re-read at call time rather than closed over, because the app
 * backgrounding and this running are separated by however long the OS took —
 * and a poll may have replaced the object in between. Raising a call
 * notification from a stale one would put a superseded fare and a superseded
 * pickup on a lock screen, which is the one surface a driver cannot check
 * against anything.
 *
 * When the id no longer matches, nothing is raised. The *hide* still happens
 * on the in-app branch regardless, because taking a notification down is
 * always safe and leaving a wrong one up is not.
 */
export function presentOffer(
  appState: AppStateStatus,
  offerId: number,
  current: DispatchOffer | null,
  ports: OfferSurfacePorts,
): void {
  if (offerSurface(true, appState) === 'in_app') {
    ports.hide(offerId);
    ports.ring(offerId);

    return;
  }

  // **Silenced first, and unconditionally.** The app's player is stopped
  // whether or not a notification can be raised in its place — on iOS, in Expo
  // Go and on a simulator `show` is a no-op, and a ringtone left playing from a
  // backgrounded app with nothing on screen to explain it is worse than
  // silence. The notification's own sound is the channel's, so raising it is
  // what makes the noise from here on.
  ports.silence(offerId);

  if (current !== null && current.id === offerId) {
    ports.show(current);
  }
}
