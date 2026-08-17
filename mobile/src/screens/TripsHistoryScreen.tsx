import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { DriverHistoryTrip } from '../api/endpoints';
import type { TripsStackParams } from '../navigation/types';
import {
  groupByDay,
  HISTORY_FILTERS,
  filterValue,
  rowAmount,
  rowAnnouncement,
  rowTitle,
  showsStatus,
  statusTone,
  timeLabel,
  type HistoryFilterKey,
} from '../trips/history';
import { useTripHistory } from '../trips/historyQueries';
import { statusLabel, tripDestination } from '../trips/transitions';
import { Empty, Notice, Screen, ScreenHeader } from '../ui/components';
import { SkeletonRows } from '../ui/Skeleton';
import { CarIcon, PackageIcon, RouteIcon } from '../ui/icons';
import { colors, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<TripsStackParams, 'TripsHistory'>;

/**
 * Every job this driver has finished, newest first.
 *
 * Reached from the Home screen. **No `TripStatus` routes here** — this is the
 * record of work that is over, not a leg of one in progress, so the ownership
 * table in `docs/agent-worklog.md` is unchanged. A row still opens through the
 * shared `tripDestination()`, which is what stops a list from undoing the
 * status routing the home screen does (that bug happened once already, on the
 * since-deleted `TodayScreen`).
 *
 * ## Where this departs from the mockup, and why
 *
 * Both were settled with the owner before a line was written:
 *
 * - **The green figure is what the driver earned, not what the passenger
 *   paid.** The deciding argument was reconciliation — adding this list up
 *   must land on the same total the Earnings screen shows, and that screen
 *   totals `fare_earned`. Showing the gross would also repeat the confusion
 *   `TripResource::driverEarningsFor()` exists to prevent, on a screen where a
 *   driver is checking their week.
 * - **Cancelled and no-show trips are in the list**, with an em dash where the
 *   money goes and the status in words. The mockup has only paid work; a
 *   driver who drove to a pickup and was cancelled on has spent the time, and
 *   nothing anywhere else in this app lists that trip. `UGX 0` is banned
 *   outright by `docs/screen-rules.md` §1 — it reads as a job done for free.
 *
 * ## And what is deliberately absent
 *
 * **No passenger names, ever.** ADR-0024 §7 releases contact details to a
 * driver only while a trip is live; the payload does not carry them and this
 * screen could not show them if it wanted to. A permanent, scrollable list of
 * everyone somebody has carried is the directory that rule exists to prevent
 * — the same conclusion the wallet statement reached about "Tip from Sarah N."
 */
export function TripsHistoryScreen({ navigation }: Props) {
  const [filter, setFilter] = useState<HistoryFilterKey>('all');

  const query = useTripHistory(filterValue(filter));

  const sections = useMemo(() => {
    const pages = query.data?.pages ?? [];

    // The day keys come from the first page that carried them — they are the
    // **fleet's** today, not the handset's. `dayHeading` shows a date rather
    // than guessing when neither arrived, which is the honest answer: a
    // heading reading "Today" over yesterday's work is the one a driver
    // believes.
    const meta = pages.find((page) => page.today !== null);

    return groupByDay(
      pages.flatMap((page) => page.trips),
      meta?.today ?? null,
      meta?.yesterday ?? null,
    );
  }, [query.data]);

  const loading = query.isLoading && query.data === undefined;

  return (
    <Screen>
      <ScreenHeader title="Trips History" subtitle={null} onBack={() => navigation.goBack()} />

      <FilterChips filter={filter} onChange={setFilter} />

      <SectionList
        sections={sections}
        keyExtractor={(trip) => String(trip.id)}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching && !query.isFetchingNextPage}
            onRefresh={() => void query.refetch()}
            tintColor={colors.primary}
          />
        }
        // A history is read from the top and scrolled into; fetching at half a
        // screen's distance means the next page is usually already there by
        // the time a thumb reaches the end of this one.
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) {
            void query.fetchNextPage();
          }
        }}
        ListHeaderComponent={
          // A stale list is served rather than hidden — `offlineFirst` is the
          // whole point of the query — so the screen has to say when what it
          // is showing could not be refreshed.
          query.isError && query.data !== undefined ? (
            <Notice message="Showing what is saved on this phone." />
          ) : null
        }
        ListEmptyComponent={
          loading ? (
            <SkeletonRows count={5} style={styles.skeleton} />
          ) : query.isError ? (
            <Notice
              tone="danger"
              message="Could not load your trips, and none are saved here."
            />
          ) : (
            <Empty message={emptyMessage(filter)} />
          )
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeading}>{section.heading}</Text>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <TripRow
            trip={item}
            // The hairline sits between rows, never under the last one — a
            // rule under the final row reads as a section that was cut off.
            divided={index < section.data.length - 1}
            // The last row closes the card: it carries the bottom edge and the
            // bottom corners the day band opened at the top. Rendering the
            // section as an actual card is what the mockup draws, and reading
            // the tree is what caught that it was not — a header band and a
            // run of loose rows look identical in a test and quite different
            // on a phone.
            last={index === section.data.length - 1}
            onPress={() => {
              const to = tripDestination(item.status, item.id);

              navigation.navigate(to.screen, to.params as never);
            }}
          />
        )}
        renderSectionFooter={() => <View style={styles.sectionFooter} />}
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <View style={styles.centre}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null
        }
      />
    </Screen>
  );
}

/**
 * All / Rides / Deliveries.
 *
 * `accessibilityRole="tab"` with a selected state rather than three loose
 * buttons — a screen reader should say "Rides, tab, 2 of 3", not read three
 * unrelated controls. The same shape `EarningsScreen`'s period tabs use, so
 * the two filter rows in this app behave identically.
 *
 * The selected chip is green-filled **and** carries `selected`, so the
 * distinction never rests on colour alone (DESIGN.md §3). `primaryCta`, not
 * `primary`: white on `primary` is 4.15:1 and fails AA at this size, which
 * `theme.ts` says in as many words.
 *
 * Each chip is a full 48pt target. This row is the first thing a thumb reaches
 * for on the screen, and a mis-tap here costs a round trip.
 */
function FilterChips({
  filter,
  onChange,
}: {
  filter: HistoryFilterKey;
  onChange: (next: HistoryFilterKey) => void;
}) {
  return (
    <View style={styles.chips} accessibilityRole="tablist">
      {HISTORY_FILTERS.map((option) => {
        const selected = option.key === filter;

        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.key)}
            style={[styles.chip, selected && styles.chipSelected]}
          >
            <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function TripRow({
  trip,
  divided,
  last,
  onPress,
}: {
  trip: DriverHistoryTrip;
  divided: boolean;
  /** The row that closes the day's card — see `renderItem`. */
  last: boolean;
  onPress: () => void;
}) {
  const unpaid = trip.earned_minor === null;

  return (
    <Pressable
      accessibilityRole="button"
      // One composed sentence, not six cells. Read cell by cell this row
      // becomes "Ride, Acacia Mall, arrow, Kololo, 10:45 AM, UGX 10,000" —
      // with no idea what the figure is a figure *of*, which on this screen
      // is the one thing that must not be ambiguous.
      accessibilityLabel={rowAnnouncement(trip)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        divided && styles.rowDivided,
        last && styles.rowLast,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.glyph}>
        <RowIcon trip={trip} />
      </View>

      <View style={styles.rowText}>
        <View style={styles.rowLine}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {rowTitle(trip)}
          </Text>
          <Text style={styles.rowTime}>{timeLabel(trip.local_time)}</Text>
        </View>

        <View style={styles.rowLine}>
          <Text style={styles.rowRoute} numberOfLines={1}>
            {trip.origin}
            <Text style={styles.rowArrow}>{'  →  '}</Text>
            {trip.destination}
          </Text>

          <Text style={[styles.rowAmount, unpaid && styles.rowAmountAbsent]}>
            {rowAmount(trip)}
          </Text>
        </View>

        {/* Only where it says something. Every row here is finished, so
            "Completed" on all of them costs a line and carries nothing —
            while a cancelled row without it is distinguished only by an em
            dash, which is exactly the "meaning by absence" AGENTS.md's
            accessibility rule refuses. */}
        {showsStatus(trip) && (
          <Text style={[styles.rowStatus, STATUS_TONE[statusTone(trip)]]}>
            {statusLabel(trip.status)}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

/**
 * The glyph beside a row.
 *
 * **Redundant to the title next to it**, never carrying meaning of its own —
 * DESIGN.md §7: an icon means something only alongside a label.
 *
 * `PackageIcon` for a delivery, not a scooter. The mockup draws a motorbike
 * with a box on the back; Lucide has no scooter, and `bike` is a bicycle. The
 * package is already what `StatementRow` draws for a delivery in the wallet,
 * and one vocabulary across the app beats a closer match on one screen.
 *
 * `RouteIcon` is the unclassifiable case — a trip with no order request behind
 * it, which is neither a ride nor a delivery and should not borrow either's
 * glyph.
 */
function RowIcon({ trip }: { trip: DriverHistoryTrip }) {
  const tint = colors.primaryText;

  if (trip.service_type === 'delivery') {
    return <PackageIcon color={tint} size={22} strokeWidth={2} />;
  }

  if (trip.service_type === null) {
    return <RouteIcon color={tint} size={22} strokeWidth={2} />;
  }

  return <CarIcon color={tint} size={22} strokeWidth={2} />;
}

/**
 * Three empty states, not one.
 *
 * "No trips yet" under the Deliveries chip is wrong and discouraging for a
 * driver who has done thirty rides — the fix is one tap away and the sentence
 * should say so.
 */
function emptyMessage(filter: HistoryFilterKey): string {
  if (filter === 'ride') {
    return 'No rides yet.';
  }

  if (filter === 'delivery') {
    return 'No deliveries yet.';
  }

  return 'No finished trips yet. Work you complete appears here.';
}

/** DESIGN.md §3's status colours, keyed by the tone `statusTone` resolves. */
const STATUS_TONE = {
  danger: { color: colors.danger },
  warning: { color: colors.warning },
  neutral: { color: colors.textMuted },
} as const;

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  chip: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
  },
  chipSelected: {
    backgroundColor: colors.primaryCta,
  },
  chipLabel: {
    ...typography.label,
    fontSize: 16,
    color: colors.textBody,
  },
  chipLabelSelected: {
    color: colors.onPrimary,
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  /**
   * The day band. Sunken rather than plain, as the mockup has it, so a long
   * scroll reads as a stack of days rather than as one undifferentiated list.
   *
   * Not sticky: a heading pinned to the top of a scrolling list is a
   * convention from tables of contents, and here it would cover the row a
   * driver is reaching for on a screen only six rows tall.
   */
  sectionHeader: {
    backgroundColor: colors.surfaceSunken,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    // Three sides, not four: the card is a header plus its rows, and the
    // fourth edge is the last row's. A full border here would draw a rule
    // between the band and the first row that is not in the mockup.
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  sectionHeading: {
    ...typography.heading,
    fontSize: 18,
    color: colors.text,
  },
  sectionFooter: {
    height: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    // 52pt is the app's floor for a tap target and this row clears it on
    // content alone; the padding is what keeps two rows from touching.
    paddingVertical: spacing.md,
  },
  rowDivided: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  /** Closes the day's card: the fourth edge and the two bottom corners. */
  rowLast: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
  },
  pressed: {
    backgroundColor: colors.surfaceSunken,
  },
  glyph: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  rowTitle: {
    ...typography.bodyStrong,
    fontSize: 17,
    color: colors.text,
    flex: 1,
  },
  rowTime: {
    ...typography.caption,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  rowRoute: {
    ...typography.body,
    fontSize: 15,
    color: colors.textMuted,
    flex: 1,
  },
  rowArrow: {
    color: colors.placeholder,
  },
  rowAmount: {
    ...typography.bodyStrong,
    fontSize: 17,
    // Green because it is money earned, and `primaryText` rather than
    // `primary`: #01903D measures 4.15:1 on white and fails AA at body size.
    color: colors.primaryText,
    fontVariant: ['tabular-nums'],
  },
  /**
   * The em dash is muted rather than green. Green says "you were paid this",
   * and a green em dash would be a claim in the colour of a figure that is not
   * there — the status line underneath carries the actual reason.
   */
  rowAmountAbsent: {
    color: colors.textMuted,
  },
  rowStatus: {
    ...typography.captionStrong,
    fontSize: 12,
    marginTop: 2,
  },
  centre: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  skeleton: {
    padding: spacing.md,
  },
});
