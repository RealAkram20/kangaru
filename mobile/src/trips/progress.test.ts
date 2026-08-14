import type { TripEvent, TripPayment } from '../api/types';
import {
  durationAnnouncement,
  formatTripDuration,
  startedAtFrom,
  tripPaymentLabel,
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
    expect(durationAnnouncement(4_209)).toBe('Driving for 1 hour 10 minutes.');
    expect(durationAnnouncement(842)).toBe('Driving for 14 minutes.');
    expect(durationAnnouncement(7_200)).toBe('Driving for 2 hours.');
  });

  it('still says something for a trip under a minute old', () => {
    expect(durationAnnouncement(20)).toBe('Driving for 0 minutes.');
  });

  it('says so plainly when there is no figure', () => {
    expect(durationAnnouncement(null)).toBe('Trip time is not available yet.');
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
