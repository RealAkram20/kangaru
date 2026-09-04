import { NavigationContext, type ParamListBase } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useContext, useEffect, useState } from 'react';

/**
 * Whether the screen this is rendered on has finished arriving.
 *
 * ## The stall this exists to remove
 *
 * A native-stack push animates on the native side, off the JavaScript thread —
 * but the *incoming screen mounts on the JavaScript thread while that
 * animation is playing*. Anything heavy in that mount competes with the
 * transition for the frames the driver is watching. The two map components
 * are the worst case: a `WebView` is a native view plus a document parse, and
 * mounting one mid-slide is why a push onto a map screen stuttered and then
 * popped its content in late. The owner's *"it's lagging, it's giving
 * immature vibes"* was that.
 *
 * So a component that is expensive to mount asks this first, and until it
 * answers `true` draws its own frame with nothing inside — the same size, so
 * nothing shifts when the real thing lands (`ui-performance`: reserve space).
 * The slide plays over a light screen; the weight arrives the moment the
 * slide is over.
 *
 * ## How it knows
 *
 * `transitionEnd` is the native stack's own word for it, and the only honest
 * one. Not `InteractionManager.runAfterInteractions`: on Android that tracks
 * JavaScript-side interactions only, a native transition is invisible to it,
 * and it resolves at once — which would defer nothing.
 *
 * A fallback timer stands behind the event for the screens the event never
 * reaches: the root of a stack on a cold start has no transition to end, and
 * a component mounted long after a push (a map that waits for data) attaches
 * its listener after the event has already fired. Both settle on the timer,
 * which is sized to outlast the longest Android push and is short enough that
 * neither case reads as waiting.
 *
 * ## Why it is safe everywhere else
 *
 * With no navigator around it — every screen test in this app renders with
 * `navigation` passed as a prop and no container — it answers `true` at once,
 * so nothing outside a real stack ever waits.
 */

/** Outlasts react-native-screens' longest Android push; short enough that a root screen never reads as waiting. */
export const TRANSITION_FALLBACK_MS = 400;

export function useAfterTransition(): boolean {
  const navigation = useContext(NavigationContext) as
    | NativeStackNavigationProp<ParamListBase>
    | undefined;

  const [settled, setSettled] = useState(() => navigation === undefined);

  useEffect(() => {
    if (navigation === undefined) {
      return;
    }

    const unsubscribe = navigation.addListener('transitionEnd', () => setSettled(true));
    const fallback = setTimeout(() => setSettled(true), TRANSITION_FALLBACK_MS);

    return () => {
      unsubscribe();
      clearTimeout(fallback);
    };
  }, [navigation]);

  return settled;
}
