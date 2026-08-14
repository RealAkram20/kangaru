import type { TripEvent, TripPayment } from '../api/types';
import {
  durationAnnouncement,
  formatTripDuration,
  startedAtFrom,
  tripPaymentLabel,
  waitingSecondsFrom,
} from './progress';

function event(to: TripEvent['to_status'], createdAt: string | null): TripEvent {
  return {
    id: 1,
    trip_id: 1,
    from_status: null,
    to_status: to,
    user_id: null,
    notes: null,
    created_at: createdAt,
  };
}

function payment(overrides: Partial<TripPayment> = {}): TripPayment {
  return { payment_method: null, payer: null, ...overrides };
}

describe('startedAtFrom', () => {
  it('reads the start off the timeline, not off any other transition', () => {
    const events = [
      event('driver_arrived', '2026-08-14T09:15:00Z'),
      event('passenger_onboard', '2026-08-14T09:17:00Z'),
      event('trip_started', '2026-08-14T09:18:00Z'),
      event('waiting', '2026-08-14T09:40:00Z'),
    ];

    expect(startedAtFrom(events)).toBe(Date.parse('2026-08-14T09:18:00Z'));
  });

  it('is null while the timeline has not arrived', () => {
    // A 00:00 here would tell a driver forty minutes into a journey that they
    // had just pulled away.
    expect(startedAtFrom(undefined)).toBeNull();
    expect(startedAtFrom([])).toBeNull();
    expect(startedAtFrom([event('driver_arrived', '2026-08-14T09:15:00Z')])).toBeNull();
  });

  it('ignores a start with no timestamp or an unparseable one', () => {
    expect(startedAtFrom([event('trip_started', null)])).toBeNull();
    expect(startedAtFrom([event('trip_started', 'not a date')])).toBeNull();
  });
});

describe('formatTripDuration', () => {
  it('is mm:ss under an hour', () => {
    expect(formatTripDuration(842)).toBe('14:02');
    expect(formatTripDuration(9)).toBe('00:09');
    expect(formatTripDuration(0)).toBe('00:00');
  });

  it('grows an hours field rather than letting minutes run past sixty', () => {
    // The difference from waiting.ts's formatElapsed, and the reason this is a
    // separate function: an upcountry run of an hour and a quarter is ordinary,
    // and "75:20" reads as a fault rather than a duration.
    expect(formatTripDuration(3600)).toBe('1:00:00');
    expect(formatTripDuration(4_209)).toBe('1:10:09');
    expect(formatTripDuration(45_296)).toBe('12:34:56');
  });

  it('floors a negative to zero rather than rendering a minus', () => {
    expect(formatTripDuration(-30)).toBe('00:00');
  });
});

describe('durationAnnouncement', () => {
  it('speaks hours and minutes, and drops the seconds', () => {
    // A screen reader re-announcing a second every second is unusable; the
    // question asked out loud is "roughly how long have I been driving".
    expect(durationAnnouncement(4_209)).toBe('Elapsed trip time 1 hour 10 minutes.');
    expect(durationAnnouncement(842)).toBe('Elapsed trip time 14 minutes.');
    expect(durationAnnouncement(7_200)).toBe('Elapsed trip time 2 hours.');
  });

  it('still says something for a trip under a minute old', () => {
    expect(durationAnnouncement(20)).toBe('Elapsed trip time 0 minutes.');
  });

  it('says so plainly when there is no figure', () => {
    expect(durationAnnouncement(null)).toBe('Elapsed trip time is not available yet.');
  });
});

describe('tripPaymentLabel', () => {
  it('names the methods this platform actually supports', () => {
    expect(tripPaymentLabel(payment({ payment_method: 'cash' }))).toBe('Cash');
    expect(tripPaymentLabel(payment({ payment_method: 'mobile_money' }))).toBe('Mobile money');
    expect(tripPaymentLabel(payment({ payment_method: 'card' }))).toBe('Card');
  });

  it('never turns "nobody said" into "Cash"', () => {
    // The one that costs a driver real money: they arrive with no float, are
    // offered a transfer to a wallet they do not have, and the job stalls in
    // front of the customer.
    expect(tripPaymentLabel(payment())).toBeNull();
    expect(tripPaymentLabel(null)).toBeNull();
  });

  it('renders an unknown method as nothing rather than as its raw token', () => {
    // The mockup asked for "Applepay". It is not a method this platform has,
    // and `payment_method` is a raw string off a JSON column, so a value this
    // build has never seen is a real possibility rather than a hypothetical.
    expect(tripPaymentLabel(payment({ payment_method: 'applepay' }))).toBeNull();
    expect(tripPaymentLabel(payment({ payment_method: 'airtel_money' }))).toBeNull();
  });
});

describe('waitingSecondsFrom', () => {
  const NOW = Date.parse('2026-08-14T10:00:00Z');

  it('is zero on a trip that has never been paused', () => {
    expect(waitingSecondsFrom([event('trip_started', '2026-08-14T09:18:00Z')], NOW)).toBe(0);
    expect(waitingSecondsFrom(undefined, NOW)).toBe(0);
  });

  it('closes a period on trip_resumed, the one exit the graph allows today', () => {
    const events = [
      event('trip_started', '2026-08-14T09:18:00Z'),
      event('waiting', '2026-08-14T09:30:00Z'),
      event('trip_resumed', '2026-08-14T09:34:00Z'),
    ];

    expect(waitingSecondsFrom(events, NOW)).toBe(240);
  });

  it('closes a period on any transition, not only on trip_resumed', () => {
    // `waiting -> cancelled` is not legal today, and that is the point: the
    // timeline is data, and a reader that waits specifically for
    // `trip_resumed` runs the period on forever the day the lifecycle gains a
    // second exit. `WaitingTimeCalculator` says so in its own comment and this
    // mirrors it.
    //
    // Written after a mutation survived: the case above uses `trip_resumed`
    // as the next event, so narrowing the code to `trip_resumed` passed it.
    // The test was named for a behaviour it never exercised.
    const events = [
      event('waiting', '2026-08-14T09:30:00Z'),
      event('cancelled', '2026-08-14T09:33:00Z'),
    ];

    expect(waitingSecondsFrom(events, NOW)).toBe(180);
  });

  it('sums every period across a trip held more than once', () => {
    const events = [
      event('trip_started', '2026-08-14T09:18:00Z'),
      event('waiting', '2026-08-14T09:30:00Z'),
      event('trip_resumed', '2026-08-14T09:34:00Z'),
      event('waiting', '2026-08-14T09:40:00Z'),
      event('trip_resumed', '2026-08-14T09:41:30Z'),
    ];

    expect(waitingSecondsFrom(events, NOW)).toBe(240 + 90);
  });

  it('counts the pause that is still running, measured against now', () => {
    // The one deliberate difference from WaitingTimeCalculator, which excludes
    // an open period because it is not billable yet. This answers "how long
    // have I been sitting here", which has an answer while it is happening.
    const events = [
      event('trip_started', '2026-08-14T09:18:00Z'),
      event('waiting', '2026-08-14T09:55:00Z'),
    ];

    expect(waitingSecondsFrom(events, NOW)).toBe(300);
  });

  it('does not let a consecutive waiting event restart the period', () => {
    // waiting -> waiting is not legal, but a blind replay of the one cycle in
    // the lifecycle produces exactly this row (ADR-0023). Treating the repeat
    // as a restart would silently drop the four minutes in between.
    const events = [
      event('waiting', '2026-08-14T09:30:00Z'),
      event('waiting', '2026-08-14T09:34:00Z'),
      event('trip_resumed', '2026-08-14T09:40:00Z'),
    ];

    expect(waitingSecondsFrom(events, NOW)).toBe(600);
  });

  it('clamps a handset clock that is behind the server rather than subtracting', () => {
    const events = [event('waiting', '2026-08-14T10:05:00Z')];

    expect(waitingSecondsFrom(events, NOW)).toBe(0);
  });

  it('skips an event the app cannot place in time', () => {
    const events = [
      event('waiting', null),
      event('trip_resumed', '2026-08-14T09:40:00Z'),
    ];

    expect(waitingSecondsFrom(events, NOW)).toBe(0);
  });
});

describe('startedAtFrom — the column fallback', () => {
  const STARTED = '2026-08-14T21:58:25Z';

  it('prefers the timeline, which is the billing-grade source', () => {
    const events = [event('trip_started', STARTED)];

    // A different, wrong column value proves which one won.
    expect(startedAtFrom(events, '2020-01-01T00:00:00Z')).toBe(Date.parse(STARTED));
  });

  it('falls back to started_at when the timeline has not caught up', () => {
    // The real failure: the timeline arrives in a second request, and a screen
    // opened straight after the odometer renders against a cache taken when
    // the trip was still `passenger_onboard` — no `trip_started` row in it. The
    // clock showed an em dash on a trip that was visibly running.
    expect(startedAtFrom([event('passenger_onboard', '2026-08-14T21:48:46Z')], STARTED)).toBe(
      Date.parse(STARTED),
    );
    expect(startedAtFrom(undefined, STARTED)).toBe(Date.parse(STARTED));
  });

  it('is still null when neither source can answer', () => {
    expect(startedAtFrom(undefined, null)).toBeNull();
    expect(startedAtFrom([], 'not a date')).toBeNull();
  });
});
