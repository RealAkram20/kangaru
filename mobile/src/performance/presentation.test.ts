import type { DriverPerformance } from '../api/endpoints';
import {
  bonusNote,
  dialCaption,
  dialsFor,
  fractionOf,
  gridNote,
  headingNote,
  hoursLabel,
  percentLabel,
  ratingLabel,
} from './presentation';

/**
 * The Performance screen's arithmetic.
 *
 * Almost every case here is about the same thing: **an arc is a fraction of
 * something real, or there is no arc.** The mockup drew two rings against
 * nothing, and the failure mode this suite exists to prevent is a
 * well-meaning simplification that turns an absent denominator back into a
 * zero — at which point the screen starts telling a driver they achieved none
 * of a target nobody set them.
 */
function performance(overrides: Partial<DriverPerformance> = {}): DriverPerformance {
  return {
    acceptance_rate: 92,
    completion_rate: 96,
    cancellation_rate: 3,
    rating: 4.8,
    rating_count: 40,
    window_days: 30,
    trips_total: 428,
    week_start: '2026-08-10',
    timezone: 'Africa/Kampala',
    trips_this_week: 28,
    online_seconds_this_week: 26_400,
    rostered_seconds_this_week: 45 * 3600,
    bonus: {
      trips: 28,
      trip_target: 30,
      amount_minor: 20000,
      currency: 'UGX',
      week_start: '2026-08-10T00:00:00+03:00',
      ends_at: '2026-08-17T00:00:00+03:00',
      achieved: false,
    },
    ...overrides,
  };
}

describe('fractionOf', () => {
  it('is null when there is no denominator, never zero', () => {
    // The whole point. A null denominator means "there is nothing to be a
    // fraction of"; returning 0 would draw an empty ring, which is a
    // measurement — it says the driver achieved none of it.
    expect(fractionOf(28, null)).toBeNull();
    expect(fractionOf(28, undefined)).toBeNull();
    expect(fractionOf(28, 0)).toBeNull();
    expect(fractionOf(28, -5)).toBeNull();
  });

  it('is null when the figure itself is missing', () => {
    expect(fractionOf(null, 30)).toBeNull();
    expect(fractionOf(undefined, 30)).toBeNull();
  });

  it('saturates rather than wrapping past a full ring', () => {
    // 50 hours worked against a 40-hour roster. An arc past 360° wraps and
    // reads as having barely started, which is the opposite of the truth.
    expect(fractionOf(50, 40)).toBe(1);
  });

  it('measures the ordinary case', () => {
    expect(fractionOf(28, 30)).toBeCloseTo(0.9333, 3);
    expect(fractionOf(0, 30)).toBe(0);
  });
});

describe('labels', () => {
  it('renders an em dash rather than a zero for every absent figure', () => {
    expect(percentLabel(null)).toBe('—');
    expect(ratingLabel(null)).toBe('—');
    expect(hoursLabel(null)).toBe('—');
    // A driver on their first shift has no acceptance rate. "0%" reads as a
    // failing grade for having done nothing wrong.
    expect(percentLabel(undefined)).toBe('—');
  });

  it('rounds a rate to whole numbers but keeps the rating to one decimal', () => {
    expect(percentLabel(92.3)).toBe('92%');
    expect(percentLabel(96)).toBe('96%');
    // 4.8, not 4.80 and not 5.
    expect(ratingLabel(4.8)).toBe('4.8');
    expect(ratingLabel(5)).toBe('5.0');
  });

  it('renders hours the way the mockup does', () => {
    expect(hoursLabel(26_400)).toBe('7h 20m');
    expect(hoursLabel(2_700)).toBe('45m');
    // Zero seconds is a real measurement — a driver who went on duty and
    // straight off again — and is not the same as no figure.
    expect(hoursLabel(0)).toBe('0m');
  });
});

describe('dialsFor', () => {
  it('draws six dials in the mockup\'s order', () => {
    expect(dialsFor(performance()).map((d) => d.key)).toEqual([
      'rating',
      'acceptance',
      'completion',
      'cancellation',
      'trips-week',
      'online-hours',
    ]);
  });

  it('measures the rating out of five and the rates out of a hundred', () => {
    const dials = dialsFor(performance());

    expect(dials[0]!.fraction).toBeCloseTo(0.96, 3);
    expect(dials[1]!.fraction).toBeCloseTo(0.92, 3);
    expect(dials[2]!.fraction).toBeCloseTo(0.96, 3);
    expect(dials[3]!.fraction).toBeCloseTo(0.03, 3);
  });

  it('marks only cancellation as a dial where more is worse', () => {
    const dials = dialsFor(performance());

    expect(dials.filter((d) => d.inverted === true).map((d) => d.key)).toEqual(['cancellation']);
  });

  it('draws no arc on trips this week when no bonus target exists', () => {
    // The default state of the platform: `billing.bonus_enabled` is false, so
    // the server sends `bonus: null`. The count is still true and is still
    // shown; what is absent is the ceiling.
    const dials = dialsFor(performance({ bonus: null }));
    const trips = dials.find((d) => d.key === 'trips-week')!;

    expect(trips.value).toBe('28');
    expect(trips.fraction).toBeNull();
  });

  it('draws no arc on online hours for a driver with no roster', () => {
    // ADR-0017 §3: no shift windows means available at any hour, which is not
    // a number. The figure stands on its own.
    const dials = dialsFor(performance({ rostered_seconds_this_week: null }));
    const hours = dials.find((d) => d.key === 'online-hours')!;

    expect(hours.value).toBe('7h 20m');
    expect(hours.fraction).toBeNull();
  });

  it('shows em dashes and no arcs before anything has loaded', () => {
    const dials = dialsFor(undefined);

    expect(dials).toHaveLength(6);
    expect(dials.every((d) => d.value === '—')).toBe(true);
    expect(dials.every((d) => d.fraction === null)).toBe(true);
  });

  it('never names the rating threshold, only the count', () => {
    const dials = dialsFor(performance({ rating: null, rating_count: 2 }));
    const rating = dials.find((d) => d.key === 'rating')!;

    expect(rating.value).toBe('—');
    expect(rating.announcement).toContain('2 ratings so far');
    // Five is the server's threshold (ADR-0030 §3) and is not in this
    // payload. A handset that stated it would go on asserting five after the
    // office argued it down to three.
    expect(rating.announcement).not.toContain('5');
  });

  it('composes one sentence per dial rather than leaving a grid to linearise', () => {
    const dials = dialsFor(performance());

    expect(dials[1]!.announcement).toBe('Acceptance rate 92 percent over the last 30 days.');
    expect(dials[4]!.announcement).toBe('28 of 30 trips completed this week.');
    expect(dials[5]!.announcement).toBe('Online 7h 20m this week, of 45h rostered.');
  });
});

describe('captions', () => {
  it('spells out the denominator on the two dials that have a non-obvious one', () => {
    const p = performance();
    const dials = dialsFor(p);

    expect(dialCaption(dials.find((d) => d.key === 'trips-week')!, p)).toBe('of 30');
    expect(dialCaption(dials.find((d) => d.key === 'online-hours')!, p)).toBe('of 45h');
    // The four rate dials need none — a percentage carries its own.
    expect(dialCaption(dials.find((d) => d.key === 'acceptance')!, p)).toBeNull();
  });

  it('has no caption where there is no denominator', () => {
    const p = performance({ bonus: null, rostered_seconds_this_week: null });
    const dials = dialsFor(p);

    expect(dialCaption(dials.find((d) => d.key === 'trips-week')!, p)).toBeNull();
    expect(dialCaption(dials.find((d) => d.key === 'online-hours')!, p)).toBeNull();
  });
});

describe('the words on the screen', () => {
  it('praises with a figure the driver earned rather than a judgement', () => {
    // The mockup said "Great job! Keep it up." — a judgement this app has not
    // assessed, and one it would say identically to a driver at 40%
    // acceptance.
    expect(headingNote(performance())).toBe('428 trips completed, all time.');
    expect(headingNote(performance({ trips_total: 1 }))).toBe('1 trip completed, all time.');
  });

  it('says something useful to a driver who has not started', () => {
    expect(headingNote(performance({ trips_total: 0 }))).toContain('once you have completed a trip');
  });

  it('keeps every line short enough to be read at a glance', () => {
    // The screen was carrying thirty-five words of prose under six labelled
    // rings. This is not style policing: a driver reads this in a cradle, and
    // a paragraph there is a paragraph nobody reads.
    //
    // **Twelve, not fifteen.** Fifteen was the first number written here and it
    // was worthless: the fourteen-word sentence this pass shortened
    // ("You have hit this week's target. The bonus is credited after the week
    // closes.") passed it, so the guard could not fail for the regression it
    // exists to catch. Twelve is the longest line that survived, which makes
    // this a ratchet rather than a formality.
    const words = (line: string): number => line.trim().split(/\s+/).length;

    expect(words(gridNote(performance()))).toBeLessThanOrEqual(12);
    expect(words(headingNote(performance()))).toBeLessThanOrEqual(12);
    expect(words(headingNote(performance({ trips_total: 0 })))).toBeLessThanOrEqual(12);
    expect(words(bonusNote(performance())!)).toBeLessThanOrEqual(12);
    expect(
      words(bonusNote(performance({ bonus: { ...performance().bonus!, achieved: true } }))!),
    ).toBeLessThanOrEqual(12);
  });

  it('counts the trips still needed for the bonus', () => {
    expect(bonusNote(performance())).toBe('Complete 2 more trips to reach your weekly bonus.');
    expect(bonusNote(performance({ bonus: { ...performance().bonus!, trips: 29 } }))).toBe(
      'Complete 1 more trip to reach your weekly bonus.',
    );
  });

  it('does not tell a driver they have the money before the week closes', () => {
    const note = bonusNote(
      performance({ bonus: { ...performance().bonus!, trips: 30, achieved: true } }),
    );

    // `achieved` means the count is there, not that anything has been paid.
    // ADR-0034 §4 awards over a *closed* week, and a driver told they have
    // been paid before they have is the money lie this codebase exists to
    // avoid.
    expect(note).toContain('after the week closes');
    expect(note).not.toContain('earned');
  });

  it('does not claim a window the server does not apply to the rating', () => {
    // `DriverStatsService::rating()` averages the most recent *ratings* — a
    // sample, with no date filter in the query. The line this replaced read
    // "Rating, acceptance, completion and cancellation are measured over the
    // last 30 days", which asserted a window on a figure that has none. Put
    // the rating back into this sentence and the screen is lying about how its
    // own headline number is computed.
    expect(gridNote(performance())).not.toMatch(/rating/i);
    expect(gridNote(performance())).toContain('Rates cover the last 30 days.');
  });

  it('explains the roster only where there is one', () => {
    // "of 45h" under a ring says nothing about where 45h came from.
    expect(gridNote(performance())).toContain('Hours are measured against your roster.');

    // ADR-0017 §3: no shift windows means available at any hour. There is no
    // roster to explain, and the sentence would be about nothing.
    expect(gridNote(performance({ rostered_seconds_this_week: null }))).toBe(
      'Rates cover the last 30 days.',
    );
  });

  it('holds the line while the figures are loading', () => {
    // A space rather than an empty string, so the card below does not jump
    // upward the moment the payload lands.
    expect(gridNote(undefined)).toBe(' ');
  });

  it('has no bonus note at all when the scheme is off', () => {
    expect(bonusNote(performance({ bonus: null }))).toBeNull();
    expect(bonusNote(undefined)).toBeNull();
  });
});
