import type {
  DriverSettlementRequest,
  LedgerRange,
  SettlementRequestKind,
} from '../api/endpoints';
import { formatMoney } from '../duty/offerPresentation';

/**
 * Settlement requests and date ranges, in the words the screen uses.
 *
 * ## The two buttons, and what they are not called
 *
 * The mockup said **Withdraw** and **Add Money**. Neither is what happens
 * (ADR-0032 §1): a driver is not depositing into an account this platform
 * holds, and there is nothing here to withdraw from. They are telling the
 * office that cash changed hands, or asking it to — so the app says
 * **"I've paid the office"** and **"Request a payout"**.
 *
 * Note which one leads. Cash work runs *towards* the office — a rider takes
 * the whole fare in hand and remits the platform's share later — so
 * `remittance` is the button most drivers press, and it is the one on the
 * left.
 */

/** The em dash every absent figure in this app falls back to. */
export const NO_FIGURE = '—';

/**
 * The order the wallet card shows them: **Withdraw, then Add Money** — the
 * mockup's, and it reads as the two directions the balance can move rather
 * than as two unrelated errands.
 *
 * This used to lead with `remittance` on the argument that cash work runs
 * towards the office, so it is the button most drivers press. That is still
 * true and is why `remittance` keeps the friendlier half of the pair; the
 * mockup's order is the owner's call and costs nothing.
 */
export const SETTLEMENT_KINDS: readonly SettlementRequestKind[] = [
  'payout',
  'remittance',
] as const;

/** The button, and the sheet's title. */
/**
 * The button, and the sheet's title.
 *
 * ## Why these are the mockup's words after all
 *
 * ADR-0032 §1 chose **"I've paid the office"** and **"Request a payout"** over
 * Withdraw and Add Money, and said so in as many words: *"a driver is not
 * depositing into an account this platform holds, and there is nothing here to
 * withdraw from."* The owner has now asked twice for the mockup's labels, so
 * these are them — and the ADR's *substance* is untouched. Nothing about the
 * mechanism changed: both still raise a request the office answers, and the
 * ledger still learns about it only from that answer.
 *
 * The objection is answered rather than ignored. Read against the **balance**
 * — which is what this card is — the two words are accurate: `payout` moves it
 * down and `remittance` moves it up, which is exactly what "withdraw" and "add
 * money" describe. What they must not be allowed to imply is *immediacy*, so
 * every surface that carries them also carries the sentence that nothing moves
 * until the office confirms: the button's accessibility hint, and
 * `kindExplainer` before any figure is typed.
 *
 * If a driver ever reports believing the button paid them, that is the signal
 * to put this back — and the reasoning is here rather than deleted so the next
 * person has the argument, not just the outcome.
 */
export function kindAction(kind: SettlementRequestKind): string {
  if (kind === 'tip') {
    // Not "Add a tip". A driver is *reporting* one a passenger already gave
    // them in cash, and a verb that sounds like creating money is the exact
    // misreading ADR-0034 §1 is careful about. The mockup does not draw this
    // button at all, so nothing here is being overridden.
    return 'A passenger tipped me';
  }

  return kind === 'remittance' ? 'Add Money' : 'Withdraw';
}

/**
 * What the sheet explains before a driver types an amount.
 *
 * Both sentences say the same load-bearing thing in different words: **this
 * does not move money**. A driver who believes tapping a button pays them is
 * a driver who stops trusting the app the first time nothing arrives.
 */
export function kindExplainer(kind: SettlementRequestKind): string {
  if (kind === 'tip') {
    // Two facts, and the second is the one a driver would otherwise find out
    // from their balance: the platform takes its usual cut of a tip
    // (ADR-0034 §2). Saying so here rather than letting the wallet reveal it
    // is the difference between a rule and a surprise.
    //
    // The rate itself is **not** printed. It is a runtime setting, and a
    // handset that stated it would go on stating the old number after the
    // office changed it — the same reason no screen in this app prints the
    // commission percentage.
    return 'Tell the office how much a passenger tipped you in cash. Commission applies at the usual rate, and your balance updates when they confirm it — not now.';
  }

  // **The explainer carries the whole truth the short label cannot.** These
  // sentences are why "Withdraw" and "Add Money" are safe on the buttons: a
  // driver reads this before typing a figure, and it says both what the
  // request actually is and that nothing moves until somebody answers it.
  return kind === 'remittance'
    ? 'Tell the office how much cash you have handed over. They confirm it, and your balance updates then — not now. Nothing is transferred by this app.'
    : 'Ask the office to pay you what you are owed. They arrange the cash; nothing is transferred by this app.';
}

/** The label on a driver's own pending or answered request. */
export function requestTitle(request: DriverSettlementRequest): string {
  if (request.kind === 'tip') {
    // The trip number, never the passenger. ADR-0024 §7 and ADR-0034 §6.
    return request.trip_id === null ? 'Tip declared' : `Tip on trip #${request.trip_id}`;
  }

  return request.kind === 'remittance' ? 'Cash handed over' : 'Payout requested';
}

/**
 * How a request reads while it waits, and after it is answered.
 *
 * A declined request always shows the office's reason. A refusal with no
 * explanation is how a driver stops using a feature — the server makes the
 * reason mandatory for the same reason.
 */
export function requestNote(request: DriverSettlementRequest): string {
  if (request.status === 'declined') {
    return request.decline_reason ?? 'The office declined this.';
  }

  if (request.status === 'confirmed') {
    return 'Confirmed by the office. It is in your balance.';
  }

  return 'Waiting for the office. Your balance has not changed yet.';
}

/** "UGX 47,000", exact — this is money somebody is owed. */
export function requestAmount(request: DriverSettlementRequest): string {
  return formatMoney(request.amount_minor, request.currency);
}

/**
 * Whether a kind may be raised right now.
 *
 * One open request per kind (ADR-0032 §4). The button is disabled rather than
 * hidden, with the open request shown beneath it — a control that vanishes
 * leaves a driver wondering whether they imagined it, where a disabled one
 * with a reason answers the question.
 */
export function hasOpenRequest(
  requests: DriverSettlementRequest[] | undefined,
  kind: SettlementRequestKind,
): boolean {
  return (requests ?? []).some(
    (request) => request.kind === kind && request.status === 'pending',
  );
}

/** Requests still waiting on the office, newest first. */
export function openRequests(
  requests: DriverSettlementRequest[] | undefined,
): DriverSettlementRequest[] {
  return (requests ?? []).filter((request) => request.status === 'pending');
}

/**
 * Turning what a driver typed into minor units.
 *
 * **UGX is zero-decimal, so what they type _is_ the minor unit** — this never
 * multiplies by 100. Digits only: grouping separators, spaces and a stray
 * "UGX" are stripped rather than rejected, because a person typing money into
 * a phone types all three and being told off for it is not help.
 *
 * Returns null for anything that is not a positive whole number of shillings,
 * and the sheet keeps the button disabled rather than sending a 422.
 */
export function parseAmount(typed: string): number | null {
  const digits = typed.replace(/[^0-9]/g, '');

  if (digits === '') {
    return null;
  }

  const amount = Number.parseInt(digits, 10);

  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/* -------------------------------------------------------------------- *
 * Date ranges, for the transactions screen
 * -------------------------------------------------------------------- */

/** The filter chips, in the order the screen shows them. */
export type RangePreset = 'today' | 'week' | 'custom';

export function presetLabel(preset: RangePreset): string {
  return { today: 'Today', week: 'This week', custom: 'Custom' }[preset];
}

/**
 * `YYYY-MM-DD` from a `Date`, in the **device's own calendar day**.
 *
 * Built from the local parts rather than `toISOString()`, which converts to
 * UTC first: a driver in Kampala picking 16 August at 01:00 would have it
 * sent as the 15th, and they would get somebody else's day back.
 *
 * The server then measures that day in the *fleet's* timezone. The two agree
 * for a driver working where the fleet is, which is every driver — and where
 * they would not, the fleet's day is the right one, because that is the day
 * the office settles against.
 */
export function toDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The window a preset asks for.
 *
 * `today` is a single day at both ends — the server treats `to` inclusively,
 * so this returns the whole of today rather than nothing.
 *
 * `week` runs Monday to today rather than a rolling seven days: a driver
 * asking "this week" means the week they are in, and it matches the earnings
 * screen's week, which starts Monday for the same reason.
 */
export function presetRange(preset: RangePreset, now: Date = new Date()): LedgerRange {
  if (preset === 'today') {
    const key = toDateKey(now);

    return { from: key, to: key };
  }

  if (preset === 'week') {
    const monday = new Date(now);
    // `getDay()` is 0 on Sunday, which is 6 days into a Monday-first week.
    const offset = (monday.getDay() + 6) % 7;
    monday.setDate(monday.getDate() - offset);

    return { from: toDateKey(monday), to: toDateKey(now) };
  }

  // Custom carries no implicit window — the screen supplies both ends.
  return {};
}

/**
 * The range a custom selection produces, tolerant of the two dates arriving
 * in either order.
 *
 * A driver who sets the end date first and the start second has not made a
 * mistake, and the server refuses a backwards range with a 422 — so this
 * orders them rather than letting the screen send something it knows is
 * wrong.
 */
export function customRange(from: Date | null, to: Date | null): LedgerRange {
  if (from === null && to === null) {
    return {};
  }

  if (from !== null && to !== null) {
    return from <= to
      ? { from: toDateKey(from), to: toDateKey(to) }
      : { from: toDateKey(to), to: toDateKey(from) };
  }

  const only = (from ?? to) as Date;

  return { from: toDateKey(only), to: toDateKey(only) };
}

/** "15 Aug 2026", for the two buttons that open the picker. */
export function dateButtonLabel(date: Date | null): string {
  if (date === null) {
    return 'Pick a date';
  }

  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

/** What the list says when a filter matches nothing. */
export function emptyRangeMessage(preset: RangePreset): string {
  return preset === 'custom'
    ? 'Nothing in those dates.'
    : `Nothing ${preset === 'today' ? 'today' : 'this week'} yet.`;
}
