import type { TripRoute } from '../api/types';
import { formatKilometres } from '../duty/offerPresentation';

/**
 * How far through the drive the driver actually is.
 *
 * The owner, from a handset: *"the driver can not see where he is from the
 * entire route so they find it hard to tell the progress visually"*. The map
 * had only ever drawn the road **ahead** — `useTripRoute` routes from the
 * driver's own fix, so the line starts under their feet — and then framed the
 * camera on it, which meant the remaining road filled the screen at every
 * stage of the trip. Ten per cent in and ninety per cent in looked the same.
 *
 * The map answers that with a picture (see `PickupMap`); this module is the
 * arithmetic behind the figure that sits under it.
 *
 * ## Why this is allowed to exist at all
 *
 * `docs/screen-rules.md` §1 forbids a number the platform cannot produce, and
 * `Handover.tsx` sharpens it for exactly this shape: *"a progress bar that
 * fills at a rate somebody chose is the same lie in a friendlier shape."*
 *
 * This one does not fill at a chosen rate. It is the ratio of **two road
 * distances the routing provider measured, to the same destination** — what is
 * left, over the whole leg. Nothing is derived from a hypotenuse, nothing is
 * derived from time, and no minutes are ever produced here: ADR-0031 §6 allows
 * only the provider's own duration, which travels separately and is rendered
 * with the word "about" in front of it.
 *
 * It also fails honestly rather than flattering. A driver who takes a detour
 * sees the remaining road *grow*, so the fraction retreats — which is true,
 * and is the opposite of what a bar driven by elapsed time would have done.
 */

/**
 * The fraction of the measured road that is behind the driver, `0`…`1`, or
 * null when it cannot be measured.
 *
 * Null — not zero — whenever either road is missing. Zero is a claim that the
 * driver has not moved, and `UGX 0` reading as a free ride is the same mistake
 * §1 names: an unknown rendered as a value.
 */
export function journeyProgress(
  remainingKm: number | null | undefined,
  legKm: number | null | undefined,
): number | null {
  if (remainingKm === null || remainingKm === undefined || !Number.isFinite(remainingKm)) {
    return null;
  }

  // `> 0` rather than `!== 0`, which also disposes of a negative leg and of
  // NaN. A zero-length leg has no fraction to give — pickup and drop-off on
  // the same spot is a real keying mistake, and it must not divide.
  if (legKm === null || legKm === undefined || !Number.isFinite(legKm) || legKm <= 0) {
    return null;
  }

  /*
   * Clamped, and both ends earn it.
   *
   * Over 1: the remaining road can exceed the whole leg — a detour, a driver
   * who set off in the wrong direction, or simply a fix taken before they
   * reached the pickup, since the leg is measured *from* the pickup. A bar
   * that ran backwards past its own start would read as broken.
   *
   * Under 1 at the far end: the two roads are separate measurements taken at
   * different moments, so "remaining" can land a few metres negative against
   * a leg measured earlier. Arriving is 100%, not 103%.
   */
  return Math.min(1, Math.max(0, (legKm - remainingKm) / legKm));
}

/**
 * The whole leg's length, in the same words the rest of the app says
 * distances in — or null, which is the caller's cue to draw no bar.
 *
 * Deliberately routed through `formatKilometres` rather than formatted here,
 * so a distance on this screen cannot round differently from the same distance
 * on the offer card that produced the job.
 */
export function journeyTotal(leg: TripRoute | null | undefined): string | null {
  return leg === null || leg === undefined ? null : formatKilometres(leg.distance_km);
}

/**
 * The whole footer as one sentence, for a screen reader.
 *
 * Composed here rather than left to the views for the reason
 * `docs/screen-rules.md` §6 gives: a headline figure, a bar and a caption
 * linearise into three disconnected fragments, and a bar linearises into
 * nothing at all. This is the one sentence a driver needs read out.
 *
 * **The bar's fraction is spoken as the two distances, never as a
 * percentage.** A percentage read aloud mid-drive is the figure most likely to
 * be heard as time remaining, which is the claim this whole module refuses to
 * make.
 */
export function journeyAnnouncement({
  remaining,
  total,
  byRoad,
  durationSeconds,
}: {
  /** What is left, already formatted, or null when there is no figure at all. */
  remaining: string | null;
  /** The whole leg, already formatted, or null when it was not measured. */
  total: string | null;
  /** Whether `remaining` followed a road, or is the crow's flight. */
  byRoad: boolean;
  /** The provider's own estimate. Null means no minutes are spoken. */
  durationSeconds: number | null;
}): string {
  if (remaining === null) {
    return 'Distance to the destination is not available.';
  }

  const parts: string[] = [];

  parts.push(
    total === null
      ? `${remaining} to go${byRoad ? ', by road' : ', straight line rather than by road'}.`
      : `${remaining} to go of ${total} by road.`,
  );

  if (durationSeconds !== null) {
    // "About", and it is load-bearing: ADR-0031 §6 permits the provider's
    // duration only as a forecast, never as a promise of arrival — and a
    // spoken figure loses whatever hedging the layout was carrying.
    parts.push(`About ${minutesOf(durationSeconds)} minutes, estimated.`);
  }

  return parts.join(' ');
}

/**
 * The provider's seconds as whole minutes, floored at one.
 *
 * The same arithmetic the footer prints, kept in one place so the spoken
 * figure and the written one cannot disagree — a screen reader saying "about
 * 0 minutes" beside a label reading "about 1 min" is a bug nobody would ever
 * see on a screen.
 */
function minutesOf(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}
