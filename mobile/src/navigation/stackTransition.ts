import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { Platform } from 'react-native';

import { useReducedMotion } from '../ui/useReducedMotion';

/**
 * How a screen arrives, decided once for every stack in the app.
 *
 * ## What was wrong
 *
 * No stack named an `animation`, so Android played its *stock activity
 * transition* — a fade-and-zoom that is not a designed motion at all, differs
 * between OEMs, and on the fleet's handsets reads as slow. That, compounded
 * by the mount stall `useAfterTransition` removes, was the owner's *"lagging,
 * immature vibes"*. The push and pop themselves were already native and off
 * the JavaScript thread; what they lacked was a decision.
 *
 * ## The decision
 *
 * **`ios_from_right` on Android.** react-native-screens implements it
 * natively: the new screen pushes in from the right and the one beneath
 * parallaxes and dims, which is the motion every polished app on the same
 * handset already uses and the one a thumb's back-swipe undoes. It is the
 * *spatial consistency* purpose from `animate` — a push shows where a screen
 * came from and a pop where it goes — and a navigation push happens tens of
 * times a shift, so the motion is fast and native rather than decorated.
 * On iOS `default` already *is* that push.
 *
 * `animationDuration` is iOS-only in this stack, so on Android the type of
 * transition is the whole lever; the durations are react-native-screens' own,
 * and they are already inside the 300ms the standard asks of UI motion.
 *
 * **A sheet slides from the bottom.** The odometer form is presented as a
 * modal and should arrive like one, not like the next page of a book.
 *
 * **Reduced motion is gentler, not absent** (`docs/screen-rules.md` §5): a
 * crossfade still tells a driver that the screen changed, without the travel.
 * The native stack does not read the OS setting on Android by itself, so this
 * does.
 *
 * Pure functions decide; the hooks only supply the one input that changes at
 * run time. That split is what makes the decision testable without rendering
 * a navigator.
 */

type StackAnimation = NonNullable<NativeStackNavigationOptions['animation']>;

/** The push every stack uses. */
export function stackAnimation(reduceMotion: boolean): StackAnimation {
  if (reduceMotion) {
    return 'fade';
  }

  return Platform.OS === 'android' ? 'ios_from_right' : 'default';
}

/** The arrival of a modal sheet. */
export function sheetAnimation(reduceMotion: boolean): StackAnimation {
  return reduceMotion ? 'fade' : 'slide_from_bottom';
}

/** `screenOptions` for a stack: spread it, then add the stack's own. */
export function useStackTransition(): Pick<NativeStackNavigationOptions, 'animation'> {
  const reduceMotion = useReducedMotion();

  return { animation: stackAnimation(reduceMotion) };
}

/** `options` for a screen presented as a sheet. */
export function useSheetTransition(): Pick<NativeStackNavigationOptions, 'animation' | 'presentation'> {
  const reduceMotion = useReducedMotion();

  return { presentation: 'modal', animation: sheetAnimation(reduceMotion) };
}
