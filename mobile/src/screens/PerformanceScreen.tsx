import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ProfileStackParams } from '../navigation/types';
import { Dial } from '../performance/Dial';
import {
  bonusNote,
  dialCaption,
  dialsFor,
  headingNote,
  hoursLabel,
} from '../performance/presentation';
import { useDriverPerformance } from '../performance/queries';
import { Card, Notice, Screen, ScreenHeader } from '../ui/components';
import { SyncBanner } from '../ui/SyncBanner';
import { colors, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<ProfileStackParams, 'Performance'>;

/**
 * How a driver is doing: six dials over thirty days, and where they are in
 * the current bonus week.
 *
 * ## What the mockup asked for that this platform could not produce
 *
 * Three things, and the owner ruled on each rather than either being dropped
 * quietly or drawn dishonestly. **Do not "fix" these back.**
 *
 * - **"Online Hours 7h 20m" did not exist.** `driver_presence` is one row per
 *   driver, overwritten, and its own migration refuses a history by name.
 *   The owner chose to *build* duty sessions (ADR-0038) rather than relabel
 *   the dial as driving time — so the figure here is measured, and it is
 *   deliberately conservative: it counts time the platform could actually
 *   reach the driver.
 * - **Two rings were drawn against nothing.** *Total Trips 428* and the hours
 *   dial were both about three-quarters full, and neither a lifetime count
 *   nor a day's hours has a ceiling. The owner chose real denominators over
 *   an invented one, so those dials now measure **trips this week** against
 *   the operator's bonus target and **online hours** against the driver's
 *   rostered hours. The lifetime figure is not lost — it is the line under
 *   the heading, where it needs no denominator.
 * - **"Great job! Keep it up."** is not on the screen. It is a judgement
 *   about work this app has not assessed, and it would be said identically to
 *   a driver at 40% acceptance. The line under the heading is a figure they
 *   earned, which is both truer and better praise.
 *
 * ## Where a denominator is genuinely absent, the dial draws no arc
 *
 * The bonus scheme is off by default, and a driver with no shift windows is
 * available at any hour (ADR-0017 §3). Both come through as null, `fractionOf`
 * returns null, and `Dial` draws its track only. That is not a degraded state
 * to be tidied away — it is the screen refusing to make a claim it cannot
 * support, and it is the common case on a fresh fleet.
 */
export function PerformanceScreen({ navigation }: Props) {
  const { data: performance, isError, refetch, isRefetching } = useDriverPerformance();

  const dials = dialsFor(performance);
  const note = bonusNote(performance);
  const bonus = performance?.bonus ?? null;

  return (
    <Screen>
      {/*
        Explicit rather than `goBack()`. This is pushed from the Profile tab
        root, so there genuinely is something behind it — but the pattern the
        other pushed screens use is explicit, and it survives the screen being
        reached from somewhere else later.
      */}
      <ScreenHeader title="Performance" subtitle={null} onBack={() => navigation.goBack()} />

      <SyncBanner />

      <ScrollView
        // Queried by the test that proves the "Pull down" copy is honest.
        testID="performance-scroll"
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        /*
          **The error notice promised "pull down" and there was nothing to
          pull.** Copy that names an interaction the screen does not implement
          is worse than no copy — a driver on a patchy upcountry connection
          pulls, nothing happens, and they conclude the app is broken rather
          than that the network is.

          Caught by reading the screen rather than by any test, which is the
          case for the "run or render it" rule: nothing about a promise made in
          a string and not kept in a handler is visible to a passing assertion.

          It also earns its place independently of the notice. This is the one
          screen in the app with no polling and a 60-second stale time, so a
          driver who has just finished a job and opened it to see the count move
          otherwise has no way to ask again.
        */
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <View>
          <Text style={styles.heading}>Your Performance</Text>
          <Text style={styles.headingNote}>{headingNote(performance)}</Text>
        </View>

        {isError && performance === undefined && (
          <Notice tone="warning" message="Your figures could not be loaded. Pull down or try again shortly." />
        )}

        {/*
          Two rows of three. A plain wrap rather than a grid library: three
          per row is the only arrangement, and `flexBasis: '30%'` with
          `flexWrap` says that in four lines.
        */}
        <View style={styles.grid}>
          {dials.map((dial) => (
            <Dial key={dial.key} dial={dial} caption={dialCaption(dial, performance)} />
          ))}
        </View>

        <Text style={styles.windowNote}>
          {performance === undefined
            ? ' '
            : `Rating, acceptance, completion and cancellation are measured over the last ${performance.window_days} days.`}
        </Text>

        {/*
          The weekly card, and it is **absent rather than empty** when the
          bonus scheme is switched off. A card reading "0 of 40 trips" for a
          fleet that runs no bonus scheme is an invented figure dressed as a
          measurement (`docs/screen-rules.md` §1), and the server sends null
          precisely so this app never has to decide.
        */}
        {bonus !== null && (
          <Card>
            <Text style={styles.cardTitle}>This week</Text>

            <View
              style={styles.cardRow}
              accessible
              accessibilityLabel={`Trips completed this week: ${bonus.trips} of ${bonus.trip_target}.`}
            >
              <Text style={styles.cardLabel}>Trips completed</Text>
              <Text style={styles.cardValue}>
                {bonus.trips} / {bonus.trip_target}
              </Text>
            </View>

            {/*
              The bar and the fraction above it are two readings of one fact,
              which `CountdownRing` argues for at length: the bar answers "how
              close" from the corner of an eye, the numerals answer "how many
              exactly". Neither does the other's job, and a driver deciding
              whether to take one more job tonight wants both.

              Hidden from the screen reader because the row above already
              announces the same pair as one sentence.
            */}
            <View
              style={styles.track}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <View
                style={[
                  styles.fill,
                  {
                    width: `${Math.min(100, Math.max(0, (bonus.trips / Math.max(1, bonus.trip_target)) * 100))}%`,
                  },
                ]}
              />
            </View>

            {note !== null && <Text style={styles.cardNote}>{note}</Text>}
          </Card>
        )}

        {/*
          Said once, plainly, and only where a roster exists to say it about.
          The dial's own caption carries the figure; this carries the meaning,
          because "of 45h" beside a ring does not tell a driver that the
          number is what they are rostered for rather than a target somebody
          set them.
        */}
        {performance !== undefined && performance.rostered_seconds_this_week !== null && (
          <Text style={styles.footnote}>
            Online hours are measured against the {hoursLabel(performance.rostered_seconds_this_week)} you
            are rostered for this week. Time your phone could not be reached is not counted.
          </Text>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  heading: {
    ...typography.heading,
    color: colors.text,
  },
  headingNote: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // Generous, because the row gap is what separates the two rows of dials
    // and a label sitting close under the ring above it reads as belonging to
    // the wrong one.
    rowGap: spacing.lg,
    columnGap: spacing.sm,
  },
  windowNote: {
    ...typography.caption,
    color: colors.textMuted,
    // Pulled up under the grid: it explains the four rate dials, not the card
    // below it, and the section gap would otherwise attach it to the wrong
    // thing.
    marginTop: -spacing.sm,
  },
  cardTitle: {
    ...typography.heading,
    color: colors.text,
    marginBottom: spacing.md,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  cardLabel: {
    ...typography.body,
    color: colors.textBody,
    flexShrink: 1,
  },
  cardValue: {
    ...typography.bodyStrong,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  track: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  cardNote: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  footnote: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
