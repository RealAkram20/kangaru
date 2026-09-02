import type { ApiClient } from '../api/client';
import { fetchOffers } from '../api/endpoints';
import { CALL_SURFACE, showCallNotification } from './callNotification';
import { loadNotifications } from './expoNotifications';
import { intentFrom } from './routing';

/**
 * Turning "a job is waiting" into the call screen, from anywhere.
 *
 * ## Why this was lifted out of `PushRouter`
 *
 * It had one caller and now it has two. `PushRouter` runs this when a push
 * arrives at a *living* app; `offerPushTask` runs it when the OS has started
 * a JavaScript context for a push and there is no React tree at all. Both
 * have to do the same three things in the same order, and the order is the
 * part that is easy to get wrong:
 *
 * 1. **Ask the platform**, never believe the payload — the offer may already
 *    be gone, and a call screen for a job nobody holds is worse than silence.
 * 2. **Raise the call notification** for the offer that came back.
 * 3. **Withdraw the plain push**, so one job is one row.
 *
 * Two copies of that would drift, and the drift would only ever show on a
 * locked handset in somebody's pocket. This codebase has already paid for
 * that lesson twice — see the docblocks on `offerSurface.ts` and
 * `channels.ts`, both written after a rule that lived in two places stopped
 * agreeing with itself.
 */

/**
 * Puts the incoming-call screen up for one offer.
 *
 * ## Why the offer is fetched rather than read off the push
 *
 * `TripOfferedNotification::context()` carries three fields — the id, the
 * window and the pickup distance — and the call screen needs the pickup
 * address and the fare as well. Those are deliberately absent from the
 * payload: it reaches a lock screen, and ADR-0025 §5 keeps that surface to
 * what a driver needs to judge a job.
 *
 * The fetch buys a second thing for free, and it is the more important one:
 * **an offer another driver took while the phone was ringing simply is not in
 * the answer**, so no call screen is raised for it.
 *
 * Never throws. A dead zone between the push arriving and this request leaves
 * the driver with the ringtone and the heads-up banner `offers.v2` already
 * delivered — stage one of ADR-0046 §6, doing exactly the job it was built
 * for.
 *
 * @param isCancelled Asked once, after the network call, before anything is
 *   put on screen. `PushRouter` passes its effect's teardown flag so a
 *   notification is not raised by an unmounted component; the headless task
 *   has nothing to cancel and passes nothing.
 */
export async function raiseOfferCall(
  api: ApiClient,
  offerId: number,
  isCancelled: () => boolean = () => false,
): Promise<void> {
  try {
    const live = await fetchOffers(api);
    const match = live.find((candidate) => candidate.id === offerId);

    if (match === undefined || isCancelled()) {
      // **Says which of the two it was**, because they mean opposite things.
      // No match is the system working — the job was taken while the phone
      // rang. Cancelled means this app tore the effect down mid-flight. Both
      // end in silence, and without this line that silence is also what a
      // broken fetch looks like.
      console.warn(
        'offer.call_skipped',
        offerId,
        match === undefined ? `no_live_match(of ${live.length})` : 'cancelled',
      );

      return;
    }

    const shown = await showCallNotification(match);

    /*
     * **The floor is only removed once something is standing on it.**
     *
     * `showCallNotification` has four ordinary ways of doing nothing — iOS,
     * Expo Go, a simulator, an offer with no window left — and until it
     * reported them, all four looked from here exactly like success. The
     * dismissal below then took away the *only* notification the driver had.
     *
     * The result is the shape a driver actually described: the phone rings,
     * the screen wakes, and by the time they pick it up the ringing and the
     * notification are both gone. Nothing failed loudly enough to be found.
     */
    if (!shown) {
      console.warn('offer.call_kept_plain_push', offerId);

      return;
    }

    /*
     * **One job, one notification.**
     *
     * Two arrive for every offer: the push Android posted from `offers.v2`,
     * and the call notification just raised above. Since the ring moved onto
     * the call channel they would both ring, and a driver would be looking at
     * two rows for one job — one that can be answered and one that cannot.
     *
     * So the plain push is withdrawn the moment the answerable one is up.
     * Cancelling stops its sound with it, and the overlap is the few
     * milliseconds between Android posting it and this running.
     *
     * **The push is still the floor and is still worth sending.** This only
     * runs when something was alive to hear the notification. Where nothing
     * was, nothing here executes, nothing is dismissed, and the push rings on
     * its own exactly as it did before.
     */
    await dismissPlainPush(offerId);
  } catch {
    // See the docblock. The offer is on `GET /me/offers` either way.
  }
}

/**
 * Clears the server's own notification for an offer, if one is showing.
 *
 * Presented notifications carry the same `data` the push arrived with, so the
 * one to clear is found by the offer it names rather than by an identifier
 * that would otherwise have to survive a process death.
 *
 * Never throws, and is a no-op when nothing matches — which is the ordinary
 * case on a handset where the call notification won the race.
 */
export async function dismissPlainPush(offerId: number): Promise<void> {
  try {
    const Notifications = await loadNotifications();

    if (Notifications === null) {
      return;
    }

    const showing = await Notifications.getPresentedNotificationsAsync();

    await Promise.all(
      showing
        .filter((item) => {
          const data = item.request.content.data as {
            offer_id?: unknown;
            surface?: unknown;
          };

          /*
           * **Never the call screen itself.**
           *
           * It names the same offer as the push it is replacing, so every
           * other test here matches it too — and this function runs
           * immediately after `showCallNotification`, which meant the call
           * screen was cancelled about a second after being raised. The
           * driver got the ring, the screen woke, and there was nothing to
           * answer: the exact failure `raiseOfferCall`'s `shown` guard was
           * written to prevent, arriving through the one door that guard does
           * not cover.
           */
          if (data.surface === CALL_SURFACE) {
            return false;
          }

          return (
            intentFrom(item.request.content.data).kind !== 'ignore' &&
            data.offer_id?.toString() === offerId.toString()
          );
        })
        .map((item) => Notifications.dismissNotificationAsync(item.request.identifier)),
    );
  } catch {
    // A notification that could not be withdrawn is clutter, not a fault. It
    // carries the offer's own `ttl`, so Android removes it on the job's
    // deadline regardless.
  }
}
