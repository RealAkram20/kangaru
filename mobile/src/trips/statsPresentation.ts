import type { DriverStats } from '../api/endpoints';
import { compactMoney, formatMoney } from '../duty/offerPresentation';

/**
 * Turning `GET /me/stats` into the words on the home screen.
 *
 * A module rather than helpers inside `HomeScreen`, for the reason
 * `offerPresentation.ts` gives and `jest.setup.ts` records: these are the
 * parts that can be *wrong* rather than merely ugly, and the suites worth
 * trusting in this app are pure TypeScript over injected values.
 *
 * **This module exists because the inline versions were wrong.** The home
 * screen carried its own money formatter that divided by 100 — on UGX, a
 * zero-decimal currency, that renders every figure at a hundredth of its
 * value — and read two fields the server had renamed, so the tile printed
 * `undefined NaN` where a driver's money goes. Neither could fail a test,
 * because there were none.
 */

/**
 * Minor units as a driver reads them: "UGX 20,500".
 *
 * Delegates to the app's one money formatter, which owns the zero-decimal
 * currency table. **Never divide here.** UGX minor units *are* whole
 * shillings (AGENTS.md money rules), and the division that looks like
 * cents-to-currency is the bug this module was extracted to kill.
 *
 * An em dash whenever the figure has not arrived — never a zero. `UGX 0`
 * reads as a day with no work, and a driver whose stats have not loaded has
 * not had one.
 */
export function money(amountMinor: number | undefined, currency: string | undefined): string {
  if (amountMinor === undefined || currency === undefined || !Number.isFinite(amountMinor)) {
    return '—';
  }

  return compactMoney(amountMinor, currency);
}

/**
 * The wallet figure, **without a sign**.
 *
 * A minus in front of money is doing two jobs badly. It is easy to miss at a
 * glance, and when it *is* noticed it does not say which way the debt runs —
 * the first person to read "UGX -4,500" on this screen asked whether the sign
 * was a bug, which is exactly the question a driver should never have to ask
 * about their own money.
 *
 * So the direction is carried entirely by `walletNote`, in words, and the
 * figure is a magnitude. That is the same rule AGENTS.md applies to status
 * colour — never let a mark that is easy to overlook be the only thing
 * carrying the meaning.
 *
 * **The two must be rendered together.** This number on its own is genuinely
 * ambiguous; that is the trade being made, and it is only sound because the
 * sentence beneath it is not optional.
 */
export function walletValue(stats: DriverStats | undefined): string {
  if (stats === undefined) {
    return '—';
  }

  /*
   * **`formatMoney`, not `compactMoney`** — exact, never "UGX 135K".
   *
   * This used to go through `money()` above, which compacts, and the mockup is
   * what surfaced it: the balance card draws *UGX 135,000* in full. Reading it
   * that way, the compact form was already against this codebase's own rule.
   * `compactMoney`'s docblock permits itself only on "a glanceable total" and
   * refuses itself on "the number a driver accepts a job for and gets paid",
   * because a `K` hides up to a hundred shillings and an `M` up to ten
   * thousand.
   *
   * A balance is squarely the second kind. It is the figure a driver takes to
   * the depot and reconciles against the office's, and a settlement
   * conversation that starts from a rounded number starts from an argument.
   *
   * The trip *count* and the day's *earnings* beside it stay compact — those
   * are glances, and nobody settles up against them.
   */
  return formatMoney(Math.abs(stats.wallet_balance_minor), stats.currency);
}

/**
 * The rating, or an em dash while it is withheld.
 *
 * **Null below five ratings (ADR-0030 §3), and that is the server's decision,
 * not this function's.** One three-star rating is not a 3.0; it is one
 * person's afternoon. Nothing here re-implements the threshold — it renders
 * whatever arrived, so the day the rule changes the app needs no release.
 */
export function ratingValue(stats: DriverStats | undefined): string {
  const rating = stats?.rating;

  return rating === null || rating === undefined ? '—' : rating.toFixed(1);
}

/**
 * What the rating rests on, in words.
 *
 * The count is what makes the em dash legible. "2 so far" says *counting*; a
 * bare dash says nothing and invites a driver to assume the worst about a
 * score that can end their income.
 *
 * **It does not name the threshold, and that is deliberate.** The first
 * version said "2 of 5 needed", which reads better and duplicates a rule this
 * app does not own: five is `DriverStatsService`'s (ADR-0030 §3), it is not
 * in the payload, and the day the office argues it down to three every
 * installed handset would still be saying five. The count is a fact the
 * server sent; the threshold would have been a guess about the server.
 */
export function ratingNote(stats: DriverStats | undefined): string | undefined {
  if (stats === undefined) {
    return undefined;
  }

  const plural = stats.rating_count === 1 ? 'rating' : 'ratings';

  if (stats.rating !== null) {
    return `${stats.rating_count} ${plural}`;
  }

  return stats.rating_count === 0 ? 'No ratings yet' : `${stats.rating_count} ${plural} so far`;
}

/**
 * Which way the wallet points, in words rather than by a minus sign.
 *
 * **A negative balance is normal and is not an error.** A driver taking cash
 * fares all day is holding the platform's money until they settle (ADR-0029
 * §5) — the honest reading, and the one a settlement conversation starts
 * from. A bare "-UGX 40,000" is ambiguous about direction to anybody who has
 * not read the ADR, and this is a figure skimmed at arm's length.
 */
/**
 * The heading over the balance figure — and the thing that makes
 * **"Available Balance"** safe to print.
 *
 * The mockup's card reads *Available Balance / UGX 135,000* with nothing else
 * on it. Taken literally that is a claim this platform usually cannot make:
 * ADR-0029 §5 makes the balance *"what the office and the driver owe each
 * other, net"*, and for cash work it is normally money the driver **owes**.
 * "Available" over that figure describes money they could spend, which is the
 * opposite.
 *
 * So the **heading carries the direction** instead of a sentence underneath.
 * In credit it is the mockup's, exactly; in debt it says so in the one place a
 * driver cannot miss, which is directly above the number. That keeps the card
 * as drawn for the state the mockup draws, keeps it true for the state a
 * driver is usually in, and satisfies the rule the explainer paragraph used to
 * satisfy — direction in words, never in a sign or a colour alone
 * (AGENTS.md § Accessibility).
 *
 * `walletNote` still exists and is still rendered on the *home* screen card,
 * where there is room for a sentence. This is the compact form.
 */
export function walletHeading(stats: DriverStats | undefined): string {
  if (stats === undefined) {
    return 'Wallet balance';
  }

  if (stats.wallet_balance_minor === 0) {
    return 'Wallet balance';
  }

  return stats.wallet_balance_minor > 0 ? 'Available Balance' : 'Balance you owe';
}

export function walletNote(stats: DriverStats | undefined): string {
  if (stats === undefined) {
    return 'Not loaded yet';
  }

  if (stats.wallet_balance_minor === 0) {
    return 'Settled up';
  }

  // "You owe the office", not "you are holding the office's cash". Both are
  // true and the second explains *why*, but it takes a beat to work out which
  // direction it means — and it is now the only thing saying so, because the
  // figure above it has no sign. The plainest sentence wins that job.
  return stats.wallet_balance_minor > 0 ? 'The office owes you' : 'You owe the office';
}
