import type { DriverStats } from '../api/endpoints';
import { money, ratingNote, ratingValue, walletNote, walletValue } from './statsPresentation';

/**
 * The home screen's numbers.
 *
 * Every case here corresponds to a bug that was actually shipping. The screen
 * carried these helpers inline with no tests at all, and two of them were
 * wrong in ways nobody could see: a money formatter that divided a
 * zero-decimal currency by 100, and a read of two fields the server had
 * renamed. Both printed something plausible-looking rather than failing.
 */

function stats(overrides: Partial<DriverStats> = {}): DriverStats {
  return {
    trips_today: 4,
    earnings_today_minor: 20_500,
    wallet_balance_minor: 0,
    currency: 'UGX',
    acceptance_rate: 92,
    completion_rate: 100,
    rating: 4.8,
    rating_count: 37,
    window_days: 30,
    ...overrides,
  };
}

describe('money', () => {
  it('treats UGX as whole shillings and never divides', () => {
    // The bug this file exists for. UGX is zero-decimal (AGENTS.md money
    // rules), so dividing by 100 renders a 20,500-shilling day as "UGX 205"
    // — plausible enough that nobody queries it, and wrong by two orders of
    // magnitude on the figure a driver opens the app for.
    expect(money(20_500, 'UGX')).toBe('UGX 20,500');
  });

  it('renders an em dash when the figure has not arrived', () => {
    // Not a zero. `UGX 0` reads as a day with no work; a driver whose stats
    // have not loaded has not had one.
    expect(money(undefined, 'UGX')).toBe('—');
    expect(money(20_500, undefined)).toBe('—');
  });

  it('renders an em dash rather than NaN for a field the server renamed', () => {
    // Exactly what shipped: `stats.fares_today_minor` was `undefined` after
    // ADR-0029 renamed it, and `Math.trunc(undefined / 100)` put
    // "undefined NaN" on the home screen where the money goes.
    expect(money(Number.NaN, 'UGX')).toBe('—');
  });

  it('keeps a negative balance negative', () => {
    // A driver holding the office's cash. Hiding the sign would reverse the
    // meaning of the one figure a settlement conversation starts from.
    expect(money(-40_000, 'UGX')).toBe('UGX -40,000');
  });
});

describe('ratingValue', () => {
  it('shows the score to one decimal', () => {
    expect(ratingValue(stats())).toBe('4.8');
  });

  it('shows an em dash while the score is withheld', () => {
    // Null below five ratings (ADR-0030 §3) — the server's decision, not the
    // app's. Nothing here re-implements the threshold.
    expect(ratingValue(stats({ rating: null }))).toBe('—');
    expect(ratingValue(undefined)).toBe('—');
  });
});

describe('ratingNote', () => {
  it('says what the score rests on', () => {
    expect(ratingNote(stats())).toBe('37 ratings');
    expect(ratingNote(stats({ rating: 5, rating_count: 1 }))).toBe('1 rating');
  });

  it('turns a withheld score into "counting" rather than a silent dash', () => {
    // A dash with no explanation, on a number that can end a driver's income,
    // invites them to assume the worst.
    expect(ratingNote(stats({ rating: null, rating_count: 2 }))).toBe('2 ratings so far');
    expect(ratingNote(stats({ rating: null, rating_count: 1 }))).toBe('1 rating so far');
    expect(ratingNote(stats({ rating: null, rating_count: 0 }))).toBe('No ratings yet');
  });

  it('never names the threshold, which is the server\'s rule and not in the payload', () => {
    // "2 of 5 needed" read better and would have gone stale silently: five is
    // `DriverStatsService`'s number (ADR-0030 §3), it is not sent, and every
    // installed handset would keep asserting it after the office changed it.
    for (const count of [0, 1, 2, 4]) {
      expect(ratingNote(stats({ rating: null, rating_count: count }))).not.toMatch(/\b5\b/);
    }
  });
});

describe('walletValue', () => {
  it('shows a debt without a minus sign', () => {
    // The change this pair exists for. "UGX -4,500" was read as a possible
    // bug by the first person to see it — a minus is easy to miss, and once
    // noticed it still does not say which way the debt runs. The magnitude
    // goes here and the direction goes in `walletNote`, in words.
    expect(walletValue(stats({ wallet_balance_minor: -4_500 }))).toBe('UGX 4,500');
  });

  it('shows credit and debt identically, so only the words distinguish them', () => {
    const owed = walletValue(stats({ wallet_balance_minor: 4_500 }));
    const owing = walletValue(stats({ wallet_balance_minor: -4_500 }));

    expect(owed).toBe(owing);

    // Which is exactly why the note must never be dropped from the card.
    expect(walletNote(stats({ wallet_balance_minor: 4_500 }))).not.toBe(
      walletNote(stats({ wallet_balance_minor: -4_500 })),
    );
  });

  /**
   * **Reversed, and the codebase's own rule is why.** This read *"shortens a
   * large balance"* and expected `UGX 145.6K`.
   *
   * `compactMoney` permits itself only on "a glanceable total" and refuses
   * itself on "the number a driver accepts a job for and gets paid", because a
   * `K` hides up to a hundred shillings. A **balance** is the second kind: it
   * is what a driver takes to the depot and reconciles against the office's
   * figure, and a settlement conversation that starts from a rounded number
   * starts from an argument.
   *
   * Reading the wallet mockup is what surfaced it — the card draws
   * *UGX 135,000* in full.
   */
  it('shows a large balance exactly, because it is reconciled and not glanced at', () => {
    expect(walletValue(stats({ wallet_balance_minor: -145_600 }))).toBe('UGX 145,600');
    expect(walletValue(stats({ wallet_balance_minor: 135_000 }))).toBe('UGX 135,000');

    // Still no sign — the direction is `walletNote`'s job, and now the
    // wallet card's heading too.
    expect(walletValue(stats({ wallet_balance_minor: -145_600 }))).not.toContain('-');
  });

  it('does not claim a balance before one has loaded', () => {
    expect(walletValue(undefined)).toBe('—');
  });
});

describe('walletNote', () => {
  it('says which way the money points in plain words', () => {
    // ADR-0029 §5, and now the *only* carrier of direction — the figure above
    // it has no sign at all.
    expect(walletNote(stats({ wallet_balance_minor: 40_000 }))).toBe('The office owes you');
    expect(walletNote(stats({ wallet_balance_minor: -40_000 }))).toBe('You owe the office');
    expect(walletNote(stats({ wallet_balance_minor: 0 }))).toBe('Settled up');
  });

  it('does not claim a balance before one has loaded', () => {
    expect(walletNote(undefined)).toBe('Not loaded yet');
  });
});
