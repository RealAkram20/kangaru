import type { PeakHours, ReferralOffer, WeeklyChallenge } from '../api/endpoints';
import { formatMoney } from '../duty/offerPresentation';

/**
 * Turning the promotions payload into the words on the card.
 *
 * A module rather than helpers inside the component, for the reason
 * `duty/offerPresentation.ts` gives: these are the parts that can be *wrong*
 * rather than merely ugly, and the suites worth trusting in this app are pure
 * TypeScript over injected values.
 *
 * ## The clock is always injected
 *
 * Every function that needs "now" takes it as an argument. Two reasons, and
 * the second is the real one:
 *
 * - A test that reads the wall clock passes on a Tuesday and fails on a
 *   Sunday.
 * - **A driver's phone clock is not evidence.** The server sends the fleet's
 *   timezone and instants resolved inside it; anything derived here is a
 *   comparison against those instants, never a re-derivation of them. That is
 *   why nothing below parses `HH:MM` or names a timezone.
 */

/** How the challenge card reads at the top: what completing it pays. */
export function challengeReward(challenge: WeeklyChallenge): string {
  return formatMoney(challenge.amountMinor, challenge.currency);
}

/**
 * The bar, as a fraction between 0 and 1.
 *
 * **Clamped at both ends.** A driver who has done 34 trips against a target of
 * 30 must not be drawn overflowing the track — the bar's job is "how close",
 * and past the target the answer is "there". Below zero cannot happen and is
 * clamped anyway, because a negative width is a rendering crash rather than a
 * wrong number.
 */
export function challengeFraction(challenge: WeeklyChallenge): number {
  if (challenge.tripTarget <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(1, challenge.trips / challenge.tripTarget));
}

/** "18 / 30 trips" — the mockup's own wording, with the count in front. */
export function challengeProgress(challenge: WeeklyChallenge): {
  done: string;
  rest: string;
} {
  // Split so the screen can weight the two halves differently, as the mockup
  // does: the number a driver is looking for is bold, the denominator is not.
  return {
    done: String(challenge.trips),
    rest: `/ ${challenge.tripTarget} trips`,
  };
}

/**
 * How long the week has left — "Ends in 3 days", "Ends today".
 *
 * **Never "Ends in 0 days".** The last day of a week is a real state and it is
 * the one that matters most to somebody two trips short, so it gets its own
 * sentence rather than a zero. Same rule that keeps `UGX 0` off a fare.
 *
 * Measured in whole days remaining, rounding *up*: with 30 hours left a driver
 * has parts of two days to work, and "Ends in 1 day" would be telling them
 * they have less time than they do.
 *
 * Returns null when the deadline has passed, which the screen renders as
 * nothing rather than as a negative — a week that closed is a week the command
 * is about to evaluate, and "Ended 2 days ago" is a fact about a bonus this
 * card can no longer describe.
 */
export function challengeEnds(challenge: WeeklyChallenge, now: Date): string | null {
  const endsAt = new Date(challenge.endsAt).getTime();
  const remainingMs = endsAt - now.getTime();

  if (Number.isNaN(endsAt) || remainingMs <= 0) {
    return null;
  }

  const days = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));

  if (days <= 1) {
    return 'Ends today';
  }

  return `Ends in ${days} days`;
}

/**
 * The sentence under the progress bar, which is the honest half of this card.
 *
 * The mockup implies the bonus is being accumulated. It is not: the award runs
 * over a **closed** week (ADR-0034 §4), so a driver at 30 of 30 on Wednesday
 * has cleared the target and still has nothing until Monday. Saying so is the
 * difference between a progress bar and a promise.
 */
export function challengeNote(challenge: WeeklyChallenge): string {
  return challenge.achieved
    ? 'Target reached. Paid into your wallet after the week closes.'
    : 'Paid into your wallet after the week closes.';
}

/**
 * "5:00 PM – 8:00 PM", from the two instants the server resolved.
 *
 * **Rendered in the fleet's zone, not the handset's.** `timeZone` is passed
 * explicitly to `toLocaleTimeString`, because a driver whose phone has picked
 * up a neighbouring country's zone must not be shown a peak window an hour out
 * — they would arrive an hour late for money that is real.
 *
 * Hermes ships Intl, and this is the one place this app uses it rather than
 * formatting by hand: a localised time-of-day is genuinely locale-dependent
 * (12-hour here, 24-hour elsewhere) where a currency figure is not, and
 * PRODUCT.md's international-ready constraint is better served by the platform
 * than by a hand-rolled AM/PM.
 */
export function peakWindow(peak: PeakHours, timezone: string): string {
  const from = formatClock(peak.startsAt, timezone);
  const until = formatClock(peak.endsAt, timezone);

  if (from === null || until === null) {
    return '—';
  }

  // An en dash with hair spaces, not a hyphen: this is a range, and a hyphen
  // between two times reads as a compound word at small sizes.
  return `${from} – ${until}`;
}

/**
 * "Today" or "Tomorrow", or null when neither is true.
 *
 * The mockup writes "Today, 5 PM – 8 PM", and the word earns its place: it
 * answers whether the driver is reading about *this* evening or some abstract
 * schedule. It is checked rather than assumed, because the server resolved the
 * window onto the day of the *request* and this screen caches for five minutes
 * and survives being backgrounded — a card left open overnight would otherwise
 * greet somebody with "Today" about yesterday.
 *
 * Null drops the prefix rather than guessing. A stale card then reads
 * "5:00 PM – 8:00 PM", which is incomplete where "Today" would be wrong.
 */
export function peakDay(peak: PeakHours, timezone: string, now: Date): string | null {
  const start = localDate(peak.startsAt, timezone);
  const today = localDate(now.toISOString(), timezone);

  if (start === null || today === null) {
    return null;
  }

  if (start === today) {
    return 'Today';
  }

  const tomorrow = localDate(new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), timezone);

  return start === tomorrow ? 'Tomorrow' : null;
}

/**
 * Whether the window is open *now*, decided here rather than trusting the
 * `active` flag alone.
 *
 * The flag was true at the moment of the request, and this screen is cached
 * for five minutes and survives being backgrounded — so a card left open
 * across 8 PM would go on saying "Live now" after the money stopped. The flag
 * is still used as the seed: it is the server's answer, and it is right about
 * the boundary in the fleet's zone.
 */
export function peakIsLive(peak: PeakHours, now: Date): boolean {
  const startsAt = new Date(peak.startsAt).getTime();
  const endsAt = new Date(peak.endsAt).getTime();

  if (Number.isNaN(startsAt) || Number.isNaN(endsAt)) {
    return peak.active;
  }

  const at = now.getTime();

  return at >= startsAt && at < endsAt;
}

/**
 * "Earn 20% more" — the mockup's headline, built from the served number.
 *
 * The percentage arrives as an integer and the sentence is composed here,
 * which is what makes it translatable. A server that sent the whole phrase
 * would have pinned the app to English.
 */
export function peakHeadline(peak: PeakHours): string {
  return `Earn ${peak.upliftPercent}% more`;
}

/**
 * What the uplift actually applies to, stated plainly.
 *
 * This is the sentence the card exists to get right. "Earn 20% more" on its
 * own could be read as 20% off a bigger fare — which is what the *night rate*
 * does, and is a different thing that also exists on this platform. The uplift
 * is on the driver's own share and costs the passenger nothing, and a driver
 * comparing their statement against this card needs to know which.
 */
export function peakNote(): string {
  return 'Added to your share of every trip you finish in the window.';
}

/** "Earn UGX 10,000" — what one successful referral pays. */
export function referralReward(referral: ReferralOffer, currency: string): string {
  return formatMoney(referral.rewardAmountMinor, currency);
}

/** "when they complete 10 trips" — the mockup's own second line. */
export function referralCondition(referral: ReferralOffer): string {
  const trips = referral.tripTarget;

  // Singular is not a hypothetical: a fleet may well set this to 1 for a
  // launch push, and "1 trips" is the kind of thing that makes an app look
  // unfinished on the one screen meant to persuade somebody.
  return trips === 1
    ? 'when they complete their first trip'
    : `when they complete ${trips} trips`;
}

/**
 * The line about referrals already made, or null when there are none.
 *
 * **Null rather than "0 introduced".** A driver who has referred nobody is
 * being shown an offer, not a record, and a zeroed tally under it reads as
 * failure at the moment the card is trying to be inviting.
 *
 * Both halves are stated when they differ, because "3 introduced" alone
 * invites the question this answers: two of them have not finished their
 * trips, so nothing is owed for them yet.
 */
export function referralTally(referral: ReferralOffer, currency: string): string | null {
  if (referral.introduced === 0) {
    return null;
  }

  const introduced = referral.introduced === 1 ? '1 driver joined' : `${referral.introduced} drivers joined`;

  if (referral.qualified === 0) {
    return `${introduced} · none have finished their trips yet`;
  }

  return `${introduced} · ${formatMoney(referral.earnedMinor, currency)} earned`;
}

/**
 * The message a driver sends when they share their code.
 *
 * Deliberately says what the *other person* gets, which is nothing: the reward
 * is the referrer's. Implying otherwise would have a driver making a promise
 * to a friend that the platform will not keep — the same failure as putting an
 * invented figure on a screen, one step removed.
 */
export function referralShareMessage(referral: ReferralOffer): string {
  return `Drive with KangaruRide. Use my referral code ${referral.code} when you apply.`;
}

/**
 * An ISO instant as a clock time in a named zone, or null if either is
 * unusable.
 *
 * Null rather than a fallback, because the caller renders an em dash: a time
 * derived from a zone the runtime did not recognise is a *wrong* time, and a
 * driver planning their evening around it would lose money.
 */
/**
 * The calendar date an instant falls on, in a named zone, as `YYYY-MM-DD`.
 *
 * `en-CA` because it yields ISO order, which is the one locale trick here that
 * is about correctness rather than appearance: these strings are only ever
 * compared to each other, never shown.
 */
function localDate(iso: string, timezone: string): string | null {
  const at = new Date(iso);

  if (Number.isNaN(at.getTime())) {
    return null;
  }

  try {
    return at.toLocaleDateString('en-CA', { timeZone: timezone });
  } catch {
    return null;
  }
}

function formatClock(iso: string, timezone: string): string | null {
  const at = new Date(iso);

  if (Number.isNaN(at.getTime())) {
    return null;
  }

  try {
    return at.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone,
    });
  } catch {
    // An unrecognised zone throws a RangeError. Falling back to the handset's
    // own zone would silently show a plausible, wrong time.
    return null;
  }
}
