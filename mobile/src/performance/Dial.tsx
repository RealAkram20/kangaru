import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors, spacing, typography } from '../ui/theme';
import type { Dial as DialModel } from './presentation';

/*
  Measured off the mockup rather than chosen: its rings are 20.5% of the screen
  width and ours were 22.8%, which on the emulator read as three rings crowding
  a gutter the mockup leaves open. 88 is 21.4% of the 411dp reference handset.

  The figure inside is deliberately *not* scaled down with it. The mockup's
  numeral spans 69% of its ring where ours spanned 63%, so holding `display` at
  26pt while the ring shrinks lands on the mockup's proportion from both sides
  at once — and it keeps the one thing a driver reads through glare at the size
  DESIGN.md §6 asks for.
*/
const SIZE = 88;
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
 * - **This** is 88pt, static, drawn six times on one screen from six
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

  /*
    **The arc carries the inversion; the track no longer does.**

    This dial used to draw its *track* in `warningTint` as well, and rendering
    the grid beside the mockup is what argued it down: a 3% cancellation is a
    good figure, and a cream ring around it announced a fault where the reading
    says the opposite — the loudest shape in the cell was the part that is not
    a measurement at all. The mockup runs the same light track under all six and
    puts the warm colour only on the arc, which is the half that means
    something.

    Meaning is still never colour's alone (`docs/screen-rules.md` §6): the label
    reads "Cancellation" and the announcement says so in words.
  */
  const arcColour = inverted ? colors.warning : colors.primary;
  const trackColour = colors.primaryTint;

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
        {/*
          `testID` so the layout guard can measure *this* ring. Without it the
          test walked the tree for the first `Svg` it could find and measured
          the header's back chevron — 26pt, comfortably inside any column, so
          the assertion passed at every ring size and proved nothing. Found by
          mutation, which is the only way that class of test is ever found.
        */}
        <Svg testID="dial-ring" width={SIZE} height={SIZE}>
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
        one. Without it "28" over "Weekly trips" says nothing about why the
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
    /*
      **A third of the row — and `flex: 1` is what this must never be again.**

      `flex: 1` in React Native expands to `flexGrow: 1, flexShrink: 1,
      flexBasis: 0%`. A zero basis means every dial claims no width of its own,
      so six of them "fit" on one line and `flexWrap` on the parent never has a
      reason to wrap. The grid rendered as **one row of six overlapping rings**
      with every label clipped to "Accep…", and the screen's own comment said
      `flexBasis: '30%'` while the code said otherwise — so reading either file
      confirmed a layout neither produced.

      Nothing could catch this but rendering it. Both suites were green: Jest's
      renderer does not lay out, so a test can read "Cancellation" from a node
      that is, on a handset, four characters wide and sitting on top of its
      neighbour.

      `flexBasis` with **no grow and no shrink** is the fix rather than `width`:
      it is the property `flexWrap` measures against, and a dial that cannot
      shrink is a dial that pushes the fourth one onto the next row instead of
      squeezing all six.
    */
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: '30%',
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
    // The mockup's figure is the loudest thing inside the ring and this was
    // set a size below it — `heading` (20pt semibold) left a 96pt ring around
    // a number that read as a label. `display` is the token for exactly this:
    // a figure meant to be read at a glance from arm's length, which is the
    // whole reason the screen draws rings rather than a table.
    //
    // Nothing is at risk of overflowing at the larger size: `adjustsFontSizeToFit`
    // below already shrinks the one long value ("7h 20m") to fit the ring, and
    // it did so at 20pt too.
    ...typography.display,
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
    /*
      Grey, like the mockup, and **not `placeholder`**. That one (#979DA9) is
      the obvious choice for a secondary line and measures **2.72:1 on white** —
      DESIGN.md §1 demotes it on light surfaces by name, and this app has
      already shipped that exact failure once on the home screen's rating note.

      `textBody` was here first and was a shade too loud beside the mockup: the
      label is the ring's name, not a reading, and rendering it at near-black
      gave it the weight of the figure above it. `textMuted` is 6.4:1 — grey to
      look at and still well clear of AA through glare, which is more contrast
      than the mockup's own label actually has.

      The label and its caption now share a colour, and the hierarchy between
      them is carried by order and by wording ("Weekly trips" / "of 30") rather
      than by a second grey. Two greys eight points apart was a distinction
      nobody could see anyway.
    */
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  caption: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
