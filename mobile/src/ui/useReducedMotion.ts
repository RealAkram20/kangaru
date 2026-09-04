import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether this driver has asked the operating system for less motion.
 *
 * One hook, because `docs/screen-rules.md` §5 makes one promise — *respect
 * reduced motion: gentler, not absent* — and a promise kept in two places
 * drifts. `HeroCarousel` used to carry this inline; the stack transitions
 * needed the same answer, and a second copy would be the point where the two
 * disagree about what "reduced" means.
 *
 * Starts `false` and corrects itself: the platform read is asynchronous, and a
 * frame of full motion before the answer arrives is invisible, where a frame
 * of *no* motion for somebody who never asked for it is a flicker on every
 * cold start. Listens afterwards, because the switch lives in a settings pane
 * a driver can reach without leaving this app.
 */
export function useReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;

    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (alive) {
        setReduceMotion(on);
      }
    });

    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);

    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return reduceMotion;
}
