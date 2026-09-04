import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors, typography } from '../ui/theme';
import { NO_VALUE } from './waiting';

const SIZE = 196;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The waiting clock: an arc that fills as the wait runs, with the elapsed
 * figure inside it.
 *
 * ## Why this is not `CountdownRing`
 *
 * They look alike and answer opposite questions, and merging them would mean
 * a single component whose docblock had to argue both sides of every choice
 * below. `CountdownRing` is 52pt, **drains** over a fifteen-second offer, is
 * keyed to an offer id so a poll cannot restart it, and animates every frame.
 * This one is 196pt, **fills**, saturates instead of ending, and does not
 * animate at all.
 *
 * ## Why it does not animate
 *
 * The rules ask for a reason for every animation, and there is none here.
 * This ring is a fraction of `dispatch.pickup_wait_target_seconds` — five
 * minutes by default — so one second of progress is 1/300th of the
 * circumference: under a pixel on a 196pt ring. `CountdownRing` animates
 * because a fifteen-second window makes each second a visible 24° jump that
 * reads as cheap; at five minutes there is nothing to smooth, and a timing
 * animation would run a JS-thread callback at 60fps for five-plus minutes to
 * make no visible difference on the screen a driver leaves open while they
 * wait. Stepping with the number it sits inside is both cheaper and correct.
 *
 * A consequence worth naming: there is nothing here for reduced motion to
 * soften, because nothing moves except a figure changing once a second, which
 * is content rather than motion.
 *
 * ## Why it saturates rather than ending
 *
 * Nothing bounds a wait at the kerb — no charge, no `no_show` the driver may
 * post, no sweep. See `waiting.ts`. So the arc completes and holds, which is
 * the only rendering that does not imply a deadline: emptying would read as a
 * second period beginning, and disappearing would read as the wait being over.
 */
export function WaitingRing({
  /** Whole seconds waited, or null when the platform cannot say yet. */
  seconds,
  /** How much of the ring is drawn, 0 to 1. Already saturated by `fillFraction`. */
  fraction,
  /** The figure to render inside — `—` when there is no number to show. */
  label,
}: {
  seconds: number | null;
  fraction: number;
  label: string;
}) {
  return (
    <View
      style={styles.wrap}
      // The screen composes one sentence for the whole waiting state,
      // including this figure. A second live region here would have a screen
      // reader interrupt that sentence with a bare number every second — the
      // linearisation problem the rules call out by name.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={SIZE} height={SIZE}>
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke={colors.primaryTint}
          strokeWidth={STROKE}
          fill="none"
        />

        {/*
          Omitted entirely at zero rather than drawn with a zero-length dash.
          `strokeLinecap="round"` renders a round cap even on a dash of length
          nothing, which puts a green dot at twelve o'clock on a ring that has
          not started — and on this screen "not started" is also what is drawn
          when the arrival time has not arrived, where a dot would read as a
          measurement rather than the absence of one.
        */}
        {fraction > 0 && (
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={colors.primary}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            // Filling, so the *drawn* length grows: the offset is what is
            // still missing. `CountdownRing` interpolates the other way for
            // the opposite reason.
            strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
            // From twelve o'clock, clockwise. Without this an arc starts at
            // three o'clock, which no clock face does and which reads as the
            // ring already being a quarter through.
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        )}
      </Svg>

      <View style={styles.centre} pointerEvents="none">
        <Text style={[styles.figure, seconds === null && styles.figureAbsent]}>{label}</Text>
        <Text style={styles.caption}>waiting time</Text>
      </View>
    </View>
  );
}

/** The figure for a wait with no known start. Exported so tests name it once. */
export const ABSENT_FIGURE = NO_VALUE;

const styles = StyleSheet.create({
  wrap: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  centre: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  figure: {
    ...typography.odometer,
    color: colors.text,
    // Tabular figures, or every tick past a `1` re-centres the whole reading
    // inside the ring.
    fontVariant: ['tabular-nums'],
  },
  figureAbsent: {
    // An em dash is not a reading, and should not be weighted like one.
    color: colors.textMuted,
  },
  caption: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
});
