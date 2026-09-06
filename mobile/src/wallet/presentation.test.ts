import type { DriverLedgerEntry } from '../api/endpoints';
import {
  rowAmount,
  rowAnnouncement,
  rowDirection,
  rowTitle,
  rowWhen,
  statementRows,
} from './presentation';

/**
 * The wallet statement's wording and arithmetic.
 *
 * Most of these exist because the mockup asked for a transaction type this
 * platform does not have — Tip, Weekly Bonus, Withdrawal — or because the row
 * turns on a single character whose absence would be silent.
 */
function entry(overrides: Partial<DriverLedgerEntry> = {}): DriverLedgerEntry {
  return {
    id: 1,
    kind: 'fare_earned',
    kind_label: 'Fare earned',
    amount_minor: 8_000,
    currency: 'UGX',
    description: 'Fare for trip #412 at 20% commission',
    trip_id: 412,
    service_type: 'ride',
    created_at: '2026-08-15T10:45:00+03:00',
    ...overrides,
  };
}

describe('what a row is called', () => {
  it('says which kind of job earned it, where the trip says so', () => {
    expect(rowTitle(entry({ service_type: 'ride' }))).toBe('Ride earnings');
    expect(rowTitle(entry({ service_type: 'delivery' }))).toBe('Delivery earnings');
    expect(rowTitle(entry({ service_type: 'self_drive' }))).toBe('Self-drive earnings');
  });

  it('falls back to the server’s own words when nothing classified the trip', () => {
    // A walk-in a dispatcher fulfilled by hand: real earnings, no order
    // request, so it cannot be called a ride. "Fare earned" is still true.
    expect(rowTitle(entry({ service_type: null }))).toBe('Fare earned');
  });

  it('keeps cash collected under its plain name', () => {
    // The negative half of a completed cash trip. Softening it would hide the
    // one row that explains why the balance is usually negative.
    expect(
      rowTitle(entry({ kind: 'cash_collected', kind_label: 'Cash collected', service_type: 'ride' })),
    ).toBe('Cash collected');
  });

  /**
   * **Narrowed, not reversed.** The original read *"names a settlement without
   * calling it a withdrawal"*, on the grounds that `settlement` runs both ways
   * and is far more often cash remitted *to* the office — so the single word
   * names the rarer half. That objection was right about the **kind** and is
   * answered by naming the **sign**: each half now gets its own word and
   * neither is mislabelled.
   */
  it('names a settlement by its direction, so neither half is mislabelled', () => {
    const settlement = { kind: 'settlement' as const, kind_label: 'Settlement', service_type: null };

    // Money out to the driver — the mockup's row.
    expect(rowTitle(entry({ ...settlement, amount_minor: -50_000 }))).toBe('Withdrawal');
    // The common case, and it is not a withdrawal by any reading.
    expect(rowTitle(entry({ ...settlement, amount_minor: 40_000 }))).toBe('Cash handed over');
  });

  it('renders a service type it has never seen rather than a raw token', () => {
    expect(rowTitle(entry({ service_type: 'courier_run' }))).toBe('Courier Run earnings');
  });
});

describe('the money on a row', () => {
  it('draws the direction, unlike the balance, which carries it in words', () => {
    // Opposite rules on purpose: a balance is a standing state somebody
    // misreads at a glance, so its sign is stripped and `walletNote` says
    // which way. A row is a *movement*, and a movement with no direction is
    // not a movement.
    expect(rowAmount(entry({ amount_minor: 8_000 }))).toBe('+ UGX 8,000');
    expect(rowAmount(entry({ amount_minor: -10_000 }))).toBe('− UGX 10,000');
  });

  it('uses a true minus sign, not a hyphen', () => {
    // U+2212. Beside a "+" at a glance a hyphen is barely visible, and this
    // is the character the row turns on.
    expect(rowAmount(entry({ amount_minor: -10_000 }))).toContain('−');
    expect(rowAmount(entry({ amount_minor: -10_000 }))).not.toContain('-');
  });

  it('never divides a zero-decimal currency', () => {
    expect(rowAmount(entry({ amount_minor: 12_500 }))).toBe('+ UGX 12,500');
    expect(rowAmount(entry({ amount_minor: 12_500 }))).not.toBe('+ UGX 125');
  });

  it('shows the exact figure rather than the compact one', () => {
    // `compactMoney` hides up to 100 shillings inside a "K". Fine on a
    // glanceable tile, not on a statement somebody reconciles against.
    expect(rowAmount(entry({ amount_minor: 145_600 }))).toBe('+ UGX 145,600');
  });

  it('reports direction for the row’s colour, which is never the only signal', () => {
    expect(rowDirection(entry({ amount_minor: 8_000 }))).toBe('in');
    expect(rowDirection(entry({ amount_minor: -10_000 }))).toBe('out');
    expect(rowDirection(entry({ amount_minor: 0 }))).toBe('flat');
  });
});

describe('when it happened', () => {
  const now = new Date('2026-08-15T20:00:00+03:00');

  it('says "Today" for today, with a 12-hour time', () => {
    expect(rowWhen('2026-08-15T10:45:00+03:00', now)).toBe('Today, 10:45 AM');
    expect(rowWhen('2026-08-15T16:05:00+03:00', now)).toBe('Today, 04:05 PM');
  });

  it('gets midnight and noon right, which a bare modulus does not', () => {
    expect(rowWhen('2026-08-15T00:15:00+03:00', now)).toBe('Today, 12:15 AM');
    expect(rowWhen('2026-08-15T12:30:00+03:00', now)).toBe('Today, 12:30 PM');
  });

  /**
   * **An older row carries no time**, which is the mockup's shape and a real
   * distinction rather than a style: today's rows are read for *when in the
   * day*, an older one for *which day*, and a clock on it is noise on the
   * least important line in the row.
   */
  it('gives the date, and only the date, for anything older', () => {
    expect(rowWhen('2026-08-09T16:05:00+03:00', now)).toBe('August 9, 2026');
  });

  it('is an em dash when there is no timestamp, never a "just now"', () => {
    expect(rowWhen(null, now)).toBe('—');
    expect(rowWhen('not-a-date', now)).toBe('—');
  });
});

describe('the statement', () => {
  it('maps every entry, keeping the server’s order', () => {
    const rows = statementRows(
      [
        entry({ id: 2, amount_minor: 8_000 }),
        entry({
          id: 1,
          kind: 'cash_collected',
          kind_label: 'Cash collected',
          amount_minor: -10_000,
          description: 'Cash taken on trip #412; 2000 of it is commission at 20%',
        }),
      ],
      new Date('2026-08-15T20:00:00+03:00'),
    );

    expect(rows.map((row) => row.id)).toEqual([2, 1]);
    expect(rows[0]?.amount).toBe('+ UGX 8,000');
    expect(rows[1]?.amount).toBe('− UGX 10,000');
    // The server's explanation is shown, not paraphrased — it carries the
    // commission rate that actually applied (ADR-0029 §3).
    expect(rows[1]?.detail).toContain('commission at 20%');
  });

  it('shows both halves of a completed trip, so the statement explains the balance', () => {
    // Serving only the credit would make a prettier list that does not sum to
    // the balance above it — the same defect refused on the Earnings screen.
    const rows = statementRows([
      entry({ id: 2, amount_minor: 8_000 }),
      entry({ id: 1, kind: 'cash_collected', kind_label: 'Cash collected', amount_minor: -10_000 }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.direction)).toEqual(['in', 'out']);
  });

  it('has no rows before anything has loaded', () => {
    expect(statementRows(undefined)).toEqual([]);
  });

  /**
   * **This assertion is the one the mockup overturned, and it is replaced
   * rather than deleted** — because half of it was never about the mockup.
   *
   * It read *"has no tip, bonus or withdrawal row, because none exists"*, and
   * for each of the three the reason has now gone: tips and bonuses were built
   * (ADR-0034), and "Withdrawal" is a legitimate name for a *negative*
   * settlement.
   *
   * What has **not** changed is the part of that refusal that came from a rule
   * rather than from a missing feature: the mockup's row says *"Tip from Sarah
   * N."*, and ADR-0024 §7 releases a passenger's details to a driver only
   * while a trip is live. A wallet statement is permanent and scrollable — a
   * list of everyone who has ever tipped somebody, by name, is exactly the
   * directory that rule exists to prevent. That half is asserted here forever.
   */
  it('draws all three of the mockup’s rows, and never names the passenger', () => {
    const rows = statementRows([
      entry({ id: 1, kind: 'tip_earned', kind_label: 'Tip', service_type: 'ride' }),
      entry({ id: 2, kind: 'bonus', kind_label: 'Bonus', service_type: null }),
      entry({ id: 3, kind: 'settlement', kind_label: 'Settlement', amount_minor: -50_000 }),
    ]);

    expect(rows.map((row) => row.title)).toEqual(['Tip', 'Bonus', 'Withdrawal']);

    // The line the mockup draws and this app will not: no name, ever.
    for (const row of rows) {
      expect(row.title).not.toMatch(/from /i);
      expect(row.title).not.toContain('Sarah');
    }
  });
});

describe('the screen-reader sentence', () => {
  it('says the direction in words rather than leaning on a "+"', () => {
    // A screen reader may or may not announce "+".
    expect(rowAnnouncement(entry({ amount_minor: 8_000 }))).toContain('UGX 8,000 in your favour');
    expect(
      rowAnnouncement(
        entry({ kind: 'cash_collected', kind_label: 'Cash collected', amount_minor: -10_000 }),
      ),
    ).toContain('UGX 10,000 owed to the office');
  });

  it('never tells a driver they were paid the cash they handed over', () => {
    // **The bug rendering the screen caught.** A *positive* settlement is
    // cash the driver remitted at the depot — it reduces what they owe. The
    // first draft announced it as "UGX 40,000 to you", which says the office
    // paid them when they had just paid the office. The wording now describes
    // the effect on the balance, which is what a ledger row is, and stays
    // true for the one kind that runs both ways.
    const remitted = rowAnnouncement(
      entry({
        kind: 'settlement',
        kind_label: 'Settlement',
        amount_minor: 40_000,
        service_type: null,
        description: 'Cash remitted at the depot',
      }),
    );

    expect(remitted).toContain('UGX 40,000 in your favour');
    expect(remitted).not.toContain('to you');
  });

  it('is right about a settlement in the other direction too', () => {
    // The office paying the driver out: they have the money, so the balance
    // moves against them.
    expect(
      rowAnnouncement(
        entry({
          kind: 'settlement',
          kind_label: 'Settlement',
          amount_minor: -15_000,
          service_type: null,
          description: 'Paid out to the driver',
        }),
      ),
    ).toContain('UGX 15,000 owed to the office');
  });

  it('includes the server’s explanation of the row', () => {
    expect(rowAnnouncement(entry())).toContain('Fare for trip #412 at 20% commission');
  });
});

/**
 * Tips and bonuses on the statement (ADR-0034).
 */
describe('the tip pair and the bonus', () => {
  it('keeps the server’s words rather than renaming a tip after its trip', () => {
    // A tip hangs off a trip, so the `service_type` branch would otherwise
    // call it "Ride earnings" — the one place a gratuity could disappear
    // into a fare.
    expect(rowTitle(entry({ kind: 'tip_earned', kind_label: 'Tip', service_type: 'ride' })))
      .toBe('Tip');
    expect(
      rowTitle(entry({ kind: 'tip_cash_collected', kind_label: 'Cash from tip', service_type: 'ride' })),
    ).toBe('Cash from tip');
    expect(rowTitle(entry({ kind: 'bonus', kind_label: 'Bonus', service_type: null })))
      .toBe('Bonus');
  });

  it('shows the pair with its directions, so the net reads as the commission', () => {
    // 2,000 tip at 20%: +1,600 kept, −2,000 held, −400 owed.
    expect(rowAmount(entry({ kind: 'tip_earned', amount_minor: 1_600 }))).toBe('+ UGX 1,600');
    expect(rowAmount(entry({ kind: 'tip_cash_collected', amount_minor: -2_000 })))
      .toBe('− UGX 2,000');
  });

  it('announces a bonus as money in the driver’s favour', () => {
    const sentence = rowAnnouncement(
      entry({ kind: 'bonus', kind_label: 'Bonus', amount_minor: 20_000, service_type: null }),
    );

    expect(sentence).toContain('in your favour');
  });
});
