import type { DriverLedgerEntry, Trip, TripEvent } from '../api/types';
import { timeLabel } from './history';
import { waitingSecondsFrom } from './progress';
import { statusLabel } from './transitions';

/**
 * The trip *record* — what a finished job looks like when it is read back.
 *
 * Pure functions over the payload, for `places.ts`'s reason: these are the
 * parts that can be **wrong** rather than merely ugly, and a component test
 * would have to render and flush to reach them.
 *
 * ## What this module refuses to invent
 *
 * **Stops — which now exist, and are still not drawn from here.** This
 * comment used to say the platform had no intermediate stops anywhere; since
 * ADR-0045 it does (`trip_stops`, served as `Trip.stops`, written by the
 * driver's add-a-drop-off and the §2 arrive/continue stamps). The rail below
 * is *still* built from `trip_events` — the append-only timeline billing
 * derives waiting from — because every row on it is a transition that
 * actually happened, at the time it happened, and the §2 stamps are those
 * same transitions wearing a stop id. A per-stop rail (label, dwell, skip
 * reason) is a real improvement this record screen has not learned yet; the
 * worklog records it as deliberately not built in the ADR-0045 driver slice.
 *
 * **A fare breakdown.** No base-fare, distance or waiting *amount* survives a
 * walk-in: the pricing engine is pure and writes nothing, and only the total
 * reaches `trips.fare_minor`. The money here is the driver's ledger rows, which
 * are stored.
 *
 * **A "Today" heading.** `DriverTripResource` records why: today and yesterday
 * are the *server's* keys in the fleet's zone, and a handset computing them from
 * its own clock files an evening's work under the wrong day — plausibly enough
 * that nobody reports it. The events endpoint serves no such key, so the record
 * states the date instead of a relative word.
 */

/** The em dash every figure this platform cannot produce renders as. */
const NO_FIGURE = '—';

export type RecordRowKind = 'pickup' | 'collected' | 'waiting' | 'dropoff' | 'ended';

export type RecordRowTone = 'good' | 'warning' | 'danger' | 'neutral';

export type RecordRow = {
  kind: RecordRowKind;
  /** What happened — "Pickup", "Passenger aboard", "Waiting", "Drop-off". */
  label: string;
  /** The place, on the two rows that are about one. */
  place: string | null;
  /** When, as `08:30 AM`, or null where the timeline has no row for it yet. */
  time: string | null;
  /** A waiting period's two ends: `08:45 AM – 08:52 AM`. */
  span: string | null;
  /** The pill: "Completed", "7 min", "Not reached". */
  pill: string;
  tone: RecordRowTone;
};

/**
 * The rail, top to bottom.
 *
 * Four kinds of row, and each appears only when the timeline justifies it:
 *
 * - **Pickup** — timed from `driver_arrived`, which is the moment the driver was
 *   at the place. Not from `accepted`, which is when they agreed to go.
 * - **Collected** — `passenger_onboard`. Worded by service: a parcel is
 *   collected, a passenger comes aboard. This is the one screen that has to read
 *   correctly for both, and one status covers both.
 * - **Waiting** — one row per period, start to end, with the minutes. The same
 *   rows `WaitingTimeCalculator` bills from.
 * - **Drop-off** — `trip_completed`.
 *
 * A trip that ended some other way gets a final row naming how, and its drop-off
 * row says the place was never reached. A trip that has not started yet gets the
 * two place rows with no times, which is the honest picture of an unanswered
 * corporate assignment — the state this screen also owns.
 */
export function recordRows(
  trip: Trip,
  events: TripEvent[] | undefined,
  now: number,
): RecordRow[] {
  const timeline = events ?? [];
  const reached = (status: TripEvent['to_status']) => timeline.some((e) => e.to_status === status);

  const rows: RecordRow[] = [];

  const arrivedAt = at(timeline, 'driver_arrived');

  rows.push({
    kind: 'pickup',
    label: 'Pickup',
    place: trip.pickup.label,
    time: arrivedAt,
    span: null,
    ...(arrivedAt === null
      ? { pill: 'Not reached', tone: 'neutral' as const }
      : { pill: 'Completed', tone: 'good' as const }),
  });

  const collectedAt = at(timeline, 'passenger_onboard');

  if (collectedAt !== null) {
    rows.push({
      kind: 'collected',
      // The whole reason this screen takes `service_type`. A delivery driver
      // reading "Passenger aboard" about a box of documents is reading a screen
      // written for somebody else's job.
      label: trip.service_type === 'delivery' ? 'Parcel collected' : 'Passenger aboard',
      place: null,
      time: collectedAt,
      span: null,
      pill: 'Completed',
      tone: 'good',
    });
  }

  rows.push(...waitingRows(timeline, now));

  const completedAt = at(timeline, 'trip_completed');

  rows.push({
    kind: 'dropoff',
    label: 'Drop-off',
    place: trip.dropoff.label,
    time: completedAt,
    span: null,
    ...(completedAt === null
      ? { pill: 'Not reached', tone: 'neutral' as const }
      : { pill: 'Completed', tone: 'good' as const }),
  });

  // How it ended, when it did not end at the drop-off. `statusLabel` is the
  // one place a status is spelled for a driver; a second wording here would
  // give the app two vocabularies for one fact.
  for (const status of ['cancelled', 'no_show', 'rejected'] as const) {
    if (!reached(status)) {
      continue;
    }

    rows.push({
      kind: 'ended',
      label: statusLabel(status),
      place: null,
      time: at(timeline, status),
      span: null,
      pill: statusLabel(status),
      tone: status === 'rejected' ? 'neutral' : 'danger',
    });
  }

  return rows;
}

/**
 * One row per pause.
 *
 * **A deliberate transcription of `WaitingTimeCalculator`'s period-finding**,
 * the same one `progress.ts::waitingSecondsFrom` makes and for the same reason:
 * a driver reading one number while the invoice is computed from another is how
 * a waiting charge becomes an argument nobody can settle. A period opens on a
 * transition *into* `waiting` and closes on the next transition of any kind —
 * not specifically on `trip_resumed`, which is only today's single legal exit.
 *
 * A period still open is measured against `now` and labelled as running. The
 * server excludes an unfinished pause because it is not billable yet; this is
 * answering "how long was I sitting there", which has an answer while it is
 * still happening.
 */
function waitingRows(events: TripEvent[], now: number): RecordRow[] {
  const rows: RecordRow[] = [];

  let openedAt: number | null = null;
  let openedLabel: string | null = null;

  for (const event of events) {
    const moment = event.created_at === null ? NaN : Date.parse(event.created_at);

    if (Number.isNaN(moment)) {
      continue;
    }

    if (event.to_status === 'waiting') {
      // Only the first of consecutive `waiting` rows opens a period. The graph
      // forbids `waiting → waiting`, but ADR-0023 says a blind replay of the
      // outbox is exactly what produces a duplicate, and treating a repeat as a
      // restart would drop the time in between.
      openedAt ??= moment;
      openedLabel ??= clock(event);

      continue;
    }

    if (openedAt !== null) {
      rows.push(waitingRow(openedLabel, clock(event), moment - openedAt, false));
      openedAt = null;
      openedLabel = null;
    }
  }

  if (openedAt !== null) {
    rows.push(waitingRow(openedLabel, null, now - openedAt, true));
  }

  return rows;
}

function waitingRow(
  from: string | null,
  to: string | null,
  elapsedMs: number,
  running: boolean,
): RecordRow {
  // Whole minutes, floored, which is what `WaitingTimeCalculator` bills on.
  // Rounding up here would show a driver a minute the invoice does not have.
  const minutes = Math.max(0, Math.floor(elapsedMs / 60_000));

  return {
    kind: 'waiting',
    label: running ? 'Waiting now' : 'Waiting',
    place: null,
    time: from,
    span: from === null ? null : `${from}${to === null ? ' – now' : ` – ${to}`}`,
    pill: `${minutes} min`,
    tone: 'warning',
  };
}

/**
 * One rail row as a single sentence.
 *
 * `docs/screen-rules.md` §6. Left to itself a row linearises into four
 * fragments — "Pickup", "08:30 AM", "Acacia Mall", "Completed" — and a driver
 * listening to a timeline needs them as one statement about one moment. The
 * pill is included because it carries the fact the tint only decorates.
 */
export function railAnnouncement(row: RecordRow): string {
  // The label and its moment are one clause, not two sentences: "Pickup. at
  // 08:30 AM." is what a naive join produces and it reads as a fault.
  const head =
    row.span !== null
      ? `${row.label}, ${row.span}`
      : row.time === null
        ? row.label
        : `${row.label} at ${row.time}`;

  const parts = [head];

  if (row.place !== null) {
    parts.push(row.place);
  }

  // Not repeated when it is the label already — a cancelled row's pill and its
  // label are the same word, and "Cancelled. Cancelled." is how a screen reader
  // teaches somebody to stop listening.
  if (row.pill !== row.label) {
    parts.push(row.pill);
  }

  return `${parts.join('. ')}.`;
}

/** `08:30 AM` from the server's fleet-zone `HH:MM`, or null. */
function clock(event: TripEvent): string | null {
  return event.local_time === null ? null : timeLabel(event.local_time);
}

/** When a status was first reached, as a clock reading. */
function at(events: TripEvent[], status: TripEvent['to_status']): string | null {
  const event = events.find((candidate) => candidate.to_status === status);

  return event === undefined ? null : clock(event);
}

/**
 * The date the trip happened, from the timeline: `15 Aug 2026`.
 *
 * `local_day` is the server's `YYYY-MM-DD` in the fleet's zone, and this is
 * pure string arithmetic over it — no `Date`, no `Intl`, nothing whose answer
 * depends on the handset's zone or on which Hermes build is installed.
 *
 * **No "Today" or "Yesterday".** Those are comparisons against the server's own
 * day keys, which this endpoint does not serve; computing them from the phone's
 * clock is the defect `DriverTripResource` documents at length.
 */
export function recordDate(events: TripEvent[] | undefined): string | null {
  const day = (events ?? []).find((event) => event.local_day !== null)?.local_day ?? null;

  if (day === null) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);

  if (match === null) {
    return day;
  }

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[Number(match[2]) - 1];

  return month === undefined ? day : `${Number(match[3])} ${month} ${match[1]}`;
}

/**
 * The identifier a driver reads out when they ring the office.
 *
 * **The customer's reference where there is one, the trip's own number where
 * there is not — and it says which.** `order_requests.reference` is on the
 * customer's confirmation; a corporate trip has a booking instead and no
 * reference at all, so a screen that showed a bare number would have the driver
 * and the office quoting different strings at each other.
 */
export function recordIdentifier(trip: Trip): { value: string; label: string } {
  return trip.reference === null
    ? { value: `#${trip.id}`, label: 'Trip number' }
    : { value: trip.reference, label: 'Booking reference' };
}

/**
 * What the driver made on this trip, and what they are holding for the office.
 *
 * **Sign-based, never a list of kinds**, and that is deliberate: a credit is a
 * positive `amount_minor` and a debt is a negative one (ADR-0029 §2 makes the
 * sign the meaning). Classifying by `kind` would be this app holding an opinion
 * about which kinds are earnings — the rule
 * `DriverEarningsService::entries()` owns server-side — and it would be wrong
 * the day a kind is added.
 *
 * The two figures answer different questions and both are needed:
 *
 * - **`earnedMinor`** is what the trip paid: the fare share plus any tip, peak
 *   uplift or bonus. It matches what `/me/earnings` counts for the same trip,
 *   because both sum credits only.
 * - **`cashHeldMinor`** is the office's money in the driver's pocket on a cash
 *   job. Summing the two would report a finished cash ride as roughly *minus
 *   the commission*, which is the trap `Modules/Drivers/README.md` records.
 */
export function recordMoney(lines: DriverLedgerEntry[]): {
  earnedMinor: number;
  cashHeldMinor: number;
  currency: string | null;
} {
  let earnedMinor = 0;
  let cashHeldMinor = 0;

  for (const line of lines) {
    if (line.amount_minor >= 0) {
      earnedMinor += line.amount_minor;
    } else {
      cashHeldMinor -= line.amount_minor;
    }
  }

  return {
    earnedMinor,
    cashHeldMinor,
    // Every row of one trip is in one currency; the first that says so answers
    // for all of them. Null on an empty list, which renders as no figure rather
    // than as a bare number with no unit.
    currency: lines[0]?.currency ?? null,
  };
}

/**
 * The sentence under a cash job's summary.
 *
 * Null when nothing is held, so the screen draws no line rather than a
 * reassuring "you owe nothing" nobody asked for. The wording is the wallet
 * screen's: direction in words, because the owner could not tell a minus sign
 * from a bug and a driver in sunlight certainly cannot.
 */
export function cashNote(cashHeldMinor: number, money: string): string | null {
  return cashHeldMinor === 0
    ? null
    : `You took ${money} in cash on this trip, so the office's share of it is owed from your wallet.`;
}

/** A whole number of minutes, or an em dash. Never `0 min` for "not known". */
export function minutesLabel(minutes: number | null): string {
  return minutes === null ? NO_FIGURE : `${minutes} min`;
}

/**
 * Whole minutes this trip spent paused, or null where the question does not
 * apply yet.
 *
 * **`0` and "not applicable" are different answers, and this is the distinction
 * a test caught.** A completed trip that never stopped genuinely waited zero
 * minutes — that is a fact, and it should say so. A trip that was cancelled at
 * the kerb never *could* have waited: billable waiting begins inside a journey
 * (`WaitingTimeCalculator` opens a period on a transition into `waiting`, which
 * is unreachable before `trip_started`), so a `0 min` on it is a statement about
 * time that never existed. `docs/screen-rules.md` §1: a zero is not a substitute
 * for unknown.
 *
 * The gate is therefore whether the journey ever started, read from the timeline
 * first and from `started_at` second — the same order and the same reasoning as
 * `progress.ts::startedAtFrom`, which documents why the column is a legitimate
 * fallback for a figure that bills nothing.
 *
 * Null too while the timeline is still in flight: it arrives in a second request,
 * and a zero drawn in that window would be replaced by a real figure a moment
 * later, which is worse than a dash that fills in.
 */
export function waitingMinutesFrom(
  trip: Trip,
  events: TripEvent[] | undefined,
  now: number,
): number | null {
  if (events === undefined) {
    return null;
  }

  const started =
    events.some((event) => event.to_status === 'trip_started') || trip.started_at !== null;

  if (!started) {
    return null;
  }

  return Math.floor(waitingSecondsFrom(events, now) / 60);
}

/**
 * Kilometres as the odometer pair measured them, to one decimal.
 *
 * `distance_km` is the *odometer* figure — the one an auditor reconciles
 * (ADR-0035) — and it is null until the closing reading lands. Null renders as
 * an em dash: a `0.0 km` on a trip somebody drove is a claim, not a gap.
 *
 * **A string, not a number, and that is the contract rather than an oversight.**
 * `trips.distance_km` is `decimal(8,2)`, which every MySQL driver hands back as
 * a string so no float ever touches it (AGENTS.md's money and measurement rule
 * applies to the figure an invoice is reconciled against). It arrives as
 * `"12.60"`, so it is parsed here and re-rendered at one decimal — passing it
 * through untouched would print `12.60 km`, and `Number()` alone would print
 * `12.6` for `"12.60"` but `13` for `"13.00"`, which reads as a different
 * precision on every other trip.
 */
export function distanceLabel(distanceKm: string | number | null): string {
  if (distanceKm === null) {
    return NO_FIGURE;
  }

  const kilometres = Number(distanceKm);

  // A value that will not parse is not a distance. An em dash, never `NaN km`.
  return Number.isFinite(kilometres) ? `${kilometres.toFixed(1)} km` : NO_FIGURE;
}
