import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the driver has asked their phone to reduce motion.
 *
 * `HeroCarousel` and `OfferScreen` each grew their own copy of this — the same
 * fifteen lines, the same asynchronous read, the same subscription — which is
 * AGENTS.md's duplication rule twice over. This is the shared home for the
 * third caller (`Skeleton`), and the two existing copies should collapse into
 * it when somebody is next in those files. **Not refactored here**: both belong
 * to other screens and a copy pass is no place to rewrite an entrance
 * animation.
 *
 * **Read, never assumed, and the read is asynchronous on both platforms** — the
 * flag arrives a frame or two after mount, so a caller must be correct while it
 * is still `false` rather than starting a motion it then has to cancel.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) {
        setReduced(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduced;
}
