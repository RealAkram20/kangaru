import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

import { colors, spacing, typography } from '../ui/theme';

/**
 * The earnings trend, drawn by hand.
 *
 * **No charting library, and that is a decision rather than an omission.**
 * `quality-control` makes a new recurring dependency an owner's call, and this
 * is one chart of one shape — bars against a baseline. `react-native-svg` is
 * already in the app for the icons, the countdown ring and the waiting ring,
 * so this adds no bundle, no native module and nothing to keep upgraded.
 *
 * ## What it deliberately does not do
 *
 * - **No y-axis figures.** The mockup drew `0 / 100 / 200 / 300 / 400`, which
 *   at UGX would mean four hundred shillings — about eight pence — and no
 *   driving day looks like that. Rather than invent a scale, the bars are
 *   relative to the period's own peak and the exact figures live in the
 *   breakdown above, where they are exact. A driver reads this for shape:
 *   *when* did I earn, not *how much* to the shilling.
 * - **No animation.** `docs/screen-rules.md` §5 wants a reason for every
 *   animation and there is none here: the chart is not feedback, nothing has
 *   just happened, and bars growing on mount would delay the one thing the
 *   screen is for.
 * - **No touch or tooltip.** A 24-bar chart at phone width gives each bar
 *   about eleven points — well under any sane touch target, so a tap would be
 *   a lottery. The axis and the breakdown carry the detail instead.
 *
 * ## Accessibility
 *
 * The bars are one element with one composed label, not thirty-one. A screen
 * reader walking bar by bar reads a list of numbers with no shape, which is
 * strictly worse than a sentence naming the busiest slot — and the shape is
 * the entire point of a chart.
 */
export function EarningsChart({
  bars,
  labels,
  announcement,
}: {
  bars: { key: string; fraction: number; earnedMinor: number }[];
  labels: { index: number; label: string }[];
  /** The whole chart as one sentence — composed by the screen, which knows the money format. */
  announcement: string;
}) {
  if (bars.length === 0) {
    return null;
  }

  // A viewBox in abstract units, scaled by the SVG to whatever width the card
  // gives it. Avoids measuring the layout, which would mean a render pass with
  // no chart in it and a visible jump on a slow handset.
  const width = 100;
  const height = 42;

  // A gap of a quarter of each slot: enough to read 31 bars as separate
  // without either the bar or the gap disappearing at phone width.
  const slot = width / bars.length;
  const barWidth = slot * 0.75;

  return (
    <View accessible accessibilityLabel={announcement}>
      <Svg width="100%" height={140} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {/*
          Three guide lines rather than a grid: they give the eye a height to
          judge against without turning the card into graph paper. Drawn under
          the bars so a tall bar reads as crossing them.
        */}
        {[0.25, 0.5, 0.75].map((at) => (
          <Line
            key={at}
            x1={0}
            x2={width}
            y1={height * (1 - at)}
            y2={height * (1 - at)}
            stroke={colors.border}
            strokeWidth={0.3}
            strokeDasharray="1.5 1.5"
          />
        ))}

        {bars.map((bar, index) => {
          // A floor of half a unit so an hour that earned nothing still draws
          // a baseline tick. A bar of literally no height is indistinguishable
          // from a bar that failed to render, and the difference matters: one
          // says "no work in this hour", the other says nothing at all.
          const barHeight = Math.max(height * bar.fraction, 0.5);

          return (
            <Rect
              key={bar.key}
              x={index * slot + (slot - barWidth) / 2}
              y={height - barHeight}
              width={barWidth}
              height={barHeight}
              rx={0.6}
              fill={bar.earnedMinor === 0 ? colors.border : colors.primary}
            />
          );
        })}

        {/* The baseline, drawn last so it sits over the foot of every bar. */}
        <Line x1={0} x2={width} y1={height} y2={height} stroke={colors.border} strokeWidth={0.4} />
      </Svg>

      {/*
        The axis is laid out by flex rather than positioned inside the SVG:
        SVG text does not scale with the user's font setting, and an axis that
        ignores accessibility text sizing is an axis somebody cannot read.

        No `importantForAccessibility` here. The wrapper above is already
        `accessible`, which collapses every descendant into one node, so
        marking the axis hidden as well was redundant — and it had a cost:
        anything hidden from accessibility is also invisible to the test
        queries, so the labels could not be asserted at all.
      */}
      <View style={styles.axis}>
        {labels.map((tick) => (
          <Text key={tick.index} style={styles.axisLabel}>
            {tick.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingHorizontal: 2,
  },
  axisLabel: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
  },
});
