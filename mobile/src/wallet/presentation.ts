import type { DriverLedgerEntry } from '../api/endpoints';
import { serviceLabel } from '../earnings/presentation';
import { formatMoney } from '../duty/offerPresentation';

/**
 * Turning the ledger into the rows of a wallet statement.
 *
 * A module rather than helpers inside the screen, for the reason
 * `statsPresentation.ts` records: the parts that can be *wrong* rather than
 * merely ugly are the ones worth testing, and this app already shipped
 * `undefined NaN` where a driver's money goes because a formatter lived
 * inline with no test around it.
 *
 * ## What the mockup asked for and is not here
 *
 * Rows for **Tip from Sarah N.**, **Weekly Bonus** and **Withdrawal**, and a
 * balance card with **Withdraw** and **Add Money** buttons.
 *
 * - **Tips and bonuses now exist** (ADR-0034) and have their own rows — the
 *   refusal originally recorded here was right when it was written and is not
 *   any more. What survives it is the *name*: a row says "Tip", never "Tip
 *   from Sarah N.". ADR-0024 §7 releases a passenger's details only while a
 *   trip is live, and a wallet statement is permanent and scrollable.
 * - Withdraw and Add Money are refused by ADR-0029 §6 — *"No gateway, no
 *   mobile money, no automatic payout, no invoice to a driver"* — and there is
 *   no endpoint either could call. ADR-0032 replaced them with requests the
 *   office confirms.
 * - **"Withdrawal" is now a row**, and the earlier refusal was half right. The
 *   objection was that one word for a *kind* that runs both ways names the
 *   rarer half and misreads the common one — true. Naming it by the **sign**
 *   answers that: a negative settlement is a withdrawal, a positive one is
 *   cash handed over, and neither half is mislabelled.
 */

/** The em dash every absent figure in this app falls back to. Never a zero. */
export const NO_FIGURE = '—';

export type StatementRow = {
  id: number;
  /** What happened, in words. */
  title: string;
  /** The server's own explanation of the row, including the rate that applied. */
  detail: string;
  /** The money, already signed for display: "+ UGX 8,000" / "− UGX 10,000". */
  amount: string;
  /** Which way it moved. Drives the colour, but never carries the meaning alone. */
  direction: 'in' | 'out' | 'flat';
  when: string;
};

/**
 * What a row is called.
 *
 * `fare_earned` becomes "Ride earnings" or "Delivery earnings" where the trip
 * behind it says which — reusing `serviceLabel` from the earnings module
 * rather than growing a second vocabulary for the same distinction.
 * Everything else falls back to `kind_label`, which the server owns and which
 * is always true.
 *
 * **`cash_collected` keeps its plain name deliberately.** It is the negative
 * half of a completed cash trip — the driver is holding the platform's whole
 * fare — and softening it into something friendlier would hide the one row
 * that explains why the balance is usually negative.
 */
export function rowTitle(entry: DriverLedgerEntry): string {
  /*
   * **This one condition already covers the tip pair and the bonus**, and a
   * mutation pass is what proved it: a guard added for those three
   * explicitly *survived* being deleted, because `kind !== 'fare_earned'` is
   * true for all of them and they fall through to `kind_label` on the first
   * test. That extra branch was dead code and is deliberately not here.
   *
   * It is load-bearing for them all the same, which is why they have tests
   * (ADR-0034): a tip carries a `trip_id`, so *narrowing* this condition —
   * reading `service_type` first, say — would rename a gratuity "Ride
   * earnings", and that is the one place a tip could disappear into a fare.
   *
   * **Never "Tip from <name>", whatever the mockup said.** ADR-0024 §7
   * releases a passenger's details only while a trip is live, a wallet
   * statement is permanent and scrollable, and the server sends no name for
   * this to print.
   */
  /*
   * **A settlement is named by its sign.** The mockup draws "Withdrawal" for a
   * negative one, and that is right — what was refused before was using the
   * single word for the *kind*, which runs both ways and is far more often
   * cash going **to** the office. Reading the sign names each half correctly
   * and neither half wrongly, which is what the original objection actually
   * asked for.
   */
  if (entry.kind === 'settlement') {
    return entry.amount_minor < 0 ? 'Withdrawal' : 'Cash handed over';
  }

  if (entry.kind !== 'fare_earned' || entry.service_type === null) {
    return entry.kind_label;
  }

  // "Rides" → "Ride earnings". `serviceLabel` returns the plural noun the
  // earnings breakdown uses; here it is naming a single movement.
  const known: Record<string, string> = {
    ride: 'Ride earnings',
    delivery: 'Delivery earnings',
    self_drive: 'Self-drive earnings',
  };

  return known[entry.service_type] ?? `${serviceLabel(entry.service_type)} earnings`;
}

/**
 * The money on a row, with its direction spelled out.
 *
 * **A sign is drawn here and the row's colour is redundant to it**, which is
 * the opposite of the wallet *balance*, where the sign is deliberately
 * stripped. The two are different questions: a balance is a standing state
 * somebody misreads at a glance, so its direction goes in words; a statement
 * row is a movement, and a movement without a direction is not a movement.
 *
 * A true minus sign (U+2212), not a hyphen: at a glance beside a "+" a hyphen
 * is barely visible, and this is the character the row turns on.
 */
export function rowAmount(entry: DriverLedgerEntry): string {
  const magnitude = formatMoney(Math.abs(entry.amount_minor), entry.currency);

  if (entry.amount_minor > 0) {
    return `+ ${magnitude}`;
  }

  if (entry.amount_minor < 0) {
    return `− ${magnitude}`;
  }

  return magnitude;
}

export function rowDirection(entry: DriverLedgerEntry): 'in' | 'out' | 'flat' {
  if (entry.amount_minor > 0) {
    return 'in';
  }

  return entry.amount_minor < 0 ? 'out' : 'flat';
}

/**
 * When it happened, in the shortest form that is still unambiguous.
 *
 * **"Today, 10:45 AM" for today, "May 10, 2024" otherwise** — the mockup's
 * exact shapes, and the difference between them is deliberate rather than
 * decorative. Today's rows are read for *when in the day*, so they carry a
 * clock; an older row is read for *which day*, and a time on it is noise on a
 * line that is already the least important thing in the row.
 *
 * The 12-hour rendering is pure arithmetic on the hour — no locale, nothing
 * that can differ between two handsets in one fleet.
 *
 * **Formatted from the device's locale-independent parts rather than
 * `toLocaleString`.** Hermes ships Intl but its locale data varies by platform
 * and build, so the same row would read differently on two handsets in the
 * same fleet — and a driver comparing their phone with the office's screen
 * should see the same string.
 *
 * An em dash when the timestamp is missing, never a fabricated "just now".
 */
export function rowWhen(iso: string | null, now: Date = new Date()): string {
  if (iso === null) {
    return NO_FIGURE;
  }

  const at = new Date(iso);

  if (Number.isNaN(at.getTime())) {
    return NO_FIGURE;
  }

  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  if (sameDay) {
    const hours = at.getHours();
    const suffix = hours < 12 ? 'AM' : 'PM';
    // Midnight and noon are the two a bare modulus gets wrong: 0 % 12 and
    // 12 % 12 are both 0, and "00:15 AM" is not a time anybody writes.
    const twelve = hours % 12 === 0 ? 12 : hours % 12;
    const minutes = String(at.getMinutes()).padStart(2, '0');

    return `Today, ${String(twelve).padStart(2, '0')}:${minutes} ${suffix}`;
  }

  return `${months[at.getMonth()]} ${at.getDate()}, ${at.getFullYear()}`;
}

/** The whole statement, ready to render. */
export function statementRows(
  entries: DriverLedgerEntry[] | undefined,
  now: Date = new Date(),
): StatementRow[] {
  if (entries === undefined) {
    return [];
  }

  return entries.map((entry) => ({
    id: entry.id,
    title: rowTitle(entry),
    detail: entry.description,
    amount: rowAmount(entry),
    direction: rowDirection(entry),
    when: rowWhen(entry.created_at, now),
  }));
}

/**
 * One row as a single sentence, for a screen reader.
 *
 * Composed rather than left to linearise: read cell by cell a row becomes
 * "Ride earnings, Fare for trip 412 at 20% commission, plus UGX 8,000", where
 * the "+" is a character a screen reader may or may not announce. Putting the
 * direction in words removes that doubt — the same rule that keeps the
 * balance's direction in words rather than in a minus sign.
 *
 * ## The wording describes the *balance*, not a payment, and that was a bug
 *
 * The first draft said "to you" for a credit and "you are holding" for a
 * debit. Both are true of a completed trip and **both are wrong for a
 * settlement**, which is the one kind that runs either way: a positive
 * settlement is cash the driver **handed over at the depot**, so announcing
 * "UGX 40,000 to you" told them the office had *paid* them 40,000 when they
 * had just paid the office. Rendering the screen is what surfaced it — the
 * visible row says "Settlement / Cash remitted at the depot", which reads
 * correctly, so only the composed sentence was wrong and only for the one
 * kind no test fixture had paired with a positive amount.
 *
 * "In your favour" and "owed to the office" describe what the entry does to
 * the balance, which is what a ledger row *is*, and they stay true across all
 * seven kinds in both directions — the tip pair included, where the credit is
 * in the driver's favour and the cash half is not.
 */
export function rowAnnouncement(entry: DriverLedgerEntry): string {
  const magnitude = formatMoney(Math.abs(entry.amount_minor), entry.currency);
  const direction =
    entry.amount_minor > 0
      ? `${magnitude} in your favour`
      : entry.amount_minor < 0
        ? `${magnitude} owed to the office`
        : magnitude;

  return `${rowTitle(entry)}. ${direction}. ${entry.description}`;
}
