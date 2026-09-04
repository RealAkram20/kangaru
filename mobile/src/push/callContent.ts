import type { DispatchOffer } from '../api/types';
import { formatKilometres, formatMoney, offerTitle } from '../duty/offerPresentation';

/**
 * What a job offer says when it is a call screen rather than a screen
 * (ADR-0049 §3).
 *
 * ## Why this is a separate module from the thing that displays it
 *
 * Because `callNotification.ts` cannot be tested and this can. It reaches a
 * native module that does not exist outside a development build, and it runs
 * in states no test in this repo can produce — a locked handset, a process
 * the OS started for a notification. `jest.setup.ts` states the rule the whole
 * mobile suite follows: the suites worth trusting are pure TypeScript over
 * injected ports.
 *
 * So every decision that has an answer worth checking lives here — what the
 * driver reads, which offer a notification belongs to, how long it is allowed
 * to stay up, and whether it should be shown at all — and the other file is
 * left with the native calls and nothing to get wrong.
 */

/**
 * What a press on the call notification means.
 *
 * **Strings, and they are a contract across a process death.** Android hands
 * these back to a JavaScript runtime that may have been created *by* the
 * press; the handler cannot consult anything the display call remembered,
 * because nothing from that moment survives. So the id is the whole message,
 * and renaming one of these silently breaks the buttons on every notification
 * already sitting on a driver's lock screen at the moment they update.
 *
 * Namespaced so a future notification type can add its own without an id
 * collision quietly routing a delivery button into a ride's accept.
 */
export const OFFER_ACTION = {
  /** The body of the notification, or the full-screen intent firing. */
  open: 'offer.open',
  accept: 'offer.accept',
  decline: 'offer.decline',
} as const;

export type OfferActionId = (typeof OFFER_ACTION)[keyof typeof OFFER_ACTION];

/** The notification's own id, which is how it is later replaced or cancelled. */
export function callNotificationId(offerId: number): string {
  return `offer-call-${offerId}`;
}

/**
 * The offer a call notification belongs to, or null if it is not one.
 *
 * The inverse of `callNotificationId`, and it exists because the background
 * handler is given a notification and has to answer *which job* — from a
 * runtime with no memory of having displayed it.
 *
 * Strict about the shape rather than lenient: a lenient parse here answers a
 * *different driver's* job when a future notification id happens to end in
 * digits, and answering a job is not an action worth guessing at.
 */
export function offerIdFromCallNotificationId(id: unknown): number | null {
  if (typeof id !== 'string') {
    return null;
  }

  const match = /^offer-call-(\d+)$/.exec(id);

  if (match === null) {
    return null;
  }

  const parsed = Number(match[1]);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export type CallContent = {
  /** Stable per offer, so a second push replaces rather than stacks. */
  id: string;
  offerId: number;
  /** "New ride request" — the same words the offer screen leads with. */
  title: string;
  /** One line, because Android gives a collapsed notification one line. */
  body: string;
  /**
   * How long Android should leave it up, in milliseconds.
   *
   * Always positive; a non-positive window means `buildCallContent` returns
   * null instead, so a caller cannot accidentally display a notification with
   * `timeoutAfter: 0` — which Android reads as "no timeout" and leaves on the
   * lock screen forever.
   */
  timeoutMs: number;
};

/**
 * A margin on the notification's own deadline, in milliseconds.
 *
 * The notification should outlive the offer by a moment rather than die a
 * moment early. A driver who taps Accept on the last second is racing the
 * server anyway and will be told they were too late — an honest answer. A
 * notification that vanished from under their thumb at the same instant tells
 * them nothing, and reads as the app having dropped the job.
 *
 * Two seconds, matching the deadline `ringtone.ts` arms for the same reason.
 */
const GRACE_MS = 2_000;

/**
 * Builds what the call notification says, or null if it should not be shown.
 *
 * ## Null is a real answer and callers must honour it
 *
 * A push can arrive after the job it announces is dead — a handset that was
 * in a dead zone, an FCM retry, a driver whose radio came back. `ttl` on the
 * server side makes that rare rather than impossible (ADR-0046 §2), and the
 * cost of getting it wrong is the one that ADR names as *worse than never
 * ringing*: a driver wakes a phone, reads a pickup, taps, and is told they
 * were too late for something they were never offered in time.
 *
 * So an offer with no window left produces nothing at all.
 *
 * ## What is on it, and what is deliberately not
 *
 * The mockup's four facts, in the order a driver reads them: what kind of
 * job, where it starts, how far that is, what it pays. Anything more does not
 * fit — Android gives a collapsed notification a single line and truncates
 * the rest with an ellipsis, so a fifth fact does not add information, it
 * removes the fourth.
 *
 * **No passenger, ever.** This is read on a lock screen by whoever is holding
 * the phone. ADR-0024 §7 releases the passenger's identity only after the
 * accept, and `TripOfferedNotification::context()` never puts it in the
 * payload — but the rule is restated here because this is the one surface
 * where breaking it would be invisible in review and obvious in the field.
 *
 * **No countdown in the text.** The number would be wrong the second after it
 * was written and Android does not re-render a notification's body. The
 * timeout below is how the clock is expressed here; the running countdown
 * belongs to the screen the full-screen intent opens.
 */
export function buildCallContent(offer: DispatchOffer): CallContent | null {
  const timeoutMs = Math.round(offer.expires_in_seconds * 1_000) + GRACE_MS;

  // `expires_in_seconds` is the server's own count at the moment it answered,
  // which is what the whole app prefers over `expires_at` — cheap Android
  // hardware routinely has a clock minutes out. A zero or negative window is
  // a job that is already over.
  if (!Number.isFinite(offer.expires_in_seconds) || offer.expires_in_seconds <= 0) {
    return null;
  }

  return {
    id: callNotificationId(offer.id),
    offerId: offer.id,
    title: offerTitle(offer.service_type),
    body: bodyFor(offer),
    timeoutMs,
  };
}

/**
 * The single line under the title.
 *
 * Built from whichever facts exist rather than from a fixed template. Every
 * one of them is genuinely optional in the payload: an order taken over the
 * phone has no coordinates and therefore no distances, and a category nobody
 * priced has no fare (`estimated_fare` is null by design rather than zero —
 * see `estimatedFareLabel`). A template would render "Pickup: null · null km
 * away", and a driver who reads that once stops believing the rest.
 *
 * ## The numbers come first, and the owner asked for that by name
 *
 * Android truncates this line from the end. The old order put the fare last,
 * so exactly the fact a driver decides on was the one a long pickup label
 * pushed off the screen. The owner's reference design (worklog, 2026-08-22)
 * leads with the fare and the run length; the prose — where it starts — is
 * what can afford to lose its tail to the ellipsis.
 *
 * Falls back to a sentence that is true when nothing is known, because the
 * job is still real and still worth waking a phone for.
 */
function bodyFor(offer: DispatchOffer): string {
  const parts: string[] = [];

  if (offer.estimated_fare !== null) {
    parts.push(formatMoney(offer.estimated_fare.total_minor, offer.estimated_fare.currency));
  }

  const trip = formatKilometres(offer.trip_distance_km);

  if (trip !== null) {
    parts.push(`${trip} trip`);
  }

  const away = formatKilometres(offer.pickup_distance_km);

  if (away !== null) {
    // "Under 100 m away" reads correctly; so does "2.4 km away". The unit
    // sentence is `formatKilometres`' to decide, not this one's.
    parts.push(`${away} away`);
  }

  if (offer.pickup.label !== null && offer.pickup.label.trim() !== '') {
    parts.push(`Pickup: ${offer.pickup.label.trim()}`);
  }

  return parts.length === 0 ? 'A passenger is waiting.' : parts.join(' · ');
}
