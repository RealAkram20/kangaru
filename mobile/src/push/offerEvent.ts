import { OFFER_ACTION, offerIdFromCallNotificationId } from './callContent';

/**
 * What a driver just did to a call notification (ADR-0049 §6).
 *
 * ## Why this is pure, and separate from the thing that acts on it
 *
 * Because this is the only part of the shade-answer path that can be tested,
 * and it is the part where being wrong is expensive. Everything around it —
 * notify-kit's event stream, a JavaScript runtime the OS created for a button
 * press, a locked phone — is unreachable from Jest.
 *
 * The failures this guards against are not crashes. They are: answering a job
 * the driver did not answer, answering the *wrong* job, and answering twice.
 * Each of those costs a real fare or a real passenger, and each is a decision
 * made from three primitive values that can be handed to a test.
 */

/**
 * Notifee's event types, as literals rather than as its enum.
 *
 * **The enum lives in the native module**, which cannot be imported here — a
 * static import of `react-native-notify-kit` at module scope is the thing
 * `notifyKit.ts` exists to prevent, and it would take this file's tests down
 * with the app. The numbers are Notifee's published contract and have been
 * stable across the fork; they are asserted against the real enum in
 * `offerEvent.test.ts` only where the module is available.
 */
export const NOTIFEE_EVENT = {
  DISMISSED: 0,
  PRESS: 1,
  ACTION_PRESS: 2,
  DELIVERED: 3,
} as const;

export type OfferOutcome =
  /** Take the job, now, without waiting for the app to finish opening. */
  | { kind: 'accept'; offerId: number }
  /** Pass on it. */
  | { kind: 'decline'; offerId: number }
  /** Show the driver the whole offer — the body was tapped, or the screen woke. */
  | { kind: 'open'; offerId: number }
  /** Anything else, including every notification in the app that is not an offer. */
  | { kind: 'ignore' };

/**
 * One notification event, in the three fields that decide what it means.
 *
 * Deliberately not notifee's `Event`: that type carries a native module's
 * shape into a pure file, and nine tenths of it is irrelevant here. Narrowing
 * at the boundary is also what lets the caller pass a half-populated event
 * from a cold start without this having to defend against every optional field
 * on it.
 */
export type OfferEvent = {
  type: number;
  /** The notification's own id — `offer-call-41`, or something else entirely. */
  notificationId: unknown;
  /** Which button, when the event is an action press. */
  pressActionId?: unknown;
};

/**
 * Reads an outcome out of an event.
 *
 * ## Why the offer comes from the notification id and not from `data`
 *
 * Both carry it. The id is used because **the id is what the app itself
 * wrote**, in `callNotificationId`, one process ago — where `data` may have
 * been round-tripped through Android's extras, stringified, or replaced by a
 * push from a server newer than this build. A parse that answers a job must
 * take the least-travelled route to the job's identity.
 *
 * A notification whose id is not ours yields `ignore`, which is how every
 * other notification in the platform — a trip assignment, a settlement, a
 * support reply — passes through this handler untouched.
 *
 * ## Why a dismissal is not a decline
 *
 * A driver who swipes the notification away has not said no. They have said
 * *not now*, or their sleeve has. Turning that into a decline would cost them
 * a fare they never refused, and the job stays live until its own clock runs
 * out — the same reasoning `OfferPresenter` gives for its dismiss.
 *
 * (In practice the call notification is `ongoing` and cannot be swiped. This
 * still answers the case, because `ongoing` is not honoured identically on
 * every OEM skin and a rule that depends on that is a rule that fails on
 * exactly the handsets this fleet runs.)
 */
export function outcomeOf(event: OfferEvent): OfferOutcome {
  const offerId = offerIdFromCallNotificationId(event.notificationId);

  if (offerId === null) {
    return { kind: 'ignore' };
  }

  if (event.type === NOTIFEE_EVENT.ACTION_PRESS) {
    switch (event.pressActionId) {
      case OFFER_ACTION.accept:
        return { kind: 'accept', offerId };
      case OFFER_ACTION.decline:
        return { kind: 'decline', offerId };
      case OFFER_ACTION.open:
        return { kind: 'open', offerId };
      default:
        // A button from a build that is no longer installed. Opening the offer
        // is the safe answer to "the driver pressed something": it shows them
        // the job and lets them decide, where guessing accept or decline would
        // answer for them.
        return { kind: 'open', offerId };
    }
  }

  // The body of the notification, or the full-screen intent bringing the app
  // up. Both mean *show me the job*.
  if (event.type === NOTIFEE_EVENT.PRESS) {
    return { kind: 'open', offerId };
  }

  // DISMISSED, DELIVERED, and everything notifee adds later.
  return { kind: 'ignore' };
}

/**
 * Whether an outcome has already been acted on in this process.
 *
 * ## The double-answer this prevents, which is not hypothetical
 *
 * Accept carries `launchActivity: 'default'`, so pressing it both fires an
 * event *and* starts the app. Notifee then reports that same press twice: once
 * through the background or foreground event stream, and again through
 * `getInitialNotification()`, which the app asks on start-up precisely because
 * a cold start has no listener attached yet.
 *
 * Two reports of one press means two `POST /me/offers/41/acceptance` calls.
 * The server rejects the second — the offer is no longer `offered` — but the
 * rejection arrives as an error, and an error after an accept is what puts
 * *"somebody else took it"* in front of the driver who just took it.
 *
 * A module-scope set is the right lifetime here: it must survive across the
 * handlers within one process and must not survive the process, because a
 * later launch is a genuinely new chance to act.
 */
const answered = new Set<string>();

/** True the first time it is asked about a given answer, false after. */
export function claimAnswer(outcome: OfferOutcome): boolean {
  if (outcome.kind === 'ignore' || outcome.kind === 'open') {
    // Opening twice is idempotent — the same screen, already showing. Only the
    // answers are guarded, because only the answers are writes.
    return true;
  }

  const key = `${outcome.kind}:${outcome.offerId}`;

  if (answered.has(key)) {
    return false;
  }

  answered.add(key);

  return true;
}

/** Test seam. Nothing in the app calls this. */
export function resetClaimsForTest(): void {
  answered.clear();
}
