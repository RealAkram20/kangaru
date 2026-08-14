import type { OfferPaymentMethod, TripEvent, TripPayment } from '../api/types';
import { paymentMethodLabel } from '../duty/offerPresentation';
import { momentOfTransition } from './waiting';

/**
 * The figures on the trip-in-progress screen.
 *
 * Pure functions over injected values, for the reason `places.ts` gives: these
 * are the parts that can be *wrong* rather than merely ugly, and a component
 * test would have to render and flush to reach them.
 *
 * ## The one thing this module refuses to compute
 *
 * **An ETA, or anything that could be turned into one.** ADR-0020 §3 declined
 * to derive minutes from a straight line by name, and this is the screen where
 * the pull is strongest — the mockup carried "12 min" *and* an absolute
 * "ETA 10:05 AM", which is the worse of the two: a clock time is a promise
 * made to a passenger sitting in the car, and real roads are longer than the
 * crow's flight, so it would be a promise that runs short.
 *
 * There is therefore no speed here, no duration-from-distance, and no
 * arrival time. The two numbers this screen shows are both *measured*: how
 * far, straight-line, from where the driver is now; and how long the trip has
 * been running, counted from the timeline.
 */

/**
 * When the trip started, in epoch milliseconds, or null.
 *
 * The `trip_started` row in `trip_events` — the same append-only timeline the
 * waiting screen reads its arrival from, and the same one billing derives
 * waiting charges from. `trips.started_at` carries the same moment and is not
 * used here on purpose: it is a mutable column, and AGENTS.md's Trip State
 * Machine rule is that trip timing comes from the timeline rather than from
 * something an update can quietly move.
 *
 * Null while the second request is in flight, and offline against a cache
 * taken before the transition posted. Callers render an em dash — a `00:00`
 * would tell a driver forty minutes into a journey that they had just pulled
 * away.
 */
export function startedAtFrom(events: TripEvent[] | undefined): number | null {
  return momentOfTransition(events, 'trip_started');
}

/**
 * A running trip's elapsed time, as `mm:ss` under an hour and `h:mm:ss` over.
 *
 * Deliberately not `waiting.ts`'s `formatElapsed`, which lets minutes run
 * unbounded because a wait at a kerb that reaches an hour is pathological and
 * should read as the absurd `73:20` it is. A *journey* of an hour and a
 * quarter is an ordinary upcountry run, and `75:20` is a poor way to say so —
 * it reads as a fault rather than a duration.
 *
 * Seconds are kept past the hour rather than dropped. They cost one field and
 * they are the part that visibly moves; a figure that changes once a minute
 * looks frozen on a screen a driver glances at.
 */
export function formatTripDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));

  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  if (hours === 0) {
    return `${pad(minutes)}:${pad(secs)}`;
  }

  // The hour is not zero-padded: `1:04:09`, not `01:04:09`. A leading zero on
  // a field that will realistically never exceed one digit is noise on the
  // widest figure on the screen.
  return `${hours}:${pad(minutes)}:${pad(secs)}`;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * The trip's elapsed time as a sentence, for a screen reader.
 *
 * Composed here rather than left to the badge, because `1`, `:`, `04` and
 * `:`, `09` linearise into a string of numbers that means nothing spoken.
 *
 * **"Elapsed", not "driving".** The figure is wall-clock from the
 * `trip_started` row and includes every pause — so on a trip held outside a
 * shop for five minutes, calling it driving time overstates the driving by
 * exactly the amount the passenger is being charged waiting for. Found by
 * rendering the held state and reading the badge beside the hold notice, not
 * by a test.
 */
export function durationAnnouncement(seconds: number | null): string {
  if (seconds === null) {
    return 'Elapsed trip time is not available yet.';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  }

  // Seconds are dropped from the spoken form even though the badge shows
  // them. A screen reader re-announcing every second is unusable, and the
  // question being asked out loud is "roughly how long have I been driving".
  if (minutes > 0 || hours === 0) {
    parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  }

  return `Elapsed trip time ${parts.join(' ')}.`;
}

/**
 * How long this trip has spent paused, in whole seconds.
 *
 * **A deliberate transcription of `WaitingTimeCalculator::secondsFor`**, which
 * is what the passenger is actually billed from, and the transcription is the
 * point: a driver watching one number while the invoice is computed from
 * another is how a waiting charge becomes an argument nobody can settle. The
 * server's version is authoritative; this one exists so the figure on the
 * screen is the same figure, derived the same way from the same rows.
 *
 * The algorithm, matched line for line:
 *
 * - A period **opens** on a transition *into* `waiting`.
 * - It **closes** on the next transition of any kind. Not specifically on
 *   `trip_resumed` — that is the only exit the graph allows today, and
 *   assuming it would silently run a period on forever the day another is
 *   added.
 * - Only the **first** of consecutive `waiting` events opens a period.
 *   `waiting → waiting` is not legal, but treating a repeat as a restart
 *   would drop the time in between, and a duplicate is exactly what
 *   ADR-0023 says a blind replay of this cycle produces.
 *
 * ## The one difference from the server, and why
 *
 * A period still open — the trip is paused *right now* — is measured against
 * `now` here and **excluded entirely** on the server. That is not drift.
 * The server is answering "what is billable", and an unfinished pause is not
 * billable yet; it cannot even reach billing, because only a completed trip
 * is priced. This is answering "how long have I been sitting here", which is
 * a question with an answer while it is still happening. The two agree to the
 * second the moment the driver resumes.
 *
 * Events are taken in the order given. `TripEventController` orders by `id`
 * ascending, which is the same tiebreak the server applies after `created_at`
 * — and `created_at` has second granularity, so two transitions in one second
 * would otherwise pair a period's end with its own start.
 */
export function waitingSecondsFrom(events: TripEvent[] | undefined, now: number): number {
  if (events === undefined) {
    return 0;
  }

  let seconds = 0;
  let waitingSince: number | null = null;

  for (const event of events) {
    const at = event.created_at === null ? NaN : Date.parse(event.created_at);

    if (Number.isNaN(at)) {
      continue;
    }

    if (event.to_status === 'waiting') {
      waitingSince ??= at;

      continue;
    }

    if (waitingSince !== null) {
      seconds += Math.max(0, Math.floor((at - waitingSince) / 1000));
      waitingSince = null;
    }
  }

  // The open period, if the trip is paused as this is read. Clamped for the
  // same reason `elapsedSeconds` is: the timestamps are the server's and
  // `now` is the handset's, and a phone whose clock has drifted behind would
  // otherwise subtract from a total the driver has genuinely accrued.
  if (waitingSince !== null) {
    seconds += Math.max(0, Math.floor((now - waitingSince) / 1000));
  }

  return seconds;
}

/**
 * Every payment method this app knows how to name.
 *
 * Listed rather than derived, because `Trip.payment.payment_method` is a raw
 * string: the server reads it out of a JSON column filled by a public form
 * and casts it to a string without checking it against an enum. Anything not
 * in this list is a value this build has never heard of.
 */
const KNOWN_METHODS: readonly OfferPaymentMethod[] = ['cash', 'mobile_money', 'card'];

/**
 * How this job settles, in words — or null.
 *
 * Delegates the wording to `paymentMethodLabel`, so the offer card and this
 * screen cannot disagree about what `mobile_money` is called.
 *
 * **An unrecognised method renders as an em dash, not as its raw value.** Two
 * reasons, and the second is the one that matters. The raw values are
 * machine strings — showing a driver `mobile_money` is worse than showing
 * them nothing. And if the office adds a method this build predates, an em
 * dash says "this handset does not know", which is true, where the raw token
 * would say "your payment method is `airtel_money`" in a font that makes it
 * look like a fault.
 *
 * **Null is never "Cash".** It is the plausible default and the one that
 * costs a driver real money: they arrive with no float, are offered a
 * transfer to a wallet they do not have, and the job stalls in front of the
 * customer. `—` says "nobody told us", which a driver can act on by asking.
 */
export function tripPaymentLabel(payment: TripPayment | null): string | null {
  const raw = payment?.payment_method ?? null;

  if (raw === null) {
    return null;
  }

  const known = KNOWN_METHODS.find((method) => method === raw);

  return known === undefined ? null : paymentMethodLabel(known);
}
