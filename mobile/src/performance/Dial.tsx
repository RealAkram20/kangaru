import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors, spacing, typography } from '../ui/theme';
import type { Dial as DialModel } from './presentation';

const SIZE = 96;
const STROKE = 7;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * One of the six rings on the Performance screen: an arc, a figure and a
 * label.
 *
 * ## Why this is a third ring rather than a reuse of the other two
 *
 * `CountdownRing` and `WaitingRing` already exist, and `WaitingRing`'s own
 * docblock argues at length for why *those two* are separate. The same
 * argument separates this one from both, and it is worth stating rather than
 * assuming:
 *
 * - **`CountdownRing`** is 52pt, drains, animates every frame off an
 *   `Animated.Value` keyed to an offer id, and turns amber under pressure. It
 *   is a clock.
 * - **`WaitingRing`** is 196pt, fills, saturates and holds, and carries a
 *   caption. It is one number that changes once a second.
 * - **This** is 96pt, static, drawn six times on one screen from six
 *   unrelated figures, and — the part neither of the others has — **it must
 *   be able to draw no arc at all.**
 *
 * That last property is the whole reason this could not be a prop on either.
 * Both existing rings take a `fraction: number` and always draw something;
 * this takes `fraction: number | null`, and null is not zero. A driver with no
 * roster has no target, and an empty ring would say "you did none of it"
 * where the truth is "there is nothing here to be a fraction of".
 *
 * ## It does not animate, and that is the rule rather than an omission
 *
 * DESIGN.md §7 reserves motion for the occasional and the meaningful. Six
 * rings drawing themselves on every open of a screen a driver checks daily is
 * decoration on a high-frequency surface — the case `docs/screen-rules.md` §5
 * rules out by name. There is also nothing for the motion to communicate:
 * these figures are not arriving, they are being read.
 */
export function Dial({ dial, caption }: { dial: DialModel; caption: string | null }) {
  const { fraction, inverted } = dial;

  // The absent case, and the one this component exists for. `fraction === 0`
  // is a real measurement and still draws (nothing, correctly); `null` means
  // there is no denominator, and only the track is drawn.
  const hasArc = fraction !== null && fraction > 0;

  const arcColour = inverted ? colors.warning : colors.primary;
  const trackColour = inverted ? colors.warningTint : colors.primaryTint;

  return (
    <View
      style={styles.wrap}
      accessible
      // One sentence for the whole dial. Without this a screen reader walks
      // six figures and then six labels and nothing tells the listener which
      // belongs to which — the linearisation problem `docs/screen-rules.md`
      // §6 calls out, and a 2×3 grid is exactly where it bites.
      accessibilityLabel={dial.announcement}
    >
      <View style={styles.ring}>
        <Svg width={SIZE} height={SIZE}>
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={trackColour}
            strokeWidth={STROKE}
            fill="none"
          />

          {/*
            Omitted entirely rather than drawn at zero length.
            `strokeLinecap="round"` renders a round cap even on a dash of
            length nothing, which puts a coloured dot at twelve o'clock on a
            ring that has not started — and here that dot would appear on the
            dials that have *no denominator*, reading as a measurement where
            the point is that there is none. `WaitingRing` records the same
            trap.
          */}
          {hasArc && (
            <Circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              stroke={arcColour}
              strokeWidth={STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              // Filling, so the drawn length grows and the offset is what is
              // still missing.
              strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
              // From twelve o'clock, clockwise. Without this an arc starts at
              // three o'clock, which no dial in the world does and which reads
              // as already being a quarter through.
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          )}
        </Svg>

        <View style={styles.centre} pointerEvents="none">
          <Text
            style={[styles.figure, dial.value === '—' && styles.figureAbsent]}
            numberOfLines={1}
            // Shrinks rather than truncating: "7h 20m" is six characters where
            // "4.8" is three, and a clipped duration is worse than a smaller
            // one. Floors at 70% so it never falls under the glare threshold
            // the theme's 15pt minimum is set for.
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {dial.value}
          </Text>
        </View>
      </View>

      <Text style={styles.label} numberOfLines={1}>
        {dial.label}
      </Text>

      {/*
        The denominator, in words, on the two dials that have a non-obvious
        one. Without it "28" over "Trips this week" says nothing about why the
        ring is three-quarters drawn.
      */}
      {caption !== null && (
        <Text style={styles.caption} numberOfLines={1}>
          {caption}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    // A third of the row, less the gaps. Set here rather than on the grid so
    // a dial is self-sizing wherever it is placed.
    flex: 1,
  },
  ring: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centre: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    // Inset so a long figure shrinks before it touches the stroke.
    paddingHorizontal: spacing.sm,
  },
  figure: {
    ...typography.heading,
    color: colors.text,
    textAlign: 'center',
    // Tabular figures, or a percentage narrowing from 92 to 9 re-centres
    // itself inside the ring.
    fontVariant: ['tabular-nums'],
  },
  figureAbsent: {
    // An em dash is not a reading and should not be weighted like one.
    color: colors.textMuted,
  },
  label: {
    ...typography.caption,
    // The dial's name is the stronger of the two lines, and the hierarchy is
    // made with weight of colour rather than by fading the caption below
    // legibility. `placeholder` (#979DA9) was the obvious choice for a
    // secondary line and measures **2.72:1 on white** — DESIGN.md §1 demotes
    // it on light surfaces by name, and this app has already shipped that
    // exact failure once on the home screen's rating note.
    color: colors.textBody,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  caption: {
    ...typography.caption,
    // 5.9:1. Quieter than the label, still comfortably AA in direct sun.
    color: colors.textMuted,
    textAlign: 'center',
  },
});
