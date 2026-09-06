import type { TripEvent } from '../api/types';
import {
  arrivedAtFrom,
  elapsedSeconds,
  fillFraction,
  formatElapsed,
  waitingAnnouncement,
} from './waiting';

function event(to: TripEvent['to_status'], createdAt: string | null): TripEvent {
  return {
    id: 1,
    trip_id: 1,
    from_status: null,
    to_status: to,
    user_id: null,
    notes: null,
    created_at: createdAt,
    // `waiting.ts` is arithmetic on `created_at`; the server's fleet-zone
    // rendering is the trip record's business, not this module's.
    local_day: null,
    local_time: null,
  };
}

describe('arrivedAtFrom', () => {
  it('reads the arrival from the timeline, not from any other transition', () => {
    const events = [
      event('assigned', '2026-08-14T09:00:00Z'),
      event('accepted', '2026-08-14T09:01:00Z'),
      event('driver_en_route', '2026-08-14T09:02:00Z'),
      event('driver_arrived', '2026-08-14T09:15:00Z'),
    ];

    expect(arrivedAtFrom(events)).toBe(Date.parse('2026-08-14T09:15:00Z'));
  });

  it('is null while the timeline has not arrived, rather than guessing a start', () => {
    // The screen renders an em dash on this. A zero here would tell a driver
    // who has been waiting eight minutes that they have just got there.
    expect(arrivedAtFrom(undefined)).toBeNull();
    expect(arrivedAtFrom([])).toBeNull();
  });

  it('is null when the trip has not reached the pickup', () => {
    expect(arrivedAtFrom([event('accepted', '2026-08-14T09:01:00Z')])).toBeNull();
  });

  it('ignores an arrival with no timestamp or an unparseable one', () => {
    expect(arrivedAtFrom([event('driver_arrived', null)])).toBeNull();
    expect(arrivedAtFrom([event('driver_arrived', 'not a date')])).toBeNull();
  });
});

describe('elapsedSeconds', () => {
  it('counts whole seconds since the arrival', () => {
    const at = Date.parse('2026-08-14T09:15:00Z');

    expect(elapsedSeconds(at, at + 105_000)).toBe(105);
  });

  it('floors rather than rounds, so the figure never reads ahead of the clock', () => {
    const at = Date.parse('2026-08-14T09:15:00Z');

    expect(elapsedSeconds(at, at + 1999)).toBe(1);
  });

  it('clamps a handset clock that is behind the server to zero', () => {
    // Otherwise the screen renders "-00:07" — a number no driver can act on,
    // from a fault they cannot see.
    const at = Date.parse('2026-08-14T09:15:00Z');

    expect(elapsedSeconds(at, at - 7000)).toBe(0);
  });
});

describe('fillFraction', () => {
  it('is the elapsed share of the target', () => {
    expect(fillFraction(150, 300)).toBeCloseTo(0.5);
  });

  it('saturates and holds past the target rather than wrapping or resetting', () => {
    // The load-bearing one. Nothing bounds a wait at the kerb, so the ring
    // must never read as a deadline that has passed and restarted.
    expect(fillFraction(300, 300)).toBe(1);
    expect(fillFraction(3000, 300)).toBe(1);
  });

  it('draws full rather than dividing by zero on a nonsense target', () => {
    expect(fillFraction(10, 0)).toBe(1);
    expect(fillFraction(10, -5)).toBe(1);
  });
});

describe('formatElapsed', () => {
  it('pads both fields to two digits', () => {
    expect(formatElapsed(105)).toBe('01:45');
    expect(formatElapsed(5)).toBe('00:05');
    expect(formatElapsed(0)).toBe('00:00');
  });

  it('lets the minutes run past sixty instead of rolling over', () => {
    // `01:04` for an hour and four minutes would be indistinguishable from one
    // minute — the exact reading a waiting dispute would turn on.
    expect(formatElapsed(3844)).toBe('64:04');
  });
});

describe('waitingAnnouncement', () => {
  it('says the wait as one sentence rather than leaving digits to linearise', () => {
    expect(waitingAnnouncement(105)).toBe('Waiting 1 minute 45 seconds.');
    expect(waitingAnnouncement(125)).toBe('Waiting 2 minutes 5 seconds.');
  });

  it('drops a trailing zero seconds but keeps seconds under a minute', () => {
    expect(waitingAnnouncement(180)).toBe('Waiting 3 minutes.');
    expect(waitingAnnouncement(1)).toBe('Waiting 1 second.');
    expect(waitingAnnouncement(0)).toBe('Waiting 0 seconds.');
  });

  it('says so plainly when there is no figure', () => {
    expect(waitingAnnouncement(null)).toBe('Waiting time is not available yet.');
  });
});
