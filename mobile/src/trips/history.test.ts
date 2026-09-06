import type { DriverHistoryTrip } from '../api/endpoints';
import {
  dateLabel,
  dayHeading,
  filterValue,
  groupByDay,
  NO_FIGURE,
  rowAmount,
  rowAnnouncement,
  rowTitle,
  showsStatus,
  statusTone,
  timeLabel,
} from './history';

function trip(overrides: Partial<DriverHistoryTrip> = {}): DriverHistoryTrip {
  return {
    id: 1,
    status: 'trip_completed',
    service_type: 'ride',
    origin: 'Acacia Mall',
    destination: 'Kololo',
    happened_at: '2026-08-15T07:45:00Z',
    local_day: '2026-08-15',
    local_time: '10:45',
    earned_minor: 10_000,
    currency: 'UGX',
    ...overrides,
  };
}

describe('the money on a row', () => {
  it('renders the driver’s share exactly, never abbreviated', () => {
    expect(rowAmount(trip({ earned_minor: 145_600 }))).toBe('UGX 145,600');
  });

  it('renders an em dash rather than a zero when there is no figure', () => {
    // `docs/screen-rules.md` §1: "A zero is not a substitute for unknown.
    // `UGX 0` reads as a free ride." The ordinary cases are a cancelled trip,
    // a corporate trip invoiced to the client, and the window between a
    // completion reaching the office and the ledger entry being written.
    expect(rowAmount(trip({ earned_minor: null, currency: null }))).toBe(NO_FIGURE);
    expect(rowAmount(trip({ earned_minor: 8_000, currency: null }))).toBe(NO_FIGURE);
  });

  it('does not divide a zero-decimal currency', () => {
    // The bug this app actually shipped, in the one place it would show up
    // again: UGX is zero-decimal, so 20,500 shillings must not render as 205.
    expect(rowAmount(trip({ earned_minor: 20_500 }))).toBe('UGX 20,500');
  });
});

describe('what a row is called', () => {
  it('names the kind of job in the singular', () => {
    expect(rowTitle(trip({ service_type: 'ride' }))).toBe('Ride');
    expect(rowTitle(trip({ service_type: 'delivery' }))).toBe('Delivery');
    expect(rowTitle(trip({ service_type: 'self_drive' }))).toBe('Self-drive');
  });

  it('says "Trip" rather than guessing when nothing can classify it', () => {
    // A walk-in a dispatcher fulfilled by hand has no order request, so
    // nothing knows whether it was a ride or a delivery. Calling it a ride
    // would be inventing a fact about somebody's work.
    expect(rowTitle(trip({ service_type: null }))).toBe('Trip');
  });

  it('renders an unrecognised service type as itself rather than crashing', () => {
    // The column is a `string(20)` fed partly by a public form, so the set can
    // grow without this build knowing.
    expect(rowTitle(trip({ service_type: 'airport_transfer' }))).toBe('Airport Transfer');
  });
});

describe('the time on a row', () => {
  it('renders the server’s local time in the mockup’s 12-hour form', () => {
    expect(timeLabel('10:45')).toBe('10:45 AM');
    expect(timeLabel('14:05')).toBe('02:05 PM');
    expect(timeLabel('07:05')).toBe('07:05 AM');
  });

  it('gets midnight and noon right, which the modulus alone does not', () => {
    expect(timeLabel('00:15')).toBe('12:15 AM');
    expect(timeLabel('12:30')).toBe('12:30 PM');
  });

  it('passes an unparseable value through rather than inventing a time', () => {
    expect(timeLabel('')).toBe('');
    expect(timeLabel('nonsense')).toBe('nonsense');
    expect(timeLabel('99:99')).toBe('99:99');
  });
});

describe('the heading over a day', () => {
  it('uses the server’s day keys, not the handset’s clock', () => {
    expect(dayHeading('2026-08-15', '2026-08-15', '2026-08-14')).toBe('Today');
    expect(dayHeading('2026-08-14', '2026-08-15', '2026-08-14')).toBe('Yesterday');
    expect(dayHeading('2026-08-01', '2026-08-15', '2026-08-14')).toBe('1 Aug 2026');
  });

  it('shows a date rather than guessing when the server said nothing', () => {
    // A heading that says "Today" over yesterday's work is worse than one
    // that says a date, because the wrong one is the one a driver believes.
    expect(dayHeading('2026-08-15', null, null)).toBe('15 Aug 2026');
  });

  it('does not reinterpret a day key through a timezone', () => {
    // `new Date('2026-01-01')` is UTC midnight, which is 31 December west of
    // Greenwich. The key is already the right day and must not be shifted.
    expect(dateLabel('2026-01-01')).toBe('1 Jan 2026');
    expect(dateLabel('2026-12-31')).toBe('31 Dec 2026');
  });

  it('falls back to the raw key rather than printing an invented date', () => {
    expect(dateLabel('not-a-day')).toBe('not-a-day');
    expect(dateLabel('2026-13-01')).toBe('2026-13-01');
  });
});

describe('grouping into day sections', () => {
  it('keeps the server’s section order and re-sorts rows inside a day', () => {
    const sections = groupByDay(
      [
        trip({ id: 1, local_day: '2026-08-15', happened_at: '2026-08-15T05:15:00Z' }),
        trip({ id: 2, local_day: '2026-08-15', happened_at: '2026-08-15T07:45:00Z' }),
        trip({ id: 3, local_day: '2026-08-14', happened_at: '2026-08-14T15:30:00Z' }),
      ],
      '2026-08-15',
      '2026-08-14',
    );

    expect(sections.map((section) => section.heading)).toEqual(['Today', 'Yesterday']);
    // Newest first *within* the day: the server pages on `id` descending
    // because that is the only ordering a cursor can walk, and dispatch order
    // is not always completion order.
    expect(sections[0]!.data.map((row) => row.id)).toEqual([2, 1]);
  });

  it('puts one day in one section however the rows are interleaved', () => {
    const sections = groupByDay(
      [
        trip({ id: 1, local_day: '2026-08-15' }),
        trip({ id: 2, local_day: '2026-08-14' }),
        trip({ id: 3, local_day: '2026-08-15' }),
      ],
      '2026-08-15',
      '2026-08-14',
    );

    expect(sections).toHaveLength(2);
    expect(sections[0]!.data).toHaveLength(2);
  });

  it('drops a row with no day key rather than heading a section with nothing', () => {
    const sections = groupByDay(
      [trip({ id: 1 }), trip({ id: 2, local_day: '' as string })],
      '2026-08-15',
      '2026-08-14',
    );

    expect(sections).toHaveLength(1);
    expect(sections[0]!.data.map((row) => row.id)).toEqual([1]);
  });

  it('is empty for an empty page', () => {
    expect(groupByDay([], '2026-08-15', '2026-08-14')).toEqual([]);
  });
});

describe('the chips', () => {
  it('sends the server a service type, so the filter is over the whole history', () => {
    expect(filterValue('all')).toBeNull();
    expect(filterValue('ride')).toBe('ride');
    expect(filterValue('delivery')).toBe('delivery');
  });
});

describe('the screen-reader sentence', () => {
  it('says whose money the figure is, because it is a share and not the fare', () => {
    expect(rowAnnouncement(trip())).toBe(
      'Ride from Acacia Mall to Kololo, at 10:45 AM. You earned UGX 10,000.',
    );
  });

  it('says a cancelled trip is cancelled, in words', () => {
    // Never colour or a missing figure alone (AGENTS.md § Accessibility): the
    // em dash is the only visible difference, and it is not announced.
    const sentence = rowAnnouncement(
      trip({ status: 'cancelled', earned_minor: null, currency: null }),
    );

    expect(sentence).toContain('Cancelled');
    expect(sentence).toContain('No earnings recorded');
  });
});

describe('the status beside a route', () => {
  it('is hidden on a completed trip and shown on everything else', () => {
    // Every row in a history is finished, so "Completed" on all of them
    // carries nothing and costs a line. A cancelled row without it is
    // distinguished only by an em dash.
    expect(showsStatus(trip({ status: 'trip_completed' }))).toBe(false);
    expect(showsStatus(trip({ status: 'cancelled' }))).toBe(true);
    expect(showsStatus(trip({ status: 'no_show' }))).toBe(true);
  });

  /**
   * Found by rendering the screen rather than by a test: every status was
   * being drawn amber, so a *cancelled* trip looked like a caution rather
   * than the ending DESIGN.md §3 files under Error, and an *invoiced* one
   * would have looked like a problem when nothing is wrong with it.
   */
  it('colours an ending by DESIGN.md §3, not all of them as a caution', () => {
    expect(statusTone(trip({ status: 'cancelled' }))).toBe('danger');
    expect(statusTone(trip({ status: 'no_show' }))).toBe('danger');
    expect(statusTone(trip({ status: 'rejected' }))).toBe('danger');

    expect(statusTone(trip({ status: 'disputed' }))).toBe('warning');

    // A completed trip moving through billing. Nothing is wrong with either,
    // and colouring them would say otherwise about a driver's best work.
    expect(statusTone(trip({ status: 'invoice_generated' }))).toBe('neutral');
    expect(statusTone(trip({ status: 'closed' }))).toBe('neutral');
  });
});
