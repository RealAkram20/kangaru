import type { DriverPerformance } from '../api/endpoints';
import { durationLabel, NO_FIGURE } from '../earnings/presentation';

/**
 * Turning `GET /me/performance` into the six dials and the weekly card.
 *
 * A module rather than helpers inside the screen, for the reason
 * `statsPresentation.ts` records at length: the parts that can be *wrong*
 * rather than merely ugly are the ones worth testing, and this app already
 * shipped `undefined NaN` where a driver's money goes because a formatter
 * lived inline with no test around it.
 *
 * ## The one idea the whole file is about
 *
 * **A dial's arc is a fraction of something real, or there is no arc.**
 *
 * The mockup drew six rings, and two of them — *Total Trips 428* and *Online
 * Hours 7h 20m* — were drawn about three-quarters full against nothing at
 * all. There is no ceiling on a lifetime trip count and none on a day's
 * hours, so the arc was a picture of a number nobody had.
 *
 * `docs/screen-rules.md` §1 forbids inventing that number, and the waiting
 * screen shows what containing an invented ceiling costs when one is
 * genuinely unavoidable — a config key, a served field and three documents
 * explaining that it means nothing. Here it was avoidable: the owner chose to
 * give those two dials real denominators instead, so they now measure trips
 * *this week* against the bonus target and online hours against the hours the
 * driver is *rostered* for.
 *
 * Both of those denominators can legitimately be absent — the bonus scheme is
 * off by default, and a driver with no shift windows is available at any hour
 * (ADR-0017 §3). `fractionOf` returns null there, and the dial draws its track
 * with no arc: a figure with no claim attached to it.
 */

/** The em dash every absent figure in this app falls back to. Never a zero. */
export { NO_FIGURE };

/** What a dial needs to draw itself. */
export type Dial = {
  /** A stable key for tests and for React. */
  key: string;
  /** The big figure inside the ring — already an em dash when absent. */
  value: string;
  /** The word underneath. */
  label: string;
  /**
   * How much of the ring is drawn, 0–1, or **null for no arc at all**.
   *
   * Null is not zero. Zero draws an empty ring, which is a measurement
   * ("none of it"); null draws only the track, which is the absence of one.
   */
  fraction: number | null;
  /**
   * Whether a high number is a *bad* number. Only cancellation is.
   *
   * The screen colours that one dial differently, and the colour is never the
   * only carrier: the label says "Cancellation" and the announcement says so
   * in words (AGENTS.md § Accessibility, DESIGN.md §8).
   */
  inverted?: boolean;
  /** One sentence for a screen reader, composed rather than linearised. */
  announcement: string;
};

/**
 * A ratio, clamped, or null when either side is missing.
 *
 * **Null when the denominator is null, zero, or negative.** A driver with no
 * roster has no target to be measured against, and `x / 0` is either
 * `Infinity` or `NaN` — both of which render as a full ring, congratulating
 * somebody for clearing a bar nobody set.
 */
export function fractionOf(part: number | null | undefined, whole: number | null | undefined): number | null {
  if (part === null || part === undefined || !Number.isFinite(part)) {
    return null;
  }

  if (whole === null || whole === undefined || !Number.isFinite(whole) || whole <= 0) {
    return null;
  }

  // Saturating rather than overflowing. A driver who worked 50 hours against a
  // 40-hour roster has exceeded it, and an arc past 360° would wrap and read
  // as having barely started.
  return Math.min(1, Math.max(0, part / whole));
}

/**
 * A percentage as a driver reads it: "92%".
 *
 * Rounded to whole numbers, unlike the server's one decimal. The dial is a
 * glance from a phone in a cradle and "92.3%" costs a character of width for
 * a tenth of a percent nobody acts on. The *arc* still uses the precise value
 * — rounding is a display choice and does not travel into the geometry.
 */
export function percentLabel(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) {
    return NO_FIGURE;
  }

  return `${Math.round(rate)}%`;
}

/**
 * The rating, or an em dash while it is withheld.
 *
 * **This deliberately does not reuse `trips/statsPresentation.ts`'s
 * `ratingValue`.** That one takes a whole `DriverStats`, and this screen is
 * fed by a different endpoint; passing it a shape it does not expect to reuse
 * four lines is how a helper acquires a union type and stops being obviously
 * correct. The *rule* is shared and is the server's either way — null below
 * five ratings (ADR-0030 §3), and neither function knows the threshold.
 */
export function ratingLabel(rating: number | null | undefined): string {
  return rating === null || rating === undefined || !Number.isFinite(rating)
    ? NO_FIGURE
    : rating.toFixed(1);
}

/**
 * "7h 20m", from seconds — and **"60h", not "60h 0m"**, on the hour.
 *
 * The screen's figures arrive as seconds; the app's one duration formatter
 * takes minutes, so the conversion happens here rather than at three call
 * sites.
 *
 * The trailing `0m` is trimmed here rather than in `durationLabel` itself,
 * which is `earnings/presentation.ts`'s and is right as it stands for what it
 * does — a trip duration is measured and "0m" of it is a real reading. A
 * *roster* is a round figure by nature: rendering it as "60h 0m" only became
 * obviously wrong when the screen was drawn and the sentence underneath read
 * "the 60h 0m you are rostered for". Nothing but rendering it would have
 * caught that.
 *
 * Whole hours only, and never on a sub-hour duration: `0m` on its own is a
 * genuine measurement — a driver who went on duty and straight off again —
 * and must not be trimmed to nothing.
 */
export function hoursLabel(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return NO_FIGURE;
  }

  const label = durationLabel(Math.floor(seconds / 60));

  return label.endsWith('h 0m') ? label.slice(0, -3) : label;
}

/** Out of five, because that is what a rating is. */
const RATING_CEILING = 5;

/**
 * The six dials, in the order the mockup has them.
 *
 * Read this as the screen's whole data model. Every `fraction` is either a
 * ratio of two real numbers or null, and every `value` is either a figure the
 * server sent or an em dash.
 */
export function dialsFor(performance: DriverPerformance | undefined): Dial[] {
  const p = performance;

  const rating = p?.rating ?? null;
  const acceptance = p?.acceptance_rate ?? null;
  const completion = p?.completion_rate ?? null;
  const cancellation = p?.cancellation_rate ?? null;
  const target = p?.bonus?.trip_target ?? null;
  const rostered = p?.rostered_seconds_this_week ?? null;
  const online = p?.online_seconds_this_week ?? null;

  return [
    {
      key: 'rating',
      value: ratingLabel(rating),
      label: 'Rating',
      fraction: fractionOf(rating, RATING_CEILING),
      announcement: ratingAnnouncement(p),
    },
    {
      key: 'acceptance',
      value: percentLabel(acceptance),
      label: 'Acceptance',
      // The denominator is 100 because the figure is already a percentage —
      // the one dial on this screen whose ceiling needs no justifying.
      fraction: fractionOf(acceptance, 100),
      announcement: rateAnnouncement('Acceptance rate', acceptance, p?.window_days),
    },
    {
      key: 'completion',
      value: percentLabel(completion),
      label: 'Completion',
      fraction: fractionOf(completion, 100),
      announcement: rateAnnouncement('Completion rate', completion, p?.window_days),
    },
    {
      key: 'cancellation',
      value: percentLabel(cancellation),
      label: 'Cancellation',
      fraction: fractionOf(cancellation, 100),
      // The only dial where more is worse, and the only one drawn in a
      // warning colour. Marked in the data rather than special-cased by key
      // in the component, so the screen has no opinion it has to keep in step.
      inverted: true,
      announcement: rateAnnouncement('Cancellation rate', cancellation, p?.window_days),
    },
    {
      key: 'trips-week',
      value: p === undefined ? NO_FIGURE : String(p.trips_this_week),
      // **Not the mockup's "Total Trips".** A lifetime count has no ceiling,
      // so its ring had nothing to be a fraction of. This one does: the
      // operator's weekly bonus target. The lifetime figure is not lost — it
      // is the line under the heading, where it needs no denominator.
      //
      // **"Weekly trips", not "Trips this week", and the reason is measured
      // rather than stylistic.** These labels sit in a third of the screen,
      // and `ui/facts.tsx` records that a *fourteen*-character label at 14pt
      // does not hold one line there on a 360dp handset — the narrowest in the
      // fleet — which is why its stat cells drop to 12pt. Fifteen characters
      // truncated to "Trips this wee…". Twelve is the width of "Cancellation",
      // which has shipped on this grid since it was drawn.
      label: 'Weekly trips',
      fraction: fractionOf(p?.trips_this_week, target),
      announcement: tripsAnnouncement(p),
    },
    {
      key: 'online-hours',
      value: hoursLabel(online),
      // **"Weekly hours", not the mockup's "Online Hours".** Reading the
      // rendered grid showed the real cost of the re-basing: four dials are
      // 30-day quality rates and two are this-week volume, and they sit in one
      // grid at identical visual weight. A label that did not name its period
      // left the bottom row half-described and made prose underneath do the
      // work.
      //
      // Naming the period in both makes the pair read as a pair and the grid
      // self-describing, without restructuring the 2×3 the mockup draws — and
      // within the width a third of a 360dp screen actually has. See the trips
      // dial above for the measurement.
      label: 'Weekly hours',
      fraction: fractionOf(online, rostered),
      announcement: onlineAnnouncement(p),
    },
  ];
}

function ratingAnnouncement(p: DriverPerformance | undefined): string {
  if (p === undefined) {
    return 'Rating, not loaded yet.';
  }

  const plural = p.rating_count === 1 ? 'rating' : 'ratings';

  if (p.rating === null) {
    // **The threshold is not named**, and that is the audit agent's finding 5:
    // five is the server's number (ADR-0030 §3), it is not in this payload,
    // and every installed handset would go on asserting it after the office
    // changed it. The count is a fact the server sent.
    return p.rating_count === 0
      ? 'Rating, not published yet. No ratings so far.'
      : `Rating, not published yet. ${p.rating_count} ${plural} so far.`;
  }

  return `Rating ${p.rating.toFixed(1)} out of 5, from ${p.rating_count} ${plural}.`;
}

function rateAnnouncement(name: string, rate: number | null, windowDays: number | undefined): string {
  if (rate === null) {
    return `${name}, no figure yet.`;
  }

  const over = windowDays === undefined ? '' : ` over the last ${windowDays} days`;

  return `${name} ${Math.round(rate)} percent${over}.`;
}

function tripsAnnouncement(p: DriverPerformance | undefined): string {
  if (p === undefined) {
    return 'Trips this week, not loaded yet.';
  }

  const target = p.bonus?.trip_target;

  return target === undefined || target === null
    ? `${p.trips_this_week} trips completed this week.`
    : `${p.trips_this_week} of ${target} trips completed this week.`;
}

function onlineAnnouncement(p: DriverPerformance | undefined): string {
  if (p === undefined) {
    return 'Online hours, not loaded yet.';
  }

  const online = hoursLabel(p.online_seconds_this_week);
  const rostered = p.rostered_seconds_this_week;

  return rostered === null
    ? `Online ${online} this week.`
    : `Online ${online} this week, of ${hoursLabel(rostered)} rostered.`;
}

/**
 * The caption under a dial's figure — the denominator, spelled out.
 *
 * Only where there is one. This is what stops the two re-based dials from
 * being cryptic: "28" over the words *Weekly trips* says nothing about why
 * the ring is three-quarters drawn, and "of 40" says all of it.
 */
export function dialCaption(dial: Dial, performance: DriverPerformance | undefined): string | null {
  if (performance === undefined) {
    return null;
  }

  if (dial.key === 'trips-week') {
    const target = performance.bonus?.trip_target;

    return target === undefined || target === null ? null : `of ${target}`;
  }

  if (dial.key === 'online-hours') {
    const rostered = performance.rostered_seconds_this_week;

    return rostered === null ? null : `of ${hoursLabel(rostered)}`;
  }

  return null;
}

/**
 * The one line of explanation under the grid — and it used to be two blocks.
 *
 * What was there read *"Rating, acceptance, completion and cancellation are
 * measured over the last 30 days."* followed by a second paragraph on the
 * roster. Thirty-five words under six dials that carry their own labels, on a
 * screen a driver scans in a cradle.
 *
 * **The old sentence was also wrong.** `DriverStatsService::rating()` takes the
 * mean of the most recent *ratings* — a sample, with no date filter anywhere in
 * the query — so naming the rating in a 30-day claim asserted a window the
 * server does not apply. Saying "rates" is both shorter and true: the three
 * percentages are the windowed figures.
 *
 * The roster clause survives because "of 45h" under a ring says nothing about
 * where 45h came from, and only appears where a roster exists to say it about.
 */
export function gridNote(performance: DriverPerformance | undefined): string {
  if (performance === undefined) {
    // A space, not an empty string: the line holds its height so the card
    // below does not jump upward when the figures land.
    return ' ';
  }

  const rates = `Rates cover the last ${performance.window_days} days.`;

  return performance.rostered_seconds_this_week === null
    ? rates
    : `${rates} Hours are measured against your roster.`;
}

/**
 * The line under the screen's heading.
 *
 * The mockup's was "Great job! Keep it up." — which this platform cannot say,
 * because it is a judgement about work the app has not assessed, and it would
 * be said identically to a driver at 40% acceptance. A figure they earned is
 * both truer and better praise.
 */
export function headingNote(performance: DriverPerformance | undefined): string {
  if (performance === undefined) {
    return 'Loading your figures…';
  }

  const trips = performance.trips_total;

  if (trips === 0) {
    return 'Your figures appear here once you have completed a trip.';
  }

  return `${trips.toLocaleString()} ${trips === 1 ? 'trip' : 'trips'} completed, all time.`;
}

/** What the weekly card says under its bar. */
export function bonusNote(performance: DriverPerformance | undefined): string | null {
  const bonus = performance?.bonus;

  if (bonus === undefined || bonus === null) {
    return null;
  }

  if (bonus.achieved) {
    // **Not "you have earned it".** Nothing is paid until the week closes and
    // the award command runs (ADR-0034 §4), and a driver told they have the
    // money before it exists has been lied to about money. `achieved` is the
    // server's word for "the count is there", not for "it is in your wallet".
    return 'Target hit. The bonus is credited after the week closes.';
  }

  const remaining = bonus.trip_target - bonus.trips;

  return `Complete ${remaining} more ${remaining === 1 ? 'trip' : 'trips'} to reach your weekly bonus.`;
}
