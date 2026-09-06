import { intentFrom } from './routing';

/**
 * What a tapped push opens.
 *
 * The failure being guarded against is not a crash but a **tap that opens
 * nothing**: a driver hears a job, reaches for the phone, taps, and lands on
 * the home screen with no explanation. They only need to reach the conclusion
 * "this app is unreliable" once.
 */

it('opens the offer a job push names', () => {
  expect(intentFrom({ offer_id: 41, expires_in_seconds: 45 })).toEqual({
    kind: 'open_offer',
    offerId: 41,
  });
});

it('accepts an id that arrived as a string', () => {
  // Android's push transport stringifies data payloads on some versions, so
  // `"41"` is a real shape this receives — not defensive programming.
  expect(intentFrom({ offer_id: '41' })).toEqual({ kind: 'open_offer', offerId: 41 });
});

it('opens a trip when there is no offer', () => {
  expect(intentFrom({ trip_id: 900, booking_id: 12 })).toEqual({
    kind: 'open_trip',
    tripId: 900,
  });
});

it('prefers the offer when a payload somehow carries both', () => {
  // An offer has a countdown on it and a trip does not. If a future payload
  // ever carries the pair, the time-pressured half is the one to answer.
  expect(intentFrom({ offer_id: 41, trip_id: 900 })).toEqual({
    kind: 'open_offer',
    offerId: 41,
  });
});

// -- Withdrawals ------------------------------------------------------------

it('reads a withdrawal as cancelling the offer, not opening it', () => {
  expect(intentFrom({ offer_id: 41, withdrawn: true })).toEqual({
    kind: 'withdraw_offer',
    offerId: 41,
  });
});

it('only treats an explicit flag as a withdrawal', () => {
  // The dangerous direction. A missing or falsy flag read as a withdrawal
  // would silence the ring for the job it was announcing — the offer arrives,
  // the phone stays quiet, and the driver never knows there was one.
  expect(intentFrom({ offer_id: 41 }).kind).toBe('open_offer');
  expect(intentFrom({ offer_id: 41, withdrawn: false }).kind).toBe('open_offer');
  expect(intentFrom({ offer_id: 41, withdrawn: 0 }).kind).toBe('open_offer');
  expect(intentFrom({ offer_id: 41, withdrawn: 'no' }).kind).toBe('open_offer');
});

// -- Everything that must open nothing rather than something wrong ----------

it('ignores a payload with no id worth acting on', () => {
  expect(intentFrom({}).kind).toBe('ignore');
  expect(intentFrom({ headline: 'New job' }).kind).toBe('ignore');
});

it('ignores a payload that is not an object at all', () => {
  // A cold start hands back whatever the OS held, which on a truncated or
  // re-encoded payload can be a string, or nothing.
  expect(intentFrom(undefined).kind).toBe('ignore');
  expect(intentFrom(null).kind).toBe('ignore');
  expect(intentFrom('offer_id=41').kind).toBe('ignore');
  expect(intentFrom(41).kind).toBe('ignore');
});

it('refuses ids that would build a request for nothing', () => {
  // Each of these reaches the API as a path that 404s, and the driver sees
  // the same nothing as a dropped tap.
  for (const bad of [0, -1, 1.5, NaN, Infinity, '', 'abc', null, true, {}]) {
    expect(intentFrom({ offer_id: bad, trip_id: bad }).kind).toBe('ignore');
  }
});
