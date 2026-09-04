import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { DriverEarnings, EarningsPeriod } from '../api/endpoints';
import { EarningsChart } from '../earnings/EarningsChart';
import {
  axisLabels,
  breakdownReconciles,
  bucketLabel,
  breakdownRows,
  chartBars,
  durationLabel,
  money,
  NO_FIGURE,
  PERIODS,
  periodLabel,
  totalHeading,
} from '../earnings/presentation';
import { useDriverEarnings } from '../earnings/queries';
import type { EarningsStackParams } from '../navigation/types';
import { Notice, Screen, ScreenHeader } from '../ui/components';
import { SkeletonRows } from '../ui/Skeleton';
import { colors, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<EarningsStackParams, 'EarningsHome'>;

/**
 * What a driver has made, over a day, a week or a month.
 *
 * Reached from the Home screen's *Earnings today* tile, which until now was a
 * plain `View` that did nothing. No trip status routes here — this is a
 * record, not a leg of a job.
 *
 * The figures come from `GET /me/earnings`, which reads
 * `driver_ledger_entries` — the driver's share **as written at completion**,
 * so a commission rate the office changes today cannot restate last week
 * (ADR-0029 §3).
 *
 * ## Two of the mockup's five money rows still do not exist
 *
 * **Tips and bonuses do now** (ADR-0034) and have rows of their own, grouped
 * server-side by *kind* ahead of service type — so a tip is never folded into
 * the Rides row of the trip it was given on, and a bonus, which has no trip at
 * all, is not filed as unclassifiable work. The mockup's `UGX 0` bonus row is
 * still refused: an absent row is right for a driver who earned none, which is
 * the distinction `docs/screen-rules.md` §1 was drawing.
 *
 * Raised before any of this was written, and the reasoning is not stylistic:
 *
 * - **No "Online hours".** Not merely missing — *actively destroyed*.
 *   `driver_presence` is one row per driver and
 *   `DatabaseDriverPresenceStore::setDuty()` upserts it, so the previous state
 *   is gone on every toggle; the migration argues for exactly that in its own
 *   docblock. `driver_shift_windows` is a **roster** — weekday plus start and
 *   end time, no dates, no actuals — so totalling it would report the schedule
 *   as though it were the timesheet.
 *
 * **"Time on trips" is here instead**, and is deliberately not called online
 * time: it is summed `completed_at − started_at`, so an hour spent waiting for
 * an offer is not in it. Beside the total it gives a real rate per driving
 * hour, which is the useful half of what the mockup was reaching for.
 *
 * ## And one row the mockup had no place for
 *
 * A trip with no order request behind it — a walk-in a dispatcher fulfilled by
 * hand — cannot be classified as a ride or a delivery. It gets an **Other
 * work** row rather than being dropped, because a breakdown that does not add
 * up to the total above it is the worst defect a money screen can carry.
 *
 * ## "See earnings details" is not built
 *
 * It is the one row on the mockup whose destination is undefined. The
 * breakdown and the chart on this screen *are* the detail; the next honest
 * surface is a scrollable statement of individual ledger entries, which is
 * another endpoint and another screen. A row that opened nothing would be
 * worse than no row.
 */
export function EarningsScreen({ navigation }: Props) {
  const [period, setPeriod] = useState<EarningsPeriod>('day');
  const { data: earnings, isLoading } = useDriverEarnings(period);

  const rows = breakdownRows(earnings);
  const bars = chartBars(earnings);

  return (
    <Screen>
      {/* To the Home tab, not `goBack()` — see `WalletScreen`, which explains
          why a tab root still wants an arrow and why this is the honest one. */}
      <ScreenHeader
        title="Earnings"
        subtitle={null}
        onBack={() => navigation.getParent()?.navigate('Home')}
      />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <PeriodTabs period={period} onChange={setPeriod} />

        {/*
          The reconciliation guard. It cannot fail the way the server builds
          the payload — total and breakdown are folds over one un-joined row
          set — and it is checked anyway, because the failure would otherwise
          be invisible until a driver added the rows up themselves and found
          they disagreed with the figure above.
        */}
        {!breakdownReconciles(earnings) && (
          <Notice
            tone="warning"
            message="These figures may be wrong. Check with the office."
          />
        )}

        <View style={styles.card}>
          <Text style={styles.totalLabel}>{totalHeading(period)}</Text>
          <Text style={styles.total} accessibilityLabel={totalAnnouncement(earnings, period)}>
            {isLoading && earnings === undefined
              ? NO_FIGURE
              : money(earnings?.total_minor, earnings?.currency)}
          </Text>

          <View style={styles.rule} />

          {rows.length === 0 ? (
            isLoading ? (
              <SkeletonRows count={3} style={styles.loadingRows} />
            ) : (
              <Text style={styles.empty}>No completed work in this period.</Text>
            )
          ) : (
            rows.map((row) => (
              <View key={row.key} style={styles.row}>
                <Text style={styles.rowLabel}>{row.label}</Text>
                <Text style={styles.rowCount}>{row.trips}</Text>
                <Text style={styles.rowAmount}>{row.amount}</Text>
              </View>
            ))
          )}

          <View style={styles.rule} />

          {/*
            Two words apart from the mockup's, and the difference is the whole
            point: "Time on trips", not "Online hours". Waiting for an offer is
            not counted and cannot be.
          */}
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Time on trips</Text>
            <Text style={styles.rowAmount}>{durationLabel(earnings?.on_trip_minutes)}</Text>
          </View>
          {/*
            The footnote here explained the row's own label. "Time on trips" is
            already two words apart from the mockup's "Online hours" precisely
            so that it does not need a sentence underneath it.
          */}
        </View>

        {bars.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Earnings trend</Text>
            <EarningsChart
              bars={bars}
              labels={axisLabels(earnings)}
              announcement={trendAnnouncement(earnings)}
            />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

/**
 * Day / Week / Month.
 *
 * `accessibilityRole="tab"` with a selected state rather than three buttons:
 * a screen reader should say "Week, tab, 2 of 3, selected", not read three
 * unrelated controls. Each is a full-height target — 52pt, the app's floor —
 * because the row is the first thing a thumb reaches for on this screen.
 *
 * The selected tab is green-filled **and** carries the selected state, so the
 * distinction never rests on colour alone (DESIGN.md §3, AGENTS.md
 * § Accessibility).
 */
function PeriodTabs({
  period,
  onChange,
}: {
  period: EarningsPeriod;
  onChange: (next: EarningsPeriod) => void;
}) {
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {PERIODS.map((option) => {
        const selected = option === period;

        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={periodLabel(option)}
            onPress={() => onChange(option)}
            style={[styles.tab, selected && styles.tabSelected]}
          >
            <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>
              {periodLabel(option)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The headline figure as a sentence, so the label and the number arrive together. */
function totalAnnouncement(earnings: DriverEarnings | undefined, period: EarningsPeriod): string {
  if (earnings === undefined) {
    return `${totalHeading(period)} are not available yet.`;
  }

  return `${totalHeading(period)}: ${money(earnings.total_minor, earnings.currency)}.`;
}

/**
 * The chart as one sentence.
 *
 * A screen reader walking 24 bars reads a list of numbers with no shape, which
 * is strictly worse than naming the busiest slot — and the shape is the whole
 * reason a chart is here rather than a table.
 */
function trendAnnouncement(earnings: DriverEarnings | undefined): string {
  if (earnings === undefined || earnings.trend.length === 0) {
    return 'Earnings trend is not available yet.';
  }

  const busiest = earnings.trend.reduce((best, point) =>
    point.earned_minor > best.earned_minor ? point : best,
  );

  if (busiest.earned_minor === 0) {
    return 'Earnings trend: nothing earned in this period.';
  }

  return (
    `Earnings trend across ${earnings.trend.length} ${earnings.period === 'day' ? 'hours' : 'days'}. ` +
    // `bucketLabel`, not the raw key. Rendering the screen caught this
    // reading aloud as "Busiest was 2026-08-15 16:00" — a database
    // identifier spoken to somebody who cannot see the chart it indexes.
    `Busiest was ${bucketLabel(busiest.bucket, earnings.period)}, ` +
    `at ${money(busiest.earned_minor, earnings.currency)}.`
  );
}

const styles = StyleSheet.create({
  body: {
    padding: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.pill,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  tabSelected: {
    // `primaryCta`, not `primary`: white on `primary` is 4.15:1 and fails AA
    // for a label this size. `theme.ts` says so in as many words.
    backgroundColor: colors.primaryCta,
  },
  tabLabel: {
    ...typography.label,
    fontSize: 16,
    color: colors.textBody,
  },
  tabLabelSelected: {
    color: colors.onPrimary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  cardTitle: {
    ...typography.bodyStrong,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  totalLabel: {
    ...typography.body,
    color: colors.textMuted,
  },
  total: {
    // Sora, and the largest type on the screen: this is the figure a driver
    // opened the app for.
    ...typography.odometer,
    color: colors.text,
    marginTop: spacing.xs,
    fontVariant: ['tabular-nums'],
  },
  rule: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowLabel: {
    ...typography.body,
    color: colors.textBody,
    flex: 1,
  },
  /**
   * The count sits between the label and the money, as the mockup has it.
   * Tabular figures and a fixed width so a 6 and a 12 do not shift the money
   * column, which is the one a driver reads down.
   */
  rowCount: {
    ...typography.bodyStrong,
    color: colors.text,
    minWidth: 28,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  rowAmount: {
    ...typography.bodyStrong,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  footnote: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
  },
  loadingRows: {
    paddingVertical: spacing.sm,
  },
  empty: {
    ...typography.body,
    color: colors.textMuted,
  },
});
