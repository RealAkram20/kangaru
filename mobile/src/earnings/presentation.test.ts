import type { DriverEarnings } from '../api/endpoints';
import {
  axisLabels,
  breakdownReconciles,
  bucketLabel,
  breakdownRows,
  chartBars,
  durationLabel,
  money,
  periodLabel,
  serviceLabel,
  totalHeading,
} from './presentation';

/**
 * The earnings screen's arithmetic and wording.
 *
 * Most of these exist because the mockup asked for something the platform
 * cannot produce, or would produce wrongly:
 *
 * - Tips and Bonuses, neither of which exists — and `UGX 0` against Bonuses,
 *   which `docs/screen-rules.md` §1 forbids by name;
 * - "Online hours", which cannot be measured because `driver_presence` keeps
 *   no history;
 * - a heading fixed to "Today's earnings" while the tab moves to Month.
 */
function earnings(overrides: Partial<DriverEarnings> = {}): DriverEarnings {
  return {
    period: 'day',
    timezone: 'Africa/Kampala',
    from: '2026-08-15T00:00:00+03:00',
    to: '2026-08-16T00:00:00+03:00',
    currency: 'UGX',
    total_minor: 85_000,
    trips: 10,
    on_trip_minutes: 440,
    breakdown: [
      { service_type: 'ride', trips: 6, earned_minor: 60_000 },
      { service_type: 'delivery', trips: 3, earned_minor: 18_000 },
      { service_type: 'other', trips: 1, earned_minor: 7_000 },
    ],
    trend: Array.from({ length: 24 }, (_, hour) => ({
      bucket: `2026-08-15 ${String(hour).padStart(2, '0')}:00`,
      earned_minor: hour === 18 ? 40_000 : hour === 12 ? 20_000 : 0,
    })),
    ...overrides,
  };
}

describe('the heading and tabs', () => {
  it('renames the total when the tab moves, so a month is never called today', () => {
    expect(totalHeading('day')).toBe("Today's earnings");
    expect(totalHeading('week')).toBe('This week');
    expect(totalHeading('month')).toBe('This month');
  });

  it('labels the three tabs', () => {
    expect(periodLabel('day')).toBe('Day');
    expect(periodLabel('week')).toBe('Week');
    expect(periodLabel('month')).toBe('Month');
  });
});

describe('the breakdown', () => {
  it('names rides, deliveries and the work that cannot be classified', () => {
    const rows = breakdownRows(earnings());

    expect(rows.map((row) => row.label)).toEqual(['Rides', 'Deliveries', 'Other work']);
    expect(rows.map((row) => row.amount)).toEqual(['UGX 60,000', 'UGX 18,000', 'UGX 7,000']);
    expect(rows.map((row) => row.trips)).toEqual([6, 3, 1]);
  });

  it('keeps the server ordering rather than imposing its own', () => {
    const rows = breakdownRows(
      earnings({
        breakdown: [
          { service_type: 'delivery', trips: 1, earned_minor: 40_000 },
          { service_type: 'ride', trips: 1, earned_minor: 4_000 },
        ],
      }),
    );

    expect(rows.map((row) => row.label)).toEqual(['Deliveries', 'Rides']);
  });

  it('shows a self-drive row the mockup had no place for', () => {
    expect(serviceLabel('self_drive')).toBe('Self-drive');
  });

  it('renders a service type it has never seen rather than a raw token', () => {
    // `service_type` is a string(20) on the server, fed partly by a public
    // form — a value this build has not heard of is a real possibility, and
    // "courier_run" is a better thing to show than a crash.
    expect(serviceLabel('courier_run')).toBe('Courier Run');
  });

  /**
   * **This assertion was inverted by ADR-0034**, and the old one is described
   * rather than deleted: it read *"has no tip and no bonus row, because
   * neither exists"*, and it was correct for as long as that was true. The
   * owner has since had both built.
   *
   * It also exists because a mutation pass found the gap it fills: deleting
   * `tip` and `bonus` from the label map **survived**, since `serviceLabel`
   * falls back to capitalising the raw key and produces the singular "Tip"
   * and "Bonus". Plausible, wrong, and nothing caught it — the breakdown's
   * other rows are all plural.
   */
  it('names the tip and bonus rows in the plural, like every other row', () => {
    expect(serviceLabel('tip')).toBe('Tips');
    expect(serviceLabel('bonus')).toBe('Bonuses');
  });

  it('gives a tip and a bonus rows of their own, not an Other work row', () => {
    // Server-side they are grouped by *kind* ahead of service type, so a tip
    // is never folded into the Rides line of the trip it was given on, and a
    // bonus — which has no trip at all — is not filed as unclassifiable work.
    const rows = breakdownRows(
      earnings({
        breakdown: [
          { service_type: 'ride', trips: 6, earned_minor: 60_000 },
          { service_type: 'tip', trips: 2, earned_minor: 3_200 },
          { service_type: 'bonus', trips: 0, earned_minor: 20_000 },
        ],
        total_minor: 83_200,
      }),
    );

    // The server's order is preserved — it sorts by earnings, largest first,
    // and the app does not re-sort a money list it did not compute.
    expect(rows.map((row) => row.label)).toEqual(['Rides', 'Tips', 'Bonuses']);
  });

  it('notices when the rows do not add up to the total', () => {
    // Cannot happen the way the server builds it, and checked anyway: a
    // breakdown that silently disagrees with the figure above it is the worst
    // defect this screen can carry.
    expect(breakdownReconciles(earnings())).toBe(true);

    expect(
      breakdownReconciles(
        earnings({ breakdown: [{ service_type: 'ride', trips: 6, earned_minor: 60_000 }] }),
      ),
    ).toBe(false);
  });
});

describe('money', () => {
  it('never divides a zero-decimal currency', () => {
    expect(money(85_000, 'UGX')).toBe('UGX 85,000');
    expect(money(85_000, 'UGX')).not.toBe('UGX 850');
  });

  it('shows the exact figure rather than the compact one', () => {
    // `compactMoney` would render this "UGX 145.6K" and hide up to 100
    // shillings. Fine on a glanceable tile, not on money somebody is owed.
    expect(money(145_600, 'UGX')).toBe('UGX 145,600');
  });

  it('is an em dash before anything has loaded, never a zero', () => {
    expect(money(undefined, undefined)).toBe('—');
    expect(money(undefined, 'UGX')).toBe('—');
  });
});

describe('time on trips', () => {
  it('reads as hours and minutes', () => {
    expect(durationLabel(440)).toBe('7h 20m');
    expect(durationLabel(45)).toBe('45m');
    expect(durationLabel(60)).toBe('1h 0m');
  });

  it('is an em dash when nothing was measured, never 0m', () => {
    // Null means no trip in the window carried both timestamps — which is not
    // the same as a driver having driven for no time at all.
    expect(durationLabel(null)).toBe('—');
    expect(durationLabel(undefined)).toBe('—');
  });
});

describe('the chart', () => {
  it('scales every bar against the busiest bucket of the period', () => {
    const bars = chartBars(earnings());

    expect(bars).toHaveLength(24);
    expect(bars[18]?.fraction).toBe(1);
    expect(bars[12]?.fraction).toBe(0.5);
    expect(bars[3]?.fraction).toBe(0);
  });

  it('keeps a bar for every empty bucket, because the hours happened', () => {
    // Dropping empty buckets would compress the axis and draw 3 AM beside
    // 7 PM as though the hours between had not existed.
    const bars = chartBars(earnings());

    expect(bars.filter((bar) => bar.earnedMinor === 0)).toHaveLength(22);
    expect(bars.map((bar) => bar.key)).toContain('2026-08-15 03:00');
  });

  it('draws a flat chart rather than NaN heights on a day with no work', () => {
    // Dividing by a peak of zero yields NaN, which renders as bars of no
    // height and is indistinguishable from a broken chart.
    const bars = chartBars(
      earnings({
        trend: Array.from({ length: 24 }, (_, hour) => ({
          bucket: `2026-08-15 ${String(hour).padStart(2, '0')}:00`,
          earned_minor: 0,
        })),
      }),
    );

    expect(bars).toHaveLength(24);
    expect(bars.every((bar) => bar.fraction === 0)).toBe(true);
    expect(bars.every((bar) => Number.isFinite(bar.fraction))).toBe(true);
  });

  it('has no bars at all before anything has loaded', () => {
    expect(chartBars(undefined)).toEqual([]);
    expect(breakdownRows(undefined)).toEqual([]);
  });
});

describe('the axis', () => {
  it('marks a day at midnight, six, noon and six', () => {
    expect(axisLabels(earnings()).map((tick) => tick.label)).toEqual([
      '12 AM',
      '6 AM',
      '12 PM',
      '6 PM',
    ]);
  });

  it('marks a week by day of the month, every other day', () => {
    const week = earnings({
      period: 'week',
      trend: ['10', '11', '12', '13', '14', '15', '16'].map((day) => ({
        bucket: `2026-08-${day}`,
        earned_minor: 0,
      })),
    });

    expect(axisLabels(week).map((tick) => tick.label)).toEqual(['10', '12', '14', '16']);
  });

  it('reads the day off the bucket key rather than parsing a date', () => {
    // `new Date('2026-08-15')` is parsed as UTC and rendered in the handset's
    // zone, which west of Greenwich prints the 14th. The key is already in
    // the fleet's timezone; slicing it cannot drift.
    const month = earnings({
      period: 'month',
      trend: Array.from({ length: 31 }, (_, index) => ({
        bucket: `2026-08-${String(index + 1).padStart(2, '0')}`,
        earned_minor: 0,
      })),
    });

    expect(axisLabels(month)[0]?.label).toBe('1');
  });

  it('has no ticks before anything has loaded', () => {
    expect(axisLabels(undefined)).toEqual([]);
  });
});

describe('bucket labels, for the screen-reader sentence', () => {
  it('says an hour the way a person would', () => {
    // Found by rendering: the announcement read "Busiest was 2026-08-15
    // 16:00" — a database key spoken to the one person who cannot see the
    // chart it indexes. A sighted user never sees these keys, so nothing
    // else would have caught it.
    expect(bucketLabel('2026-08-15 16:00', 'day')).toBe('4 PM');
    expect(bucketLabel('2026-08-15 00:00', 'day')).toBe('12 AM');
    expect(bucketLabel('2026-08-15 12:00', 'day')).toBe('12 PM');
  });

  it('says a date the way a person would', () => {
    expect(bucketLabel('2026-08-15', 'week')).toBe('15 Aug');
    expect(bucketLabel('2026-01-03', 'month')).toBe('3 Jan');
  });

  it('falls back to the raw key rather than inventing a time', () => {
    // The same rule `FinancialPeriod::label` follows: printing 1 Jan 1970
    // onto a figure somebody is reconciling is worse than printing the key.
    expect(bucketLabel('not-a-bucket', 'day')).toBe('not-a-bucket');
    expect(bucketLabel('2026-99-99', 'month')).toBe('2026-99-99');
  });
});
