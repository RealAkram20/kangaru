import type { PeakHours, ReferralOffer, WeeklyChallenge } from '../api/endpoints';
import {
  challengeEnds,
  challengeFraction,
  challengeNote,
  challengeProgress,
  challengeReward,
  peakDay,
  peakHeadline,
  peakIsLive,
  peakWindow,
  referralCondition,
  referralReward,
  referralShareMessage,
  referralTally,
} from './presentation';

/**
 * The Promotions screen's presentation layer (ADR-0036, ADR-0037).
 *
 * Pure TypeScript over injected values, including the clock — a test that
 * reads the wall clock passes on a Tuesday and fails on a Sunday.
 */

const challenge = (over: Partial<WeeklyChallenge> = {}): WeeklyChallenge => ({
  trips: 18,
  tripTarget: 30,
  amountMinor: 50_000,
  currency: 'UGX',
  weekStart: '2026-08-10T00:00:00+03:00',
  endsAt: '2026-08-17T00:00:00+03:00',
  achieved: false,
  ...over,
});

const peak = (over: Partial<PeakHours> = {}): PeakHours => ({
  startsAt: '2026-08-12T17:00:00+03:00',
  endsAt: '2026-08-12T20:00:00+03:00',
  active: true,
  upliftPercent: 20,
  ...over,
});

const referral = (over: Partial<ReferralOffer> = {}): ReferralOffer => ({
  code: 'K7MTQ4RB',
  tripTarget: 10,
  rewardAmountMinor: 10_000,
  introduced: 0,
  qualified: 0,
  earnedMinor: 0,
  ...over,
});

// -- The weekly challenge --------------------------------------------------

describe('the weekly challenge', () => {
  it('states the reward in whole shillings, because UGX is zero-decimal', () => {
    expect(challengeReward(challenge())).toBe('UGX 50,000');
  });

  it('splits the count so the screen can weight the halves', () => {
    expect(challengeProgress(challenge())).toEqual({ done: '18', rest: '/ 30 trips' });
  });

  it('measures the bar as a fraction', () => {
    expect(challengeFraction(challenge({ trips: 15, tripTarget: 30 }))).toBe(0.5);
  });

  it('clamps a driver past the target rather than overflowing the track', () => {
    // The bar's job is "how close"; past the target the answer is "there", and
    // a fill wider than its track is a rendering bug rather than a fact.
    expect(challengeFraction(challenge({ trips: 34, tripTarget: 30 }))).toBe(1);
  });

  it('draws an empty bar for a target of zero rather than dividing by it', () => {
    expect(challengeFraction(challenge({ trips: 4, tripTarget: 0 }))).toBe(0);
  });

  it('counts whole days left, rounding up', () => {
    // Three and a half days remaining. Rounding down would tell a driver they
    // have less time to work than they do.
    const now = new Date('2026-08-13T12:00:00+03:00');

    expect(challengeEnds(challenge(), now)).toBe('Ends in 4 days');
  });

  it('says "Ends today" rather than "Ends in 0 days"', () => {
    // The last day of the week is the state that matters most to somebody two
    // trips short, so it gets a sentence rather than a zero.
    const now = new Date('2026-08-16T20:00:00+03:00');

    expect(challengeEnds(challenge(), now)).toBe('Ends today');
  });

  it('says nothing once the week has closed, rather than counting backwards', () => {
    const now = new Date('2026-08-18T09:00:00+03:00');

    expect(challengeEnds(challenge(), now)).toBeNull();
  });

  it('says nothing when the deadline is unreadable', () => {
    const now = new Date('2026-08-13T12:00:00+03:00');

    expect(challengeEnds(challenge({ endsAt: 'not a date' }), now)).toBeNull();
  });

  it('always says the money arrives after the week closes', () => {
    // The mockup implies the bonus accumulates. It does not — the award runs
    // over a *closed* week (ADR-0034 §4), so this sentence is the difference
    // between a progress bar and a promise.
    expect(challengeNote(challenge())).toContain('after the week closes');
  });

  it('congratulates a cleared target without claiming it has been paid', () => {
    const note = challengeNote(challenge({ trips: 30, achieved: true }));

    expect(note).toContain('Target reached');
    expect(note).toContain('after the week closes');
  });
});

// -- Peak hours ------------------------------------------------------------

describe('peak hours', () => {
  it('builds the headline from the served number, so it can be translated', () => {
    expect(peakHeadline(peak({ upliftPercent: 35 }))).toBe('Earn 35% more');
  });

  it('renders the window in the fleet timezone, not the handset one', () => {
    // The instants carry +03:00. Asked for Kampala they read 5 to 8 PM.
    expect(peakWindow(peak(), 'Africa/Kampala')).toBe('5:00 PM – 8:00 PM');
  });

  it('renders the same instants differently in a different fleet zone', () => {
    // The proof that the zone is doing work rather than being carried along:
    // London is two hours behind Kampala in August.
    expect(peakWindow(peak(), 'Europe/London')).toBe('3:00 PM – 6:00 PM');
  });

  it('renders an em dash rather than a plausible wrong time for a bad zone', () => {
    // A time derived from a zone the runtime did not recognise is a *wrong*
    // time, and a driver planning their evening on it would lose money.
    expect(peakWindow(peak(), 'Mars/Olympus_Mons')).toBe('—');
  });

  it('says "Today" when the window is today in the fleet zone', () => {
    expect(peakDay(peak(), 'Africa/Kampala', new Date('2026-08-12T09:00:00+03:00'))).toBe('Today');
  });

  it('says "Tomorrow" for a window resolved onto the next day', () => {
    expect(peakDay(peak(), 'Africa/Kampala', new Date('2026-08-11T22:00:00+03:00'))).toBe(
      'Tomorrow',
    );
  });

  it('says nothing rather than "Today" about a card left open overnight', () => {
    // The server resolved the window onto the day of the *request*, and this
    // screen caches and survives being backgrounded. "Today" about yesterday
    // would send a driver out for money that is not running.
    expect(peakDay(peak(), 'Africa/Kampala', new Date('2026-08-14T09:00:00+03:00'))).toBeNull();
  });

  it('decides the day in the fleet zone, not the handset one', () => {
    // 2026-08-12T00:30 Kampala is still 11 August in London. Kampala is the
    // zone that decides, because the window is the fleet's.
    expect(peakDay(peak(), 'Africa/Kampala', new Date('2026-08-11T21:30:00Z'))).toBe('Today');
  });

  it('says nothing for an unusable zone rather than guessing', () => {
    expect(peakDay(peak(), 'Mars/Olympus_Mons', new Date('2026-08-12T09:00:00+03:00'))).toBeNull();
  });

  it('is live inside the window', () => {
    expect(peakIsLive(peak(), new Date('2026-08-12T18:30:00+03:00'))).toBe(true);
  });

  it('stops being live at the closing instant, not after it', () => {
    // Half open, matching the server rule that decides the money.
    expect(peakIsLive(peak(), new Date('2026-08-12T20:00:00+03:00'))).toBe(false);
  });

  it('is not live before the window opens', () => {
    expect(peakIsLive(peak(), new Date('2026-08-12T16:59:00+03:00'))).toBe(false);
  });

  it('goes cold on a stale card whose active flag still says otherwise', () => {
    // The flag was true when the request was made. This screen caches for five
    // minutes and survives being backgrounded, so a card left open across 8 PM
    // would go on claiming the uplift was running after it had stopped.
    expect(peakIsLive(peak({ active: true }), new Date('2026-08-12T22:00:00+03:00'))).toBe(false);
  });

  it('falls back to the server flag when the instants are unreadable', () => {
    expect(peakIsLive(peak({ startsAt: 'nonsense', active: true }), new Date())).toBe(true);
  });
});

// -- Referrals -------------------------------------------------------------

describe('referrals', () => {
  it('states the reward in whole shillings', () => {
    expect(referralReward(referral(), 'UGX')).toBe('UGX 10,000');
  });

  it('states the condition in the plural', () => {
    expect(referralCondition(referral())).toBe('when they complete 10 trips');
  });

  it('does not say "1 trips" for a launch target of one', () => {
    // Not hypothetical: a fleet may well set this to 1 for a launch push, and
    // the broken plural would land on the one screen meant to persuade.
    expect(referralCondition(referral({ tripTarget: 1 }))).toBe(
      'when they complete their first trip',
    );
  });

  it('shows no tally at all for a driver who has referred nobody', () => {
    // Null rather than "0 introduced": this driver is being shown an offer,
    // not a record, and a zeroed count reads as failure at the moment the card
    // is trying to be inviting.
    expect(referralTally(referral(), 'UGX')).toBeNull();
  });

  it('says nobody has finished yet rather than implying money is coming', () => {
    expect(referralTally(referral({ introduced: 3 }), 'UGX')).toBe(
      '3 drivers joined · none have finished their trips yet',
    );
  });

  it('reports what has actually been earned', () => {
    expect(
      referralTally(referral({ introduced: 3, qualified: 2, earnedMinor: 20_000 }), 'UGX'),
    ).toBe('3 drivers joined · UGX 20,000 earned');
  });

  it('keeps the singular for one referral', () => {
    expect(referralTally(referral({ introduced: 1 }), 'UGX')).toBe(
      '1 driver joined · none have finished their trips yet',
    );
  });

  it('shares a message that promises the friend nothing', () => {
    const message = referralShareMessage(referral());

    expect(message).toContain('K7MTQ4RB');
    // The reward is the *referrer's*. A message implying the friend gets paid
    // would have a driver making a promise the platform will not keep.
    expect(message).not.toContain('10,000');
  });
});
