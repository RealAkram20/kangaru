import type {
  DriverEarnings,
  EarningsBreakdownRow,
  EarningsPeriod,
  EarningsTrendPoint,
} from '../api/endpoints';
import { formatMoney } from '../duty/offerPresentation';

/**
 * Turning `GET /me/earnings` into the words and shapes on the earnings screen.
 *
 * A module rather than helpers inside the screen, for the reason
 * `statsPresentation.ts` records at length: the parts that can be *wrong*
 * rather than merely ugly are the ones worth testing, and this app already
 * shipped `undefined NaN` where a driver's money goes because a formatter
 * lived inline with no test around it.
 *
 * ## What the mockup asked for and is not here
 *
 * Rows for **Tips**, **Bonuses** and **Online hours**. None of the three
 * exists on this platform, and the mockup printed `UGX 0` against Bonuses —
 * which `docs/screen-rules.md` §1 forbids by name, because a hard zero is a
 * claim ("this platform pays no bonuses") where an absent row is not.
 *
 * `on_trip_minutes` is offered in place of online hours and is **labelled
 * differently on purpose**: it is time driving, measured from the two
 * timestamps the state machine writes. Time spent waiting for an offer is not
 * in it and cannot be — `driver_presence` keeps no history.
 */

/** The em dash every absent figure in this app falls back to. Never a zero. */
export const NO_FIGURE = '—';

/** The three tabs, in the order the mockup has them. */
export const PERIODS: readonly EarningsPeriod[] = ['day', 'week', 'month'] as const;

/** The tab's own label. */
export function periodLabel(period: EarningsPeriod): string {
  return { day: 'Day', week: 'Week', month: 'Month' }[period];
}

/**
 * What the big figure is called, which has to change with the tab.
 *
 * The mockup said "Today's earnings" and only ever drew the Day tab. Leaving
 * that heading fixed while the tab moved would put a month's total under the
 * word "today" — the kind of wrong that a driver acts on.
 */
export function totalHeading(period: EarningsPeriod): string {
  return {
    day: "Today's earnings",
    week: 'This week',
    month: 'This month',
  }[period];
}

/**
 * A service type as a driver would say it.
 *
 * `other` is the trips the platform cannot classify — no order request behind
 * them. It is named plainly rather than hidden, because the row exists to make
 * the breakdown add up to the total, and a row called "Other" that a driver
 * cannot account for is still better than a total they cannot account for.
 *
 * Anything unrecognised falls through to a title-cased version of whatever the
 * server sent, rather than to a machine token or a crash: `service_type` is a
 * `string(20)` on the server, so a value this build has never seen is a real
 * possibility.
 */
export function serviceLabel(serviceType: string): string {
  const known: Record<string, string> = {
    ride: 'Rides',
    delivery: 'Deliveries',
    self_drive: 'Self-drive',
    other: 'Other work',
    // Not service types at all — kinds of earning (ADR-0034). They arrive in
    // the same list because a driver reads the breakdown as one list, and
    // they are grouped ahead of the service types server-side so a tip is
    // never folded into the Rides row of the trip it was given on.
    tip: 'Tips',
    bonus: 'Bonuses',
  };

  return (
    known[serviceType] ??
    serviceType
      .split('_')
      .map((word) => (word === '' ? word : word[0]!.toUpperCase() + word.slice(1)))
      .join(' ')
  );
}

/**
 * Money as a driver reads it, exactly.
 *
 * `formatMoney`, never `compactMoney`: this is money somebody is owed, and the
 * compact form hides up to 100 shillings inside a "K". That split is argued at
 * `compactMoney` itself and this is the side that must not round.
 *
 * An em dash when there is nothing loaded — never `UGX 0`, which reads as a
 * day's work that paid nothing rather than as a screen that has not answered.
 */
export function money(amountMinor: number | undefined, currency: string | undefined): string {
  if (amountMinor === undefined || currency === undefined || !Number.isFinite(amountMinor)) {
    return NO_FIGURE;
  }

  return formatMoney(amountMinor, currency);
}

/**
 * "7h 20m", "45m", or an em dash.
 *
 * **Never "0h 0m" and never "0m" from a null.** Null means no trip in the
 * window carried both timestamps, which is not the same as a driver having
 * driven for no time at all.
 */
export function durationLabel(minutes: number | null | undefined): string {
  if (minutes === undefined || minutes === null || !Number.isFinite(minutes) || minutes < 0) {
    return NO_FIGURE;
  }

  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);

  return hours === 0 ? `${rest}m` : `${hours}h ${rest}m`;
}

/**
 * The rows under the total, each with its count and its money.
 *
 * Returned verbatim from the payload rather than reshaped into a fixed
 * Rides/Deliveries pair: the platform also knows `self_drive`, and a screen
 * hardcoded to the mockup's two would silently hide a third the day it is
 * used. The server orders them by earnings, largest first, and that order is
 * kept.
 */
export function breakdownRows(
  earnings: DriverEarnings | undefined,
): { key: string; label: string; trips: number; amount: string }[] {
  if (earnings === undefined) {
    return [];
  }

  return earnings.breakdown.map((row: EarningsBreakdownRow) => ({
    key: row.service_type,
    label: serviceLabel(row.service_type),
    trips: row.trips,
    amount: money(row.earned_minor, earnings.currency),
  }));
}

/**
 * Whether the rows actually add up to the figure above them.
 *
 * The server builds both from one un-joined row set so this cannot drift, and
 * it is checked here anyway — cheaply, on data already in hand — because a
 * breakdown that does not reconcile is the single worst defect this screen can
 * carry, and it would otherwise be invisible until a driver added it up.
 * `EarningsScreen` says so plainly rather than drawing a sum that is wrong.
 */
export function breakdownReconciles(earnings: DriverEarnings | undefined): boolean {
  if (earnings === undefined) {
    return true;
  }

  const summed = earnings.breakdown.reduce((total, row) => total + row.earned_minor, 0);

  return summed === earnings.total_minor;
}

/**
 * One bar of the chart, as a fraction of the tallest.
 *
 * Heights are relative to the **period's own peak**, not to any absolute
 * figure: a driver comparing their morning with their evening is asking a
 * question about this day, and a fixed ceiling would flatten a quiet week into
 * an unreadable line.
 *
 * **Every bucket keeps a bar, including the empty ones**, because the x-axis is
 * time and the empty hours happened. A zero-earning bucket gets `0` and the
 * chart draws it as a baseline tick rather than as nothing, so the gap reads
 * as "no work here" instead of as missing data.
 *
 * When every bucket is zero the fractions are all zero — deliberately, rather
 * than dividing by a peak of zero and producing `NaN` heights, which render as
 * bars of no height at all and look identical to a broken chart.
 */
export function chartBars(
  earnings: DriverEarnings | undefined,
): { key: string; fraction: number; earnedMinor: number }[] {
  if (earnings === undefined) {
    return [];
  }

  const peak = earnings.trend.reduce(
    (highest, point: EarningsTrendPoint) => Math.max(highest, point.earned_minor),
    0,
  );

  return earnings.trend.map((point) => ({
    key: point.bucket,
    fraction: peak === 0 ? 0 : point.earned_minor / peak,
    earnedMinor: point.earned_minor,
  }));
}

/**
 * The handful of labels under the chart.
 *
 * Not one per bar. A day has 24 bars and a month has 31, and a label under
 * each is an unreadable smear at phone width — so the axis is marked at a few
 * anchors and the rest is left to the shape, which is what the eye is reading
 * anyway.
 *
 * Derived from the bucket keys the server sent rather than regenerated from a
 * date library, so the axis cannot disagree with the bars it sits under.
 */
export function axisLabels(earnings: DriverEarnings | undefined): { index: number; label: string }[] {
  if (earnings === undefined || earnings.trend.length === 0) {
    return [];
  }

  const points = earnings.trend;

  if (earnings.period === 'day') {
    // 12 AM, 6 AM, 12 PM, 6 PM — the mockup's own anchors, and the shape of a
    // driving day.
    return [0, 6, 12, 18]
      .filter((hour) => hour < points.length)
      .map((hour) => ({ index: hour, label: hourLabel(hour) }));
  }

  // A week gets every other day; a month gets four anchors across it. Both
  // read as "the 3rd", which is the shortest true label for a daily bucket.
  const step = earnings.period === 'week' ? 2 : Math.ceil(points.length / 4);

  const labels: { index: number; label: string }[] = [];

  for (let index = 0; index < points.length; index += step) {
    labels.push({ index, label: dayOfMonthLabel(points[index]!.bucket) });
  }

  return labels;
}

/**
 * A bucket key as a person would say it: "4 PM", or "15 Aug".
 *
 * **Written for the screen-reader sentence**, and it exists because rendering
 * the screen caught the alternative: the announcement read *"Busiest was
 * 2026-08-15 16:00"*, which is a database key spoken aloud. A sighted user
 * never sees these keys — they are the chart's internal identifiers — so
 * nothing flagged it until the composed sentence was read back.
 *
 * Parsed off the string rather than through `new Date()`: the key is already
 * in the fleet's timezone, and handing it to a `Date` reinterprets it in the
 * handset's, which can shift the answer by an hour or a day.
 */
export function bucketLabel(bucket: string, period: EarningsPeriod): string {
  if (period === 'day') {
    const hour = Number(bucket.slice(11, 13));

    return Number.isFinite(hour) ? hourLabel(hour) : bucket;
  }

  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const month = months[Number(bucket.slice(5, 7)) - 1];
  const day = Number(bucket.slice(8, 10));

  return month === undefined || !Number.isFinite(day) ? bucket : `${day} ${month}`;
}

/** "12 AM", "6 PM" — a whole hour, written the way the mockup's axis is. */
function hourLabel(hour: number): string {
  if (hour === 0) {
    return '12 AM';
  }

  if (hour === 12) {
    return '12 PM';
  }

  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

/**
 * "3" from a `YYYY-MM-DD` bucket key.
 *
 * Read off the string rather than parsed into a `Date`, deliberately: the key
 * is already in the fleet's timezone, and handing it to `new Date()` would
 * reinterpret it in the handset's and can shift the label by a day.
 */
function dayOfMonthLabel(bucket: string): string {
  const day = bucket.slice(8, 10);

  return day === '' ? bucket : String(Number(day));
}
