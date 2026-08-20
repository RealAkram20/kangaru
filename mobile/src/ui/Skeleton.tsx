import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View, type DimensionValue, type ViewStyle } from 'react-native';

import { useReducedMotion } from './motion';
import { colors, motion, radius, spacing } from './theme';

/**
 * The shape of a screen while its figures are still arriving.
 *
 * ## Why this replaces the spinner
 *
 * Seven screens drew an `ActivityIndicator` in the middle of an empty page.
 * A spinner says *something is happening*; it does not say **what is coming**,
 * and on a handset that has just been unlocked in the sun it reads as the app
 * having nothing. A placeholder in the shape of the list that is about to load
 * answers the driver's actual question — is this screen empty, or is it not
 * ready — which are two completely different answers and were drawn
 * identically.
 *
 * It also holds the layout still. A spinner collapses to nothing the moment
 * data lands and the page jumps; blocks the size of the rows they stand in for
 * do not.
 *
 * ## The pulse has a reason, and it stops when asked
 *
 * `docs/screen-rules.md` §5 forbids decoration on a high-frequency surface, and
 * a driver opens these screens daily — so the motion has to earn its place
 * rather than be there because placeholders usually shimmer. It earns it by
 * being the only thing on the page that distinguishes *loading* from *stuck*:
 * static grey blocks on a dead connection are indistinguishable from a rendered
 * empty state, which is the exact confusion this component exists to remove.
 *
 * It is a slow opacity pulse — `transform` and `opacity` only, per the same
 * rule — and **under reduced motion it does not run at all**, holding at the
 * brighter end so nothing looks disabled. Gentler, not absent, is the rule for
 * meaningful motion; here the honest reduction is stillness, because the thing
 * the motion communicates is also carried by the "Loading" announcement below.
 *
 * ## One announcement, not a wall of blocks
 *
 * A screen reader is told "Loading" once by the container and the blocks
 * themselves are hidden. Without that, a placeholder list linearises into a
 * dozen unlabelled views — noise in place of the one fact that matters.
 */
export function Skeleton({
  width = '100%',
  height = 16,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  style?: ViewStyle;
}) {
  const opacity = usePulse();

  return (
    <Animated.View
      style={[
        styles.block,
        // A pill for anything short enough to be a chip, a small radius for a
        // block of text: matching what stands here when the data arrives.
        { width, height, borderRadius: height >= 32 ? radius.md : radius.sm, opacity },
        style,
      ]}
    />
  );
}

/**
 * A stack of list rows: a chip, two lines of text, and a value on the right.
 *
 * The shape every list in this app shares — statement rows, notifications,
 * trips, documents — so one placeholder serves all of them rather than each
 * screen drawing its own.
 */
export function SkeletonRows({ count = 4, style }: { count?: number; style?: ViewStyle }) {
  return (
    <View
      style={[styles.rows, style]}
      accessible
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
    >
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.row} importantForAccessibility="no-hide-descendants">
          <Skeleton width={44} height={44} />

          <View style={styles.lines}>
            {/*
              Two unequal lines rather than two full-width ones. A row of equal
              bars reads as a table; the ragged second line is what makes this
              read as text that has not arrived.
            */}
            <Skeleton width="70%" height={14} />
            <Skeleton width="45%" height={12} />
          </View>

          <Skeleton width={64} height={14} />
        </View>
      ))}
    </View>
  );
}

/** A card-shaped placeholder, for the screens that load cards rather than rows. */
export function SkeletonCards({ count = 2, style }: { count?: number; style?: ViewStyle }) {
  return (
    <View
      style={[styles.rows, style]}
      accessible
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
    >
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.card} importantForAccessibility="no-hide-descendants">
          <Skeleton width="55%" height={18} />
          <Skeleton width="85%" height={14} />
          <Skeleton width="40%" height={14} />
        </View>
      ))}
    </View>
  );
}

/**
 * The pulse, or a steady value when the phone asks for less motion.
 *
 * `useNativeDriver` because opacity is one of the two properties the native
 * driver takes, and this runs while the JS thread is busy parsing the response
 * it is standing in for — the one moment a JS-driven animation would stutter.
 *
 * Exported for `Handover`, whose active step is the same statement in a
 * different shape: *this one is happening, the app is not stuck*. AGENTS.md
 * makes a thing shared the moment it has a second caller, and a second copy of
 * a loop with its own duration would be two answers to "how fast does waiting
 * look in this app".
 */
export function usePulse(): Animated.Value | number {
  const reduced = useReducedMotion();
  const [value] = useState(() => new Animated.Value(REST));

  useEffect(() => {
    if (reduced) {
      // Held at the brighter end. A dimmed static block reads as disabled.
      value.setValue(1);

      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 1,
          duration: PULSE_MS,
          easing: motion.easeInOut,
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: REST,
          duration: PULSE_MS,
          easing: motion.easeInOut,
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();

    return () => loop.stop();
  }, [reduced, value]);

  return reduced ? 1 : value;
}

/**
 * Slow enough to read as breathing rather than blinking.
 *
 * Deliberately outside the theme's `motion` durations, which are all under
 * 300ms because they describe *transitions* — a control answering a thumb. This
 * is an ambient loop, and at 300ms it would flicker.
 */
const PULSE_MS = 900;

/** The dim end of the pulse. Never zero: a block that vanishes is a layout jump. */
const REST = 0.45;

const styles = StyleSheet.create({
  block: {
    backgroundColor: colors.surfaceSunken,
    // A hairline, because `surfaceSunken` on `surface` is a two-percent
    // difference and vanishes in direct sun — the condition this app is sized
    // for. The border is what makes the shape legible outdoors.
    borderWidth: 1,
    borderColor: colors.border,
  },
  rows: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  lines: {
    flex: 1,
    gap: spacing.sm,
  },
  card: {
    gap: spacing.sm + 2,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
});
