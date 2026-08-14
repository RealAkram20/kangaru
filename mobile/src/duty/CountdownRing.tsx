import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors, typography } from '../ui/theme';
import { isRunningOut } from './countdown';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SIZE = 52;
const STROKE = 4;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The clock on the offer screen: a draining ring with the number inside it.
 *
 * Two readings of one fact, on purpose, and it is the same pairing
 * `OfferCard` makes with its bar. The ring answers *how urgent* from the
 * corner of an eye — a shape, no reading required — and the number answers
 * *can I finish this sentence first*. A driver under a fifteen-second clock
 * wants both, and neither alone does the other's job.
 *
 * ## Why this one animation is not on the native driver
 *
 * Everything else that moves in this app runs on the UI thread, and the
 * sibling `CountdownBar` says why in as many words: an animated `width`
 * re-runs layout sixty times a second on the thread also handling the poll
 * and the accept. This does not, and the difference is the whole argument.
 *
 * `strokeDashoffset` is not a transform, so React Native's native driver
 * cannot carry it — but it is also not a layout property. Each frame updates
 * one attribute on one SVG node: no measure, no layout, no reflow of
 * anything around it. The alternatives were both worse:
 *
 * - **Stepping the ring once per second** costs nothing and looks it. Fifteen
 *   visible jumps on the element a driver is staring at reads as cheap, and
 *   this screen is the app's most-seen surface after the trip list.
 * - **Faking a smooth arc with rotating half-discs** to reach the native
 *   driver is the classic trick and would work, at the price of four nested
 *   clipped views and an `overflow: hidden` behaviour that differs between
 *   iOS and Android. Correctness of the countdown matters more than the
 *   thread it runs on.
 *
 * The JS thread here is close to idle — a static screen and one fetch every
 * five seconds. If this ever proves janky on a real low-end handset, the
 * rotating-halves version is the fix, not a slower ring.
 *
 * `linear`, because the ring represents constant motion. Any easing would be
 * a lie about how fast the clock is running, and the lie at the end is the
 * one that matters: an ease-out ring appears to stop before the offer does.
 */
export function CountdownRing({
  seconds,
  totalSeconds,
  offerId,
  surface = 'light',
}: {
  /** Seconds left, counted by the caller from the server's number. */
  seconds: number;
  /** The window this offer opened with, which is what the ring is a fraction of. */
  totalSeconds: number;
  /** A new offer is a new ring — see the effect below. */
  offerId: number;
  /**
   * Which ground it is drawn on. The offer screen puts it in a navy header;
   * `OfferCard` still draws on white.
   *
   * **On navy the number stops changing colour, and the arc carries urgency
   * instead.** `warning` (#B54708) measures ~3.5:1 on navy — enough for a
   * stroke, which needs 3:1 as a UI component, and short of the 4.5:1 that
   * 14pt text needs. Colouring the number anyway would trade legibility for
   * emphasis on the one glyph a driver is reading, and the urgency is already
   * carried three other ways: the arc's colour, the arc's length, and the
   * number itself getting smaller.
   */
  surface?: 'light' | 'navy';
}) {
  const urgent = isRunningOut(seconds);
  const progress = useDrain(offerId, totalSeconds);

  const onNavy = surface === 'navy';

  return (
    <View
      style={styles.wrap}
      accessible
      // The screen announces the whole offer as one sentence, including the
      // seconds. A second live region on the ring would have a screen reader
      // interrupt that sentence with a bare number every time it ticked.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={SIZE} height={SIZE}>
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke={onNavy ? colors.borderOnNavy : colors.border}
          strokeWidth={STROKE}
          fill="none"
        />

        <AnimatedCircle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke={urgent ? colors.warning : colors.primary}
          strokeWidth={STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={progress.interpolate({
            inputRange: [0, 1],
            // From nothing missing to everything missing. The ring drains
            // rather than fills: a filling ring reads as progress towards
            // something good, and this one is running out.
            outputRange: [0, CIRCUMFERENCE],
          })}
          // Starts at twelve o'clock and drains clockwise. Without this the
          // arc begins at three o'clock, which no clock face in the world
          // does and which reads as the ring being mid-way through already.
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </Svg>

      <View style={styles.label} pointerEvents="none">
        <Text
          style={[
            styles.seconds,
            onNavy ? styles.secondsOnNavy : urgent && styles.secondsUrgent,
          ]}
        >
          {seconds}s
        </Text>
      </View>
    </View>
  );
}

/**
 * The drain, from full to empty over the offer's own window.
 *
 * Keyed on `offerId` rather than on the seconds, so the poll — which returns
 * a fresh object with a fresh `expires_in_seconds` every few seconds — does
 * not restart it. Restarting on every poll would make the ring jump backwards
 * three times per offer, which is the one thing a countdown must never do.
 */
function useDrain(offerId: number, totalSeconds: number): Animated.Value {
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const duration = Math.max(0, totalSeconds) * 1000;

    progress.setValue(0);

    // A zero-length offer is one that arrived already expired — from a phone
    // that spent the window in a dead zone. Animating for 0ms is a no-op that
    // leaves the ring full, which would show a driver a job they cannot take
    // as if it were fresh, so it is drawn empty instead.
    if (duration === 0) {
      progress.setValue(1);

      return;
    }

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      easing: Easing.linear,
      useNativeDriver: false,
    });

    animation.start();

    return () => animation.stop();
  }, [offerId, totalSeconds, progress]);

  return progress;
}

const styles = StyleSheet.create({
  wrap: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seconds: {
    ...typography.captionStrong,
    color: colors.primaryText,
    // Tabular figures, so the ring does not twitch as the number narrows
    // from 18 to 9 — the digits would otherwise re-centre on every tick.
    fontVariant: ['tabular-nums'],
  },
  secondsUrgent: {
    // Colour only, and no flashing. A driver holding a steering wheel does
    // not need an alarm; they need to know the number is small. Motion here
    // would compete with the ring that is already moving.
    color: colors.warning,
  },
  secondsOnNavy: {
    // Fixed, urgent or not — see the `surface` prop. The arc turns amber;
    // the number stays legible.
    color: colors.onNavy,
  },
});
