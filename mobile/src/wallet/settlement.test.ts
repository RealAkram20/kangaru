import type { DriverSettlementRequest } from '../api/endpoints';
import {
  customRange,
  dateButtonLabel,
  emptyRangeMessage,
  hasOpenRequest,
  kindAction,
  kindExplainer,
  SETTLEMENT_KINDS,
  openRequests,
  parseAmount,
  presetLabel,
  presetRange,
  requestAmount,
  requestNote,
  requestTitle,
  toDateKey,
} from './settlement';

/**
 * Settlement requests and date ranges.
 *
 * The cases that matter are the ones where being wrong costs money or a
 * driver's trust: an amount multiplied by a hundred, a day sent as the day
 * before, or a button that implies the app pays people.
 */
function request(overrides: Partial<DriverSettlementRequest> = {}): DriverSettlementRequest {
  return {
    id: 1,
    driver_id: 3,
    trip_id: null,
    kind: 'remittance',
    kind_label: 'Cash handed to the office',
    status: 'pending',
    status_label: 'Waiting for the office',
    amount_minor: 47_000,
    currency: 'UGX',
    note: 'Paid Musoke at Nakawa depot',
    decline_reason: null,
    reviewed_at: null,
    ledger_entry_id: null,
    created_at: '2026-08-15T10:45:00+03:00',
    ...overrides,
  };
}

describe('the two buttons', () => {
  /**
   * **Reversed by the owner, twice, and the safety half is kept.**
   *
   * This read *"says what actually happens, not 'Withdraw' and 'Add Money'"*,
   * on ADR-0032 §1's grounds: a driver is not depositing into an account this
   * platform holds, and there is nothing here to withdraw from.
   *
   * The mechanism is unchanged — both still raise a request the office
   * answers. What the labels must never imply is **immediacy**, and that is
   * now carried by the explainer and the button's accessibility hint rather
   * than by the label itself. The test below pins it, and it is the one that
   * matters.
   */
  it('uses the mockup’s labels, which read correctly against the balance', () => {
    // `payout` moves the balance down, `remittance` moves it up — which is
    // exactly what these two words describe.
    expect(kindAction('payout')).toBe('Withdraw');
    expect(kindAction('remittance')).toBe('Add Money');
  });

  it('never lets a short label imply the money has already moved', () => {
    // The property the old wording protected, protected by the explainer
    // instead. Both sentences a driver reads before typing a figure.
    for (const kind of ['remittance', 'payout'] as const) {
      // Case-insensitive: one of the two sentences starts with it.
      expect(kindExplainer(kind)).toMatch(/nothing is transferred by this app/i);
    }
  });

  it('warns that nothing is transferred by the app', () => {
    // A driver who believes tapping a button pays them is a driver who stops
    // trusting the app the first time nothing arrives.
    expect(kindExplainer('remittance')).toContain('not now');
    expect(kindExplainer('payout')).toContain('nothing is transferred by this app');
  });

  it('orders the buttons as the mockup draws them', () => {
    // Withdraw, then Add Money — the two directions the balance can move,
    // read left to right.
    expect([...SETTLEMENT_KINDS]).toEqual(['payout', 'remittance']);
  });
});

describe('a driver’s own requests', () => {
  it('says a pending request has not moved the balance', () => {
    // The safety property, said out loud on the screen: a request changes
    // nothing until a human confirms it.
    expect(requestNote(request())).toContain('has not changed yet');
  });

  it('says a confirmed one is in the balance', () => {
    expect(requestNote(request({ status: 'confirmed' }))).toContain('in your balance');
  });

  it('always shows the office’s reason for a decline', () => {
    expect(
      requestNote(
        request({ status: 'declined', decline_reason: 'No cash was received on that date.' }),
      ),
    ).toBe('No cash was received on that date.');
  });

  it('still says something if a decline somehow arrived with no reason', () => {
    // The server makes the reason mandatory, so this cannot happen — and a
    // blank line where an explanation belongs would be the worst way to find
    // out that it had.
    expect(requestNote(request({ status: 'declined', decline_reason: null }))).toBe(
      'The office declined this.',
    );
  });

  it('names the two kinds plainly', () => {
    expect(requestTitle(request({ kind: 'remittance' }))).toBe('Cash handed over');
    expect(requestTitle(request({ kind: 'payout' }))).toBe('Payout requested');
  });

  it('shows the exact amount, never a rounded one', () => {
    expect(requestAmount(request({ amount_minor: 145_600 }))).toBe('UGX 145,600');
  });

  it('knows when a kind already has one waiting', () => {
    const rows = [request({ kind: 'remittance', status: 'pending' })];

    expect(hasOpenRequest(rows, 'remittance')).toBe(true);
    expect(hasOpenRequest(rows, 'payout')).toBe(false);
    expect(hasOpenRequest(undefined, 'remittance')).toBe(false);
  });

  it('does not count an answered request as still open', () => {
    const rows = [
      request({ id: 1, kind: 'payout', status: 'confirmed' }),
      request({ id: 2, kind: 'payout', status: 'declined' }),
    ];

    expect(hasOpenRequest(rows, 'payout')).toBe(false);
    expect(openRequests(rows)).toEqual([]);
  });
});

describe('the amount a driver types', () => {
  it('never multiplies by a hundred, because UGX is zero-decimal', () => {
    // What they type *is* the minor unit. Multiplying would send 4,700,000
    // to the office for a 47,000 handover.
    expect(parseAmount('47000')).toBe(47_000);
  });

  it('accepts the separators a person actually types', () => {
    expect(parseAmount('47,000')).toBe(47_000);
    expect(parseAmount('UGX 47 000')).toBe(47_000);
  });

  it('refuses nothing, zero and rubbish rather than sending a 422', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
});

describe('date keys', () => {
  it('uses the device’s own calendar day, not UTC', () => {
    // `toISOString()` converts to UTC first: 01:00 on the 16th in Kampala
    // would be sent as the 15th, and the driver would get somebody else's
    // day back.
    const justAfterMidnight = new Date(2026, 7, 16, 1, 0, 0);

    expect(toDateKey(justAfterMidnight)).toBe('2026-08-16');
  });

  it('pads single-digit months and days', () => {
    expect(toDateKey(new Date(2026, 0, 3))).toBe('2026-01-03');
  });
});

describe('the filter presets', () => {
  it('labels the three chips', () => {
    expect(presetLabel('today')).toBe('Today');
    expect(presetLabel('week')).toBe('This week');
    expect(presetLabel('custom')).toBe('Custom');
  });

  it('asks for the whole of today at both ends', () => {
    // The server treats `to` inclusively, so a single day returns that day
    // rather than nothing.
    const saturday = new Date(2026, 7, 15, 20, 0, 0);

    expect(presetRange('today', saturday)).toEqual({ from: '2026-08-15', to: '2026-08-15' });
  });

  it('runs the week from Monday, matching the earnings screen', () => {
    // Saturday 15 August 2026; the week began Monday the 10th.
    const saturday = new Date(2026, 7, 15, 20, 0, 0);

    expect(presetRange('week', saturday)).toEqual({ from: '2026-08-10', to: '2026-08-15' });
  });

  it('treats Sunday as the end of its week, not the start of the next', () => {
    // The off-by-one that a naive `getDay()` produces: Sunday is 0, which
    // would make it Monday and return a week that has not begun.
    const sunday = new Date(2026, 7, 16, 12, 0, 0);

    expect(presetRange('week', sunday)).toEqual({ from: '2026-08-10', to: '2026-08-16' });
  });

  it('leaves custom without an implicit window', () => {
    expect(presetRange('custom')).toEqual({});
  });
});

describe('a custom range', () => {
  it('sends the two dates in order', () => {
    expect(customRange(new Date(2026, 7, 1), new Date(2026, 7, 15))).toEqual({
      from: '2026-08-01',
      to: '2026-08-15',
    });
  });

  it('orders them even when the driver picked the end first', () => {
    // Not a mistake on their part — and the server refuses a backwards range
    // with a 422, so sending it unsorted would fail for no reason.
    expect(customRange(new Date(2026, 7, 15), new Date(2026, 7, 1))).toEqual({
      from: '2026-08-01',
      to: '2026-08-15',
    });
  });

  it('treats one date as that single day', () => {
    expect(customRange(new Date(2026, 7, 9), null)).toEqual({
      from: '2026-08-09',
      to: '2026-08-09',
    });
  });

  it('is an empty window until something is picked', () => {
    expect(customRange(null, null)).toEqual({});
  });
});

describe('the picker buttons and the empty state', () => {
  it('reads a date the way a person says it', () => {
    expect(dateButtonLabel(new Date(2026, 7, 15))).toBe('15 Aug 2026');
    expect(dateButtonLabel(null)).toBe('Pick a date');
  });

  it('says which filter found nothing', () => {
    expect(emptyRangeMessage('today')).toBe('Nothing today yet.');
    expect(emptyRangeMessage('week')).toBe('Nothing this week yet.');
    expect(emptyRangeMessage('custom')).toBe('Nothing in those dates.');
  });
});

/**
 * Tips (ADR-0034). What a driver is told before they type a figure, and what
 * the row is called afterwards.
 */
describe('declaring a tip', () => {
  it('reports a tip rather than sounding like it creates one', () => {
    // "Add a tip" would read as making money appear. The driver is reporting
    // cash a passenger already handed them.
    expect(kindAction('tip')).toBe('A passenger tipped me');
  });

  it('says commission applies, so the balance is not a surprise', () => {
    // The owner ruled that the platform takes its usual cut. A driver who
    // learns that from their balance instead of from this sentence has been
    // ambushed by a rule.
    expect(kindExplainer('tip')).toContain('Commission applies');
  });

  it('never prints the commission rate, which is a runtime setting', () => {
    // A handset that stated "20%" would go on stating it after the office
    // changed the number — the defect the audit pass recorded as finding 5.
    expect(kindExplainer('tip')).not.toMatch(/\d+\s*%/);
  });

  it('says the balance moves on confirmation and not before', () => {
    expect(kindExplainer('tip')).toContain('not now');
  });

  it('names the trip on a declaration, never the passenger', () => {
    // ADR-0024 §7 and ADR-0034 §6. The mockup said "Tip from Sarah N."; a
    // wallet statement is permanent and scrollable.
    expect(requestTitle(request({ kind: 'tip', trip_id: 412 }))).toBe('Tip on trip #412');
    expect(requestTitle(request({ kind: 'tip', trip_id: null }))).toBe('Tip declared');
  });
});
