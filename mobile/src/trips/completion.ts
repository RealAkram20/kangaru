import type { Trip, TripEarnings } from '../api/types';
import { formatMoney } from '../duty/offerPresentation';

/**
 * What the "Ride Complete" screen says about the money.
 *
 * A module rather than helpers inside the screen, for the reason
 * `statsPresentation.ts` records at length: the parts that can be *wrong*
 * rather than merely ugly are the ones worth testing, and the suites worth
 * trusting in this app are pure TypeScript over injected values. The home
 * screen shipped `undefined NaN` where a driver's money goes precisely
 * because its formatter lived inline with no test around it.
 *
 * ## The one rule the mockup broke
 *
 * The mockup for this screen drew a fare, a tip, "Your earnings", a platform
 * fee and a total that did not reconcile — and labelled the *gross* figure as
 * the driver's earnings. Everything here reconciles by construction, because
 * the server derives the fee as `total - earned` from the two ledger figures
 * it actually wrote (ADR-0029 §2). Nothing in this module does arithmetic on
 * money; it formats what arrived.
 *
 * **There is no tip.** The concept does not exist anywhere on this platform —
 * not a column, not an invoice line type, not a ledger kind. A tip row would
 * be `docs/screen-rules.md` §1 in its purest form.
 */

/** The em dash every figure in this app falls back to. Never a zero. */
export const NO_FIGURE = '—';

/**
 * One line of the breakdown.
 *
 * `sign` is carried separately from the amount rather than baked into the
 * string, because the two rows that need it are a credit and a debit of the
 * same shape, and a formatter that emitted "-UGX 2,500" would be making the
 * same mistake `walletValue` was changed to stop making: a minus sign is easy
 * to miss and does not say which way the money moved. The label says it.
 */
export type EarningsRow = {
  label: string;
  amount: string;
  sign: 'none' | 'minus';
  /** The one figure the screen is actually about. */
  emphasis: boolean;
};

/**
 * Whether the office has confirmed this trip and priced it.
 *
 * **This is false far more often than the mockup assumes**, and it is the
 * state a driver sees most: completion is queued through the outbox
 * (ADR-0023), so the phone reaches this screen before the server has the
 * transition — and upcountry it may stay that way for hours. The screen has
 * to draw that case as its normal one.
 */
export function isConfirmed(trip: Trip | undefined): boolean {
  return earningsOf(trip) !== null;
}

/**
 * The trip's earnings, with "not loaded" and "not confirmed" collapsed.
 *
 * They are genuinely the same case for this screen — in both, the office has
 * not told this phone what the trip was worth — and keeping them apart would
 * mean every caller below testing two things to answer one question.
 */
function earningsOf(trip: Trip | undefined): TripEarnings | null {
  return trip?.earnings ?? null;
}

/**
 * The three rows of the breakdown, or null while nothing has been confirmed.
 *
 * Null rather than a row of em dashes: a driver reading three blank money
 * lines has to work out whether the ride was worthless or the phone is
 * behind, and those need different reactions. The screen says which in a
 * sentence instead — see `confirmationNote`.
 */
export function earningsRows(trip: Trip | undefined): EarningsRow[] | null {
  const earnings = earningsOf(trip);

  if (earnings === null) {
    return null;
  }

  return [
    {
      label: 'Fare',
      amount: money(earnings.total_minor, earnings.currency),
      sign: 'none',
      emphasis: false,
    },
    {
      // Not "Platform fee (20%)". The percentage is not in the payload, it is
      // a runtime setting the office can change, and a handset that stated it
      // would go on stating the old one after they did. Same rule that keeps
      // the rating threshold off the home screen.
      label: 'Platform fee',
      amount: money(earnings.commission_minor, earnings.currency),
      sign: 'minus',
      emphasis: false,
    },
    {
      // "You earned", not "Total". The mockup's "Total" sat under a subtraction
      // and repeated the fare, which told a driver their take-home was the
      // whole fare. This is the figure the screen exists to state.
      label: 'You earned',
      amount: money(earnings.earned_minor, earnings.currency),
      sign: 'none',
      emphasis: true,
    },
  ];
}

/**
 * What to say about a trip the office has not confirmed yet.
 *
 * Names the mechanism rather than apologising, because the driver's real
 * question is "have I lost this job" and the answer is no — it is on the
 * phone and it will go. `OdometerScreen`'s own footnote makes the same
 * promise in the same words, deliberately: this screen is where the driver
 * finds out whether it was kept.
 */
export function confirmationNote(trip: Trip | undefined): string | null {
  if (isConfirmed(trip)) {
    return null;
  }

  return 'This trip is saved on this phone and will be sent when there is a connection. Your earnings appear once the office has it.';
}

/**
 * The whole card as one sentence, for a screen reader.
 *
 * Composed rather than left to the reader to linearise: a grid of labels and
 * figures read cell by cell becomes "Fare, UGX 12,500, Platform fee, UGX
 * 2,500, You earned" with no indication that the middle one was subtracted.
 * `docs/screen-rules.md` §6 asks for one sensible announcement per screen.
 */
export function earningsAnnouncement(trip: Trip | undefined): string {
  const earnings = earningsOf(trip);

  if (earnings === null) {
    return 'Earnings are not confirmed yet.';
  }

  return (
    `Fare ${money(earnings.total_minor, earnings.currency)}, ` +
    `less a platform fee of ${money(earnings.commission_minor, earnings.currency)}. ` +
    `You earned ${money(earnings.earned_minor, earnings.currency)}.`
  );
}

/**
 * Minor units as a driver reads them, exactly.
 *
 * `formatMoney`, never `compactMoney`: this is money somebody is about to be
 * paid, and the compact form hides up to 100 shillings inside a "K". That
 * split is documented at `compactMoney` itself, and this is precisely the
 * side of it that must not round.
 *
 * **Never divide.** UGX minor units *are* whole shillings, and the division
 * that looks like cents-to-currency is the bug `statsPresentation` was
 * extracted to kill.
 */
function money(amountMinor: number, currency: string): string {
  if (!Number.isFinite(amountMinor)) {
    return NO_FIGURE;
  }

  return formatMoney(amountMinor, currency);
}

/**
 * The label on the primary button, and whether pressing it changes duty.
 *
 * **The mockup said "Back Online", and nothing takes a driver offline when a
 * trip ends** — `on_duty` is a switch the driver owns and completion does not
 * touch it. So a button promising to restore something would be undoing a
 * state that was never entered.
 *
 * It does the honest version of the mockup's intent instead. A driver who is
 * off duty genuinely does need to go back on before work reaches them, and
 * for them the button says so and means it. A driver already on duty is told
 * the plain truth: there is nothing to switch, so it just returns them to the
 * screen where the next job appears.
 */
export function primaryAction(onDuty: boolean): { label: string; goesOnDuty: boolean } {
  return onDuty
    ? { label: 'Back to work', goesOnDuty: false }
    : { label: 'Go online', goesOnDuty: true };
}

/** Named for the tests, so a change to the shape has to be deliberate. */
export type { TripEarnings };
