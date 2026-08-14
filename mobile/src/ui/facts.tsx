import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from './theme';

/**
 * The three ways this app states a fact about a job.
 *
 * Extracted from `OfferScreen` when `PickupScreen` needed all three of them
 * (AGENTS.md: "Never duplicate UI. If a component appears more than once,
 * convert it into a reusable component"). The two screens are the same
 * driver's view of the same job either side of the accept, so they should not
 * be two vocabularies for one set of facts.
 *
 * **The em dash is the shared rule, and it is why these live together.**
 * Every one of them renders `—` for a value the platform does not have,
 * never a zero and never a plausible stand-in. `HomeScreen` holds the same
 * line for wallet and earnings, and the reason it holds is that a driver can
 * act correctly on "nobody said" and cannot act correctly on a number that
 * was made up.
 */

/** Stat and detail glyphs, at one size and weight so the rows agree. */
export const GLYPH = { color: colors.primaryText, size: 20, strokeWidth: 2 } as const;

/**
 * One cell of a facts row: a glyph, what it is, and what it says.
 *
 * `emphasis` tints the value green for the one figure a decision turns on —
 * the fare. That is redundant emphasis rather than the carrier of any
 * meaning: the label beside it already says what it is, so nothing is lost to
 * a driver who cannot separate the hues (AGENTS.md § Accessibility).
 */
export function Stat({
  icon,
  label,
  value,
  emphasis = false,
}: {
  icon: ReactNode;
  label: string;
  value: string | null;
  emphasis?: boolean;
}) {
  return (
    <View style={styles.statCell}>
      <View style={styles.glyph}>{icon}</View>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.statValue, emphasis && styles.statValueStrong]} numberOfLines={1}>
        {value ?? '—'}
      </Text>
    </View>
  );
}

/**
 * A row of `Stat`s with hairlines between them.
 *
 * Takes the cells rather than the data, so a screen decides which three facts
 * it is stating. The row keeps its shape whatever they are: an order taken
 * over the phone renders three em dashes rather than collapsing into a
 * different layout for the same screen.
 */
export function StatRow({ children }: { children: ReactNode[] }) {
  return (
    <View style={styles.stats}>
      {children.map((cell, index) => (
        // Index keys, and legitimately: this list is a fixed layout written
        // out at the call site, never reordered and never filtered. There is
        // no identity to preserve because there is no reordering to survive.
        <View key={index} style={styles.statSlot}>
          {index > 0 && <View style={styles.statRule} />}
          {cell}
        </View>
      ))}
    </View>
  );
}

/**
 * A labelled row: how it settles, what is in the parcel, who is riding.
 *
 * Label above value, matching the route rail, so a screen has one way of
 * introducing a fact rather than two. `trailing` is for a control that acts
 * on the row — the call button on the pickup screen — and is kept out of the
 * text column so a long name cannot push it off the edge.
 */
export function DetailRow({
  icon,
  label,
  value,
  caption,
  trailing,
}: {
  icon: ReactNode;
  label: string;
  value: string | null;
  caption?: string | null;
  trailing?: ReactNode;
}) {
  return (
    <View style={styles.detail}>
      <View style={styles.glyph}>{icon}</View>

      <View style={styles.detailText}>
        <Text style={styles.detailLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.detailValue} numberOfLines={1}>
          {value ?? '—'}
        </Text>
        {caption !== null && caption !== undefined && (
          <Text style={styles.detailCaption} numberOfLines={1}>
            {caption}
          </Text>
        )}
      </View>

      {trailing}
    </View>
  );
}

/**
 * The two ends of the job, on a rail.
 *
 * A ring at the top and a disc at the bottom, joined by a line. **The two ends
 * differ by shape before they differ by colour**, and the labels are said as
 * well: colour alone is not a distinction for the significant number of men in
 * this fleet who cannot reliably separate green from red.
 */
export function RouteRail({
  pickup,
  dropoff,
}: {
  pickup: string | null;
  dropoff: string | null;
}) {
  return (
    <View style={styles.route}>
      <View style={styles.routeRail}>
        <View style={[styles.routeDot, { borderColor: colors.primary }]} />
        <View style={styles.routeLine} />
        <View style={[styles.routeDot, styles.routeDotFilled]} />
      </View>

      <View style={styles.routeText}>
        <Text style={[styles.routeLabel, { color: colors.primaryText }]}>PICKUP</Text>
        {/* Two lines, not one. A Kampala address is routinely "Geoprix
            Engineering Limited, Seeta" — truncating it to one line hides the
            half that says which side of town. */}
        <Text style={styles.routePlace} numberOfLines={2}>
          {pickup ?? 'Pickup not given'}
        </Text>

        <View style={styles.routeGap} />

        <Text style={[styles.routeLabel, { color: colors.danger }]}>DROP-OFF</Text>
        <Text style={styles.routePlace} numberOfLines={2}>
          {dropoff ?? 'Drop-off not given'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  glyph: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
  },
  statSlot: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    gap: 2,
  },
  statRule: {
    width: 1,
    backgroundColor: colors.border,
    marginVertical: 2,
  },
  statLabel: {
    ...typography.caption,
    // 12 is the floor of DESIGN.md §6's scale. Checked against the narrowest
    // handset in the fleet: "Estimated fare" holds one line in a third of a
    // 360dp screen at this size.
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.xs + 2,
  },
  statValue: {
    ...typography.bodyStrong,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  statValueStrong: {
    color: colors.primaryText,
  },
  detail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  detailText: {
    flex: 1,
  },
  detailLabel: {
    ...typography.caption,
    fontSize: 12,
    letterSpacing: 0.4,
    color: colors.textMuted,
  },
  detailValue: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  detailCaption: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
  },
  route: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm + 4,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  routeRail: {
    alignItems: 'center',
    // Aligns the dot with the cap-height of the label beside it rather than
    // with its box top, which sits a couple of points high.
    paddingTop: 5,
  },
  routeDot: {
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    borderWidth: 3,
    backgroundColor: colors.surface,
  },
  routeDotFilled: {
    borderColor: colors.danger,
    backgroundColor: colors.danger,
  },
  routeLine: {
    width: 2,
    flex: 1,
    minHeight: 36,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  routeText: {
    flex: 1,
  },
  routeLabel: {
    ...typography.captionStrong,
    fontSize: 12,
    letterSpacing: 0.8,
  },
  routePlace: {
    ...typography.bodyStrong,
    color: colors.text,
    marginTop: 2,
  },
  routeGap: {
    height: spacing.md,
  },
});
