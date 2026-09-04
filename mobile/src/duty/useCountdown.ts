import { useEffect, useState } from 'react';

import type { DispatchOffer } from '../api/types';
import { secondsRemaining } from './countdown';

/**
 * Seconds left on an offer, counted from the server's number.
 *
 * Shared by the offer card and the offer screen. It lived privately inside
 * `OfferCard` until the screen needed the same clock, and a second copy of a
 * countdown is the kind of duplication that goes wrong quietly: two surfaces
 * showing the same job with different numbers on them, and no way to tell
 * which one a driver was looking at when they missed it.
 *
 * **Seeded from `expires_in_seconds`, not from `expires_at` minus the local
 * clock.** Cheap Android handsets routinely run minutes out, and a countdown
 * against a wrong clock either shows forty seconds on a fifteen-second offer
 * or shows a job that already expired. The server counted the gap on one
 * clock; that number is trustworthy in a way a difference between two clocks
 * is not. The arithmetic itself lives in `./countdown`, where it is covered
 * by tests that cannot be broken by a concurrent renderer.
 *
 * The interval only ever counts down locally, so drift within a single
 * fifteen-second offer is irrelevant.
 */
export function useCountdown(offer: DispatchOffer): number {
  // Seconds *since this offer arrived*, not a clock reading.
  //
  // Deliberately **not** re-seeded on every poll. The offer's expiry is
  // fixed, so a local decrement is accurate over a fifteen-second window,
  // and re-seeding would mean writing state from inside an effect on every
  // poll — a cascading render each time, for a number that was already
  // right, and a visible stutter as the number jumped back to the server's
  // slightly staler count. The React Compiler's `set-state-in-effect` rule
  // refuses that shape outright, and it is right to.
  //
  // **A genuinely different offer is therefore a remount, not a reset.**
  // Both callers arrange it: `OfferCard` gets it free from its `key` in a
  // list, and `OfferPresenter` keys the screen on the offer id for exactly
  // this reason. Without that key a second job would inherit the first
  // one's elapsed seconds and open its countdown already part-drained — so
  // if you ever render this hook somewhere new, key that component too.
  const [elapsed, setElapsed] = useState(0);

  // **The server's number is read once, at mount, and never again.** The
  // offer prop is replaced on every poll with a fresher — smaller —
  // `expires_in_seconds`, and this hook used to subtract the locally elapsed
  // seconds from *that*: at mount 15 − 0 = 15; five seconds later the poll
  // said 10 and the clock said 5, so the ring showed 5; five more and it
  // showed 0 with the offer still open. Two clocks running against each
  // other, and the countdown ran at double speed. The owner, from a handset:
  // "the count down is not working right." One reading, one clock.
  const [seeded] = useState(() => offer.expires_in_seconds);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed((seconds) => seconds + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [offer.id]);

  return secondsRemaining({ expires_in_seconds: seeded }, elapsed);
}
