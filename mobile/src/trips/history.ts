import type { DriverHistoryTrip } from '../api/endpoints';
import { formatMoney } from '../duty/offerPresentation';
import { statusLabel } from './transitions';

/**
 * Turning `GET /me/trips` into the sections and rows of a trip history.
 *
 * A module rather than helpers inside the screen, for the reason
 * `statsPresentation.ts` records: the parts that can be *wrong* rather than
 * merely ugly are the ones worth testing, and this app already shipped
 * `undefined NaN` where a driver's money goes because a formatter lived inline
 * with no test around it.
 *
 * ## What the mockup asked for that is not here
 *
 * The mockup's rows are uniformly green figures on completed rides and
 * deliveries. Two departures, both settled with the owner before this was
 * written:
 *
 * - **Cancelled and no-show trips are in the list**, with `—` where the money
 *   goes and the status in words beside the route. A driver who drove to a
 *   pickup and was cancelled on has spent forty minutes, and nothing else in
 *   this app lists that trip. `UGX 0` is specifically banned by
 *   `docs/screen-rules.md` §1 — it reads as a job done for free.
 * - **The figure is the driver's own earnings, not the fare the passenger
 *   paid.** Adding this list up must land on the same total the Earnings
 *   screen shows; two screens about one driver's pay disagreeing is the worst
 *   defect either can carry. `TripResource::driverEarningsFor()` argues the
 *   same case for the completion screen.
 */

/** The em dash every absent figure in this app falls back to. Never a zero. */
export const NO_FIGURE = '—';

/**
 * The three chips.
 *
 * `value` is what goes to the server, so the filter runs in SQL over the whole
 * history rather than over the twenty-five rows that happen to be loaded —
 * "3 Rides" out of a loaded page is a claim about the page, not the history.
 *
 * **Only two kinds are offered, and the platform knows three.** `self_drive`
 * exists in `order_requests.service_type` and has no chip, because the mockup
 * has two and a driver doing self-drive hire is not the driver this screen was
 * drawn for. `All` still includes them, so nothing is hidden — which is the
 * distinction that makes a two-chip filter honest rather than lossy.
 */
export const HISTORY_FILTERS = [
  { key: 'all', label: 'All', value: null },
  { key: 'ride', label: 'Rides', value: 'ride' },
  { key: 'delivery', label: 'Deliveries', value: 'delivery' },
] as const;

export type HistoryFilterKey = (typeof HISTORY_FILTERS)[number]['key'];

export function filterValue(key: HistoryFilterKey): string | null {
  return HISTORY_FILTERS.find((filter) => filter.key === key)?.value ?? null;
}

/**
 * What one row is called: "Ride", "Delivery", "Self-drive", or "Trip".
 *
 * Singular, unlike `serviceLabel` in the earnings module, which names a
 * *group* of them ("Rides", "Deliveries") for a breakdown table. Same
 * vocabulary, different grammatical number — deliberately spelled here rather
 * than de-pluralised from that function, because stripping an "s" is a rule
 * that breaks on the first word that does not take one.
 *
 * **"Trip" is the honest fallback, not a guess.** A trip with no order request
 * behind it cannot be classified at all — a walk-in a dispatcher fulfilled by
 * hand — and calling it a ride would be inventing a fact about somebody's
 * work. `DriverEarningsService::UNCLASSIFIED` makes the same choice.
 */
export function rowTitle(trip: DriverHistoryTrip): string {
  const known: Record<string, string> = {
    ride: 'Ride',
    delivery: 'Delivery',
    self_drive: 'Self-drive',
  };

  if (trip.service_type === null) {
    return 'Trip';
  }

  return known[trip.service_type] ?? capitalise(trip.service_type);
}

/**
 * The money on a row, or an em dash.
 *
 * `formatMoney`, never `compactMoney`: this is money a driver is owed, and the
 * compact form hides up to a hundred shillings inside a "K". That split is
 * argued at `compactMoney` itself and this is the side that must not round.
 *
 * **Null becomes `—`, never `UGX 0`.** Null is the ordinary case on a
 * cancelled trip, on a corporate trip that is invoiced to the client, and for
 * the minutes between a completion reaching the office and the ledger
 * listener writing the entry. Each of those is "no figure", and none of them
 * is "you earned nothing".
 */
export function rowAmount(trip: DriverHistoryTrip): string {
  if (trip.earned_minor === null || trip.currency === null) {
    return NO_FIGURE;
  }

  return formatMoney(trip.earned_minor, trip.currency);
}

/**
 * `"14:05"` → `"02:05 PM"`.
 *
 * Rendered from the string the server sent, which is already in the fleet's
 * timezone — **not** re-derived from `happened_at` on the handset. Two
 * reasons, and the first has already been a live bug in this codebase:
 * `config/app.php` is UTC, so a day or an hour computed locally rolls at the
 * wrong moment; and Hermes ships `Intl` whose locale data varies by platform
 * and build, so `toLocaleTimeString` gives two handsets in one fleet different
 * strings for one trip (`wallet/presentation.ts` records that).
 *
 * The 12-hour rendering is the mockup's, and it is pure arithmetic on
 * `HH:MM` — no locale, no timezone, nothing that can differ between phones.
 * An unparseable value falls through unchanged rather than becoming a
 * fabricated time.
 */
export function timeLabel(localTime: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(localTime);

  if (match === null) {
    return localTime;
  }

  const hours = Number(match[1]);
  const minutes = match[2]!;

  if (!Number.isInteger(hours) || hours < 0 || hours > 23) {
    return localTime;
  }

  const suffix = hours < 12 ? 'AM' : 'PM';
  // Midnight and noon are the two the modulus gets wrong on its own: 0 % 12
  // and 12 % 12 are both 0, and "00:15 AM" is not a time anybody writes.
  const twelve = hours % 12 === 0 ? 12 : hours % 12;

  return `${String(twelve).padStart(2, '0')}:${minutes} ${suffix}`;
}

/**
 * The heading over a day's rows: "Today", "Yesterday", or a date.
 *
 * `today` and `yesterday` are the **server's** keys, in the fleet's timezone.
 * Computing them here from `new Date()` would put an evening's trips under the
 * wrong heading for a driver whose handset is in a different zone from the
 * fleet — and would do it plausibly enough that nobody reports it.
 *
 * **When the server did not say, this returns the date rather than guessing.**
 * A heading that says "Today" over yesterday's work is worse than one that
 * says "15 Aug 2026", because the wrong one is the one a driver believes.
 */
export function dayHeading(
  localDay: string,
  today: string | null,
  yesterday: string | null,
): string {
  if (today !== null && localDay === today) {
    return 'Today';
  }

  if (yesterday !== null && localDay === yesterday) {
    return 'Yesterday';
  }

  return dateLabel(localDay);
}

/**
 * `"2026-08-15"` → `"15 Aug 2026"`.
 *
 * Built from the key's own parts rather than through `Date`, which would
 * reinterpret a bare `YYYY-MM-DD` as UTC midnight and can render the previous
 * day west of Greenwich. The key is already the right day; nothing about it
 * needs a timezone applied twice.
 */
export function dateLabel(localDay: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDay);

  if (match === null) {
    return localDay;
  }

  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  const month = months[Number(match[2]) - 1];

  if (month === undefined) {
    return localDay;
  }

  return `${Number(match[3])} ${month} ${match[1]}`;
}

export type HistorySection = {
  /** The `local_day` key. Stable, and what the section is keyed on. */
  day: string;
  heading: string;
  /**
   * The rows. Named `data` rather than `trips` because that is `SectionList`'s
   * own contract — the component reads `section.data` and nothing else, and a
   * domain-nicer name here would mean mapping every section on every render
   * purely to rename one field.
   */
  data: DriverHistoryTrip[];
};

/**
 * The loaded rows, grouped into the day sections the screen draws.
 *
 * ## Two orderings, and they are not the same one
 *
 * The **sections** keep the order the server sent, which is `id` descending —
 * the only ordering a cursor can page over without skipping or repeating a row
 * (`completed_at` is null on every cancelled trip, and shared to the second by
 * trips finished together).
 *
 * The **rows inside a section** are re-sorted by `happened_at`, newest first,
 * because dispatch order and completion order are not always the same and a
 * driver reading a day expects it in the order they lived it. Sorting only
 * within a section is what keeps this compatible with the cursor: the server's
 * ordering still decides which rows arrive and in which pages.
 *
 * Rows with no day key are dropped rather than gathered under a heading of
 * their own. `local_day` is server-computed and non-null in the contract, so a
 * missing one means a payload this build does not understand — and inventing a
 * section for it would put a driver's work under a heading with no meaning.
 */
export function groupByDay(
  trips: DriverHistoryTrip[],
  today: string | null,
  yesterday: string | null,
): HistorySection[] {
  const sections: HistorySection[] = [];
  const byDay = new Map<string, HistorySection>();

  for (const trip of trips) {
    if (typeof trip.local_day !== 'string' || trip.local_day === '') {
      continue;
    }

    let section = byDay.get(trip.local_day);

    if (section === undefined) {
      section = {
        day: trip.local_day,
        heading: dayHeading(trip.local_day, today, yesterday),
        data: [],
      };

      byDay.set(trip.local_day, section);
      sections.push(section);
    }

    section.data.push(trip);
  }

  for (const section of sections) {
    section.data.sort((a, b) => Date.parse(b.happened_at) - Date.parse(a.happened_at));
  }

  return sections;
}

/**
 * One row as a single sentence, for a screen reader.
 *
 * Composed rather than left to linearise: read cell by cell the row becomes
 * "Ride, Acacia Mall, arrow, Kololo, 10:45 AM, UGX 10,000" — an arrow glyph
 * that may be announced as anything or nothing, and a figure with no idea what
 * it is a figure *of*. On this screen that last part matters more than usual,
 * because the number is the driver's share and not the fare, and a bare
 * "UGX 10,000" invites the exact confusion the field was chosen to avoid.
 *
 * The cancelled case says so in words. Colour and a missing figure are both
 * easy to overlook, and AGENTS.md's accessibility rule is that status never
 * rests on either alone.
 */
export function rowAnnouncement(trip: DriverHistoryTrip): string {
  const journey = `${rowTitle(trip)} from ${trip.origin} to ${trip.destination}`;
  const when = `at ${timeLabel(trip.local_time)}`;

  if (trip.earned_minor === null || trip.currency === null) {
    return `${journey}, ${when}. ${statusLabel(trip.status)}. No earnings recorded.`;
  }

  return `${journey}, ${when}. You earned ${formatMoney(trip.earned_minor, trip.currency)}.`;
}

/**
 * Whether a row's status is worth printing beside the route.
 *
 * A completed trip does not need the word "Completed" on it — every row in a
 * history is finished, and a label that appears on all of them carries nothing
 * and costs a line. The ones that are *not* an ordinary completion do need it:
 * without the word, a cancelled trip is a row whose only distinguishing
 * feature is an em dash where the money goes.
 */
export function showsStatus(trip: DriverHistoryTrip): boolean {
  return trip.status !== 'trip_completed';
}

/**
 * Which of DESIGN.md §3's status colours a printed status takes.
 *
 * **Found by rendering the screen, not by a test.** Every status here was
 * being drawn in `warning` amber, which made a *cancelled* trip — an ending
 * DESIGN.md §3 lists under "Error / Cancelled / No Show", `#B42318` — look
 * like a caution, and would have made an *invoiced* one look like a problem
 * when nothing at all is wrong with it.
 *
 * Three tones, following that table:
 *
 * - **`danger`** — the endings where the journey did not happen:
 *   `cancelled`, `no_show`, `rejected`.
 * - **`warning`** — `disputed`, which is a live disagreement about a trip
 *   that did happen.
 * - **`neutral`** — `invoice_generated` and `closed`, which are a *completed*
 *   trip moving through billing. Nothing is wrong with either, and colouring
 *   them would tell a driver otherwise about their best work.
 *
 * The tone never carries the meaning on its own: the status is printed in
 * words beside it, and the row's screen-reader sentence names it too.
 */
export function statusTone(trip: DriverHistoryTrip): 'danger' | 'warning' | 'neutral' {
  if (trip.status === 'cancelled' || trip.status === 'no_show' || trip.status === 'rejected') {
    return 'danger';
  }

  if (trip.status === 'disputed') {
    return 'warning';
  }

  return 'neutral';
}

function capitalise(value: string): string {
  return value
    .split('_')
    .map((word) => (word === '' ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join(' ');
}
