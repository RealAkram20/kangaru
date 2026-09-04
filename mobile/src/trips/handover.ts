import { useEffect, useRef, useState } from 'react';

/**
 * When the hand-over between two legs of a job is allowed to be seen.
 *
 * ## The rule this exists to satisfy
 *
 * The owner asked for a full-screen moment between accepting a job and driving
 * to the passenger — *"connecting to the client, finding the best route"* —
 * and `docs/screen-rules.md` §5 forbids animating a surface a driver meets
 * dozens of times a day. Both are right. What reconciles them is **binding
 * every stage to a request that is genuinely outstanding**: on the first job
 * of a shift, with a cold cache and a fix still landing, the driver sees the
 * sequence; on the twentieth, everything is already in hand and the moment
 * never appears at all.
 *
 * That also settles §1. "Finding the best route" on a timer is a sentence the
 * app is not doing; the same sentence over a live request is a report.
 *
 * ## Three timings, and they do different jobs
 *
 * `APPEAR_AFTER_MS` is what makes the paragraph above true. Without it a warm
 * open still paints the moment for the one frame before the cache resolves,
 * which is a flash of full-screen white — worse than the wait it was meant to
 * cover. A request that settles inside this window is one the driver never
 * needed to be told about.
 *
 * `AT_LEAST_MS` is the opposite: once the moment *has* been shown, it stays
 * long enough to be read. A surface that appears and vanishes in 80ms
 * registers as a glitch in the app rather than as an answer, and a driver
 * glancing up from the road gets neither the word nor the reassurance.
 *
 * Neither is a delay imposed on the driver. Nothing here holds a screen that
 * is ready — the floor only runs down while the driver is already looking at a
 * moment that had to exist.
 *
 * `GIVE_UP_AFTER_MS` is the one that stops this being a trap, and it matters
 * more than either. The API client allows a request fifteen seconds before it
 * aborts, and the routing engine in front of it is a rate-limited public
 * server — so "wait for the road" can mean **fifteen seconds with the
 * passenger's phone number behind a loading screen**, on the one surface a
 * driver opens because they need to ring somebody. Long before that this
 * stands down and hands over the screen it was covering: the map has always
 * been able to draw its dashed direct line, the route arrives whenever it
 * arrives and simply draws itself, and nothing about the job was waiting on
 * it.
 *
 * ## Standing down is final
 *
 * `over` is terminal for the life of the screen, and that is the point of
 * having three phases rather than a boolean. `useTripRoute` is keyed on the
 * driver's snapped position, so a new key is a **new query in a pending
 * state — every hundred metres**. Without a terminal phase the hand-over would
 * reappear over the map it had just uncovered, for the whole approach. A
 * re-route is a line redrawing, not a job starting.
 */

/** Long enough that a cache hit is never announced. */
const APPEAR_AFTER_MS = 120;

/** Long enough to be read, once it has earned the screen. */
const AT_LEAST_MS = 400;

/** Short enough that a slow route never holds a phone number hostage. */
const GIVE_UP_AFTER_MS = 4_000;

export type HandoverStep = {
  /** What the app is doing, in the driver's words. Never how long it will take. */
  label: string;
  /** Whether the request behind this step is still outstanding. */
  pending: boolean;
};

export type Handover = {
  /** Whether the moment has earned the screen right now. */
  visible: boolean;
  /** Which step is being reported, zero-based — for the progress rail. */
  step: number;
  /** The step's label, or null when there is nothing to report. */
  label: string | null;
  /** How many steps this hand-over has, for the rail to draw. */
  total: number;
};

/**
 * @param steps In the order they happen. Order matters: the first step still
 *   outstanding is the one reported, so a later step's own pending state is
 *   not shown until everything before it is done.
 */
export function useHandover(steps: HandoverStep[]): Handover {
  const total = steps.length;

  // Derived, not latched. An earlier version kept a settled-once flag per step
  // and it was solving a problem the phase machine below already solves — the
  // only reason a step re-opens is a refetch, and by then the phase is `over`
  // and nothing is on screen to regress. Deriving also keeps this honest: what
  // it reports is what is outstanding *now*.
  const outstanding = steps.findIndex((step) => step.pending);
  const wanted = outstanding !== -1;

  const [phase, setPhase] = useState<'idle' | 'shown' | 'over'>('idle');

  // When the moment became visible, so the floor can be measured from it. A
  // ref, not state: nothing renders differently because of it, and a state
  // write here would be a render for a value only a timer reads.
  const shownAt = useRef<number | null>(null);

  useEffect(() => {
    if (phase === 'over') {
      return undefined;
    }

    if (phase === 'idle') {
      // Settled before the delay elapsed — the ordinary warm-cache path, and
      // the whole point of the delay. The moment simply never happens.
      if (!wanted) {
        return undefined;
      }

      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setPhase('shown');
      }, APPEAR_AFTER_MS);

      return () => clearTimeout(timer);
    }

    // On screen, work still outstanding: the ceiling runs from here. Whatever
    // has not arrived by then is something the screen underneath can live
    // without.
    if (wanted) {
      const timer = setTimeout(() => setPhase('over'), GIVE_UP_AFTER_MS);

      return () => clearTimeout(timer);
    }

    // On screen, work done: hold out the floor, then stand down for good.
    const remaining = Math.max(0, AT_LEAST_MS - (Date.now() - (shownAt.current ?? 0)));
    const timer = setTimeout(() => setPhase('over'), remaining);

    return () => clearTimeout(timer);
  }, [phase, wanted]);

  // While the floor runs down there is no outstanding step, and the last one
  // is what the driver was just told — so it stays on screen rather than
  // blanking for the final fraction of a second.
  const step = outstanding === -1 ? Math.max(0, total - 1) : outstanding;

  return {
    visible: phase === 'shown',
    step,
    label: total === 0 ? null : (steps[step]?.label ?? null),
    total,
  };
}
