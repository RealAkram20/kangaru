import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Image } from 'expo-image';
import { useCallback, useMemo, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DriverPresence, Trip } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { useDuty, useOffers, useSetDuty } from '../duty/queries';
import type { TripsStackParams } from '../navigation/types';
import { useSync } from '../offline/SyncProvider';
import { activeTripRoute, isInProgress, statusLabel } from '../trips/transitions';
import { useDriverStats, useTrips } from '../trips/queries';
import { money, ratingNote, ratingValue, walletNote, walletValue } from '../trips/statsPresentation';
import { TripMap } from '../trips/TripMap';
import { usePressScale } from '../ui/components';
import {
  BagIcon,
  BellIcon,
  ChartIcon,
  ChevronRightIcon,
  GaugeIcon,
  MenuIcon,
  ShieldCheckIcon,
  StarIcon,
  WalletIcon,
} from '../ui/icons';
import { SyncBanner } from '../ui/SyncBanner';
import { colors, MIN_TOUCH_HEIGHT, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<TripsStackParams, 'Home'>;

/**
 * The driver's home.
 *
 * Every number here is counted from something that happened. Trips and fares
 * come from trips this driver finished today; acceptance and completion rate
 * are computed by `GET /me/stats` over a rolling thirty days of real offers
 * and real endings. A rate with no denominator arrives as null and renders as
 * an em dash, because "0%" would read as a failing grade to somebody who has
 * simply not started yet.
 *
 * **Rating and wallet balance used to be permanent em dashes and are now
 * real** (ADR-0030, ADR-0029). The layout did not have to change, which was
 * the point of rendering them as dashes rather than hiding them — only where
 * the value comes from did.
 *
 * That handover was also this screen's worst bug. The server renamed
 * `fares_today_minor` to `earnings_today_minor` and the app kept reading the
 * old field, so `Math.trunc(undefined / 100)` printed **`undefined NaN`**
 * where a driver's money goes. The same private formatter divided by 100 on a
 * zero-decimal currency, which would have shown every figure at a hundredth
 * of its value. Both are gone: money now goes through `formatMoney` in
 * `duty/offerPresentation`, which is the app's one formatter and owns the
 * zero-decimal table. **Do not add a second one here.**
 *
 * The dash rule still holds for everything not yet loaded, and it is not the
 * same as a zero: `UGX 0` reads as a day with no work, and a driver whose
 * stats have not arrived has not had one.
 */
export function HomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { trips, isRefetching, refetch } = useTrips();
  const { data: stats, refetch: refetchStats } = useDriverStats();
  const { sync } = useSync();

  const { data: duty } = useDuty();
  const setDuty = useSetDuty();

  const onDuty = duty?.on_duty ?? false;

  // Polled only while on duty — a driver who has signed off is not waiting for
  // anything, and a five-second poll running all evening is the battery cost
  // that gets an app force-stopped.
  const { offers } = useOffers(onDuty);
  const offerCount = offers.length;

  const refresh = useCallback(async () => {
    await Promise.all([refetch(), refetchStats(), sync()]);
  }, [refetch, refetchStats, sync]);

  /**
   * Today's slice, computed here rather than asked for.
   *
   * `trips.index` already returns only this driver's work, and the app is
   * offline-first — a filter over the cache keeps working in a dead zone,
   * where a new endpoint would not.
   */
  const { active, completedToday } = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const isToday = (iso: string | null) =>
      iso !== null && new Date(iso).getTime() >= startOfDay.getTime();

    return {
      active: trips.find((trip) => isInProgress(trip.status)) ?? null,
      completedToday: trips
        .filter((trip) => trip.status === 'trip_completed' && isToday(trip.completed_at))
        // Newest first, which `trips.index` does not give: the server orders
        // by what is coming next, and this list asks the opposite question.
        .sort((a, b) => Date.parse(b.completed_at ?? '') - Date.parse(a.completed_at ?? '')),
    };
  }, [trips]);

  return (
    <View style={styles.screen}>
      <SyncBanner />

      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Menu"
          hitSlop={8}
          onPress={() => navigation.getParent()?.navigate('Account')}
          style={styles.topBarButton}
        >
          <MenuIcon color={colors.text} size={24} strokeWidth={2} />
        </Pressable>

        <Image
          source={require('../../assets/brand/wordmark.png')}
          style={styles.wordmark}
          contentFit="contain"
          accessible
          accessibilityRole="image"
          accessibilityLabel="KangaruRide"
          transition={0}
        />

        <View style={styles.topBarRight}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              offerCount > 0 ? `Notifications, ${offerCount} waiting` : 'Notifications'
            }
            hitSlop={8}
            onPress={() => navigation.navigate('Today')}
            style={styles.topBarButton}
          >
            <BellIcon color={colors.text} size={22} strokeWidth={2} />

            {/* Counts job offers, not unread mail: an offer has a fifteen-second
                clock on it and is the only thing here worth interrupting for. */}
            {offerCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{offerCount}</Text>
              </View>
            )}
          </Pressable>

          <View>
            {/* The driver's initial, not a photo: the platform holds no avatar,
                and one letter of their own name says more than a silhouette. */}
            <View style={styles.avatar}>
              <Text style={styles.avatarLetter}>
                {(user?.name ?? '?').trim().charAt(0).toUpperCase()}
              </Text>
            </View>

            {onDuty && <View style={styles.avatarOnline} />}
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refresh()}
            tintColor={colors.primary}
          />
        }
      >
        <DutyRow
          onDuty={onDuty}
          busy={setDuty.isPending}
          onToggle={() => setDuty.mutate({ onDuty: !onDuty })}
        />

        {/* Earnings takes the width because it is the number a driver opens the
            app for; the trip count rides beside it because it is one digit. */}
        <View style={styles.statRow}>
          <View style={styles.statCardWide}>
            {/*
              "Earnings today" — and it is now literally true, which it was
              not before. This tile used to sum the gross fare passengers paid
              and was called "Fares today" for that reason: without a
              commission model, calling a gross figure earnings would have
              overstated a driver's take-home.

              ADR-0029 settled the split. `earnings_today_minor` is the
              driver's *own share*, summed from `fare_earned` ledger entries,
              so the label finally means what it says (§5). The distinction
              still matters — the gross figure is what the passenger paid, and
              this is not it.
            */}
            <StatCardBody
              label="Earnings today"
              value={money(stats?.earnings_today_minor, stats?.currency)}
              icon={<ChartIcon color={colors.primary} size={20} strokeWidth={2.2} />}
            />
          </View>

          <View style={styles.statCardNarrow}>
            <StatCardBody
              // The server counts this too, but the local figure comes from
              // the same cache the list below renders — so the number and the
              // list can never disagree on screen, even offline.
              label="Trips"
              value={String(completedToday.length)}
              icon={<BagIcon color={colors.primary} size={20} strokeWidth={2} />}
            />
          </View>
        </View>

        {active !== null && (
          <ActiveTripCard
            trip={active}
            presence={duty ?? null}
            // Three destinations, one tap: the drive to the passenger, the
            // wait at the kerb, and the full record for everything after. Where
            // it lands follows what the driver is actually doing, and the two
            // predicates are disjoint by construction — see
            // `docs/agent-worklog.md`, which holds the one map of trip status
            // to screen, and `transitions.ts`, where the pair is defined
            // together so neither can quietly claim the other's status.
            onOpen={() => {
              // The decision lives in `activeTripRoute`, not here, so it can
              // be tested — this component has no test, and a
              // `passenger_onboard` trip silently fell through to the record
              // view for exactly that reason.
              const route = activeTripRoute(active.status);

              if (route === 'Odometer') {
                // The opening reading, resumed where the driver left it. The
                // only legal move from `passenger_onboard` is `trip_started`,
                // and that transition cannot be posted without it.
                navigation.navigate('Odometer', {
                  tripId: active.id,
                  to: 'trip_started',
                  from: active.status,
                });

                return;
              }

              navigation.navigate(route, { tripId: active.id });
            }}
          />
        )}

        <View style={styles.tileRow}>
          <StatTile
            label="Acceptance rate"
            value={formatRate(stats?.acceptance_rate)}
            icon={<ShieldCheckIcon color={colors.primary} size={17} strokeWidth={1.9} />}
          />
          {/*
            A real figure at last (ADR-0030), and still an em dash most of the
            time — **withheld until five ratings exist**. One three-star
            rating is not a 3.0; it is one person's afternoon, and showing it
            as a score invites a driver to read a single bad interaction as a
            permanent standing.

            `rating_count` says what it rests on, so "—" reads as "not yet"
            rather than as "nobody likes you". A driver with four can see they
            are one away.
          */}
          <StatTile
            label="Rating"
            value={ratingValue(stats)}
            note={ratingNote(stats)}
            icon={<StarIcon size={17} />}
          />
          <StatTile
            label="Completion rate"
            value={formatRate(stats?.completion_rate)}
            icon={<ShieldCheckIcon color={colors.primary} size={17} strokeWidth={1.9} />}
          />
        </View>

        {/*
          The ledger summed (ADR-0029 §1). **Negative is legitimate and is not
          an error state**: it means the driver is holding the platform's cash
          — a boda rider taking fares all day is in debt to the office until
          they settle. That is the honest reading and the one a settlement
          conversation starts from, so it is stated rather than hidden behind
          an absolute value.
        */}
        <View style={styles.walletCard}>
          <View style={styles.flex}>
            <Text style={styles.statLabel}>Wallet balance</Text>
            <Text style={styles.statValue}>
              {walletValue(stats)}
            </Text>
            <Text style={styles.statNote}>{walletNote(stats)}</Text>
          </View>

          <View style={styles.statIcon}>
            <WalletIcon color={colors.primary} size={20} strokeWidth={2} />
          </View>
        </View>

        <GoDutyButton
          onDuty={onDuty}
          busy={setDuty.isPending}
          onPress={() => setDuty.mutate({ onDuty: !onDuty })}
        />

        <CompletedToday
          trips={completedToday}
          onOpen={(id) => navigation.navigate('TripDetail', { tripId: id })}
        />
      </ScrollView>
    </View>
  );
}

/**
 * The duty switch, as a statement of fact — "You are online" — because that is
 * what a driver checks it for. The same act as the button at the bottom of the
 * screen; two controls for one state is affordable only because they sit at
 * opposite ends of a scroll, and whichever is in reach should work.
 */
function DutyRow({
  onDuty,
  busy,
  onToggle,
}: {
  onDuty: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <View style={styles.dutyRow}>
      <GaugeIcon color={onDuty ? colors.primary : colors.placeholder} size={22} strokeWidth={1.9} />
      <Text style={styles.dutyLabel}>{onDuty ? 'You are online' : 'You are offline'}</Text>

      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: onDuty, busy }}
        accessibilityLabel={onDuty ? 'Go offline' : 'Go online'}
        disabled={busy}
        onPress={onToggle}
        // The track is 29pt tall for the look; the tap target is not. This
        // slop takes it past the 52pt floor in both axes — going on duty is
        // the most consequential tap on the screen.
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={[styles.switchTrack, onDuty && styles.switchTrackOn]}
      >
        <View style={[styles.switchKnob, onDuty && styles.switchKnobOn]} />
      </Pressable>
    </View>
  );
}

/** Shared innards so the wide, narrow and wallet cards cannot drift apart. */
function StatCardBody({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: string;
  note?: string;
  icon: ReactNode;
}) {
  return (
    <>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>

      <View style={styles.statValueRow}>
        <Text style={[styles.statValue, styles.flex]}>{value}</Text>
        <View style={styles.statIcon}>{icon}</View>
      </View>

      {/* Under the row, not inside it: the icon belongs beside the number, and
          nesting the note in the same column drags it off that line. */}
      {note !== undefined && <Text style={styles.statNote}>{note}</Text>}
    </>
  );
}

function ActiveTripCard({
  trip,
  presence,
  onOpen,
}: {
  trip: Trip;
  /** The driver's own last fix — the map's only real coordinate source. */
  presence: DriverPresence | null;
  onOpen: () => void;
}) {
  const press = usePressScale();

  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Active trip from ${trip.origin} to ${trip.destination}`}
        onPress={onOpen}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={styles.activeCard}
      >
        <View style={styles.activeHead}>
          <Text style={styles.activeTitle}>Active trip</Text>
          <View style={styles.flex} />

          {/*
            The server's own word for where the trip is — "En route",
            "Waiting", "Trip in progress" are different facts and a driver
            glancing at this needs the true one.

            In the head row rather than beside the pickup, which is where the
            mockup drew it: a real status label runs to "Trip in progress",
            and beside the address it stole enough width to wrap a Kampala
            business name onto two lines. Up here it never competes.
          */}
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>{statusLabel(trip.status)}</Text>
          </View>
        </View>

        <View style={styles.route}>
          {/* Ring dots joined by a line that runs green to red — the shape of
              the journey, not two unrelated markers. */}
          <View style={styles.routeRail}>
            <View style={[styles.routeRing, { borderColor: colors.primary }]}>
              <View style={[styles.routeRingCore, { backgroundColor: colors.primary }]} />
            </View>
            <View style={[styles.routeLine, { backgroundColor: colors.primary }]} />
            <View style={[styles.routeLine, { backgroundColor: colors.danger }]} />
            <View style={[styles.routeRing, { borderColor: colors.danger }]}>
              <View style={[styles.routeRingCore, { backgroundColor: colors.danger }]} />
            </View>
          </View>

          <View style={styles.flex}>
            <View style={styles.routeLeg}>
              <Text style={styles.routeLabel}>Pickup</Text>
              <Text style={styles.routePlace} numberOfLines={2}>
                {trip.origin}
              </Text>
            </View>

            <View style={styles.routeLeg}>
              <Text style={styles.routeLabel}>Drop-off</Text>
              <Text style={styles.routePlace} numberOfLines={2}>
                {trip.destination}
              </Text>
            </View>
          </View>
        </View>

        {/* `dispatchable` is the server's own verdict on whether this fix is
            current enough to be offered work on — a better staleness test than
            any age threshold copied into the app. */}
        <TripMap
          latitude={presence?.latitude ?? null}
          longitude={presence?.longitude ?? null}
          stale={presence !== null && presence.latitude !== null && !presence.dispatchable}
        />
      </Pressable>
    </Animated.View>
  );
}

function StatTile({
  label,
  value,
  icon,
  note,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  /**
   * A line under the figure, for when the figure alone would mislead.
   *
   * The rating needs it: an em dash there means "withheld until five ratings"
   * (ADR-0030 §3), and without the count beside it a driver reads the dash as
   * a verdict rather than as "not yet".
   */
  note?: string | undefined;
}) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.tileValueRow}>
        <Text style={styles.tileValue}>{value}</Text>
        {icon}
      </View>
      {note !== undefined && (
        <Text style={styles.tileNote} numberOfLines={1}>
          {note}
        </Text>
      )}
    </View>
  );
}

function GoDutyButton({
  onDuty,
  busy,
  onPress,
}: {
  onDuty: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const press = usePressScale();

  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={onDuty ? 'Go offline' : 'Go online'}
        accessibilityState={{ busy }}
        disabled={busy}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={styles.goButton}
      >
        {busy ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={styles.goButtonLabel}>{onDuty ? 'Go Offline' : 'Go Online'}</Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

/** The day's finished work, newest first — what the driver has to show for it. */
function CompletedToday({
  trips,
  onOpen,
}: {
  trips: Trip[];
  onOpen: (tripId: number) => void;
}) {
  if (trips.length === 0) {
    return (
      <View style={styles.emptyToday}>
        <Text style={styles.emptyTodayText}>
          No trips finished today yet. Completed work will appear here.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.todaySection}>
      <Text style={styles.sectionTitle}>Earlier today</Text>

      {trips.map((trip) => (
        <Pressable
          key={trip.id}
          accessibilityRole="button"
          accessibilityLabel={`Completed trip from ${trip.origin} to ${trip.destination}`}
          onPress={() => onOpen(trip.id)}
          style={styles.todayRow}
        >
          <View style={styles.todayDot} />

          <View style={styles.flex}>
            <Text style={styles.todayPlaces} numberOfLines={1}>
              {trip.origin} → {trip.destination}
            </Text>
            <Text style={styles.todayMeta}>
              {formatTime(trip.completed_at)}
              {trip.distance_km !== null ? ` · ${formatDistance(trip.distance_km)} km` : ''}
            </Text>
          </View>

          <ChevronRightIcon color={colors.placeholder} size={18} />
        </Pressable>
      ))}
    </View>
  );
}

/**
 * A rate, or an em dash when there is nothing to divide by.
 *
 * The server sends null rather than zero for a driver who has answered no
 * offers yet, and that distinction has to survive to the screen: "0%" reads
 * as a failing grade for having done nothing wrong.
 */
function formatRate(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? '—' : `${Math.round(rate)}%`;
}

/**
 * "5.10" → "5.1". The server sends a fixed-2 decimal because distance is a
 * billing input; that precision is right in an invoice and noise in a one-line
 * summary of somebody's morning.
 */
function formatDistance(km: string): string {
  const value = Number(km);

  return Number.isFinite(value) ? String(Number(value.toFixed(1))) : km;
}

/** Local clock time, because a driver checks this against their own morning. */
function formatTime(iso: string | null): string {
  if (iso === null) {
    return '';
  }

  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const CARD = {
  backgroundColor: colors.surface,
  borderRadius: radius.md,
  borderWidth: 1,
  borderColor: colors.border,
} as const;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  /**
   * `MIN_TOUCH_HEIGHT`, not the 40 this started as. The theme sets 52 above
   * the 44pt platform floor because of where this app is used — a phone in a
   * cradle, one-handed, sometimes in gloves — and the top bar is no exception
   * just because its glyphs are small.
   */
  topBarButton: {
    width: MIN_TOUCH_HEIGHT,
    height: MIN_TOUCH_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  wordmark: {
    flex: 1,
    height: 30,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    ...typography.captionStrong,
    color: colors.primaryText,
  },
  avatarOnline: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 11,
    height: 11,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  badge: {
    position: 'absolute',
    top: 3,
    right: 3,
    minWidth: 17,
    height: 17,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  badgeText: {
    ...typography.caption,
    fontSize: 10,
    lineHeight: 13,
    color: colors.onPrimary,
  },
  body: {
    padding: spacing.md,
    gap: spacing.sm + 4,
  },
  dutyRow: {
    ...CARD,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    backgroundColor: colors.surfaceSunken,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  dutyLabel: {
    ...typography.body,
    color: colors.textBody,
    flex: 1,
  },
  switchTrack: {
    width: 50,
    height: 29,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    padding: 3,
    justifyContent: 'center',
  },
  switchTrackOn: {
    backgroundColor: colors.primaryCta,
  },
  switchKnob: {
    width: 23,
    height: 23,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  switchKnobOn: {
    alignSelf: 'flex-end',
  },
  statRow: {
    flexDirection: 'row',
    gap: spacing.sm + 4,
  },
  /** Earnings: the number the app is opened for, so it gets the room. */
  statCardWide: {
    ...CARD,
    flex: 1.85,
    padding: spacing.md,
  },
  statCardNarrow: {
    ...CARD,
    flex: 1,
    padding: spacing.md,
  },
  walletCard: {
    ...CARD,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  statLabel: {
    ...typography.caption,
    fontSize: 13,
    color: colors.textMuted,
  },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  statValue: {
    ...typography.heading,
    color: colors.text,
  },
  statNote: {
    ...typography.caption,
    fontSize: 11,
    color: colors.placeholder,
    marginTop: 1,
  },
  statIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeCard: {
    ...CARD,
    padding: spacing.md,
  },
  activeHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  activeTitle: {
    ...typography.bodyStrong,
    fontSize: 17,
    color: colors.text,
  },
  route: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm + 4,
  },
  routeRail: {
    alignItems: 'center',
    // Aligns the first ring with the "Pickup" label's optical centre rather
    // than the block's top edge.
    paddingTop: 5,
  },
  routeRing: {
    width: 15,
    height: 15,
    borderRadius: radius.pill,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeRingCore: {
    width: 5,
    height: 5,
    borderRadius: radius.pill,
  },
  routeLine: {
    width: 2.5,
    flex: 1,
    minHeight: 22,
  },
  routeLeg: {
    marginBottom: spacing.md,
  },
  routeLabel: {
    ...typography.caption,
    fontSize: 13,
    color: colors.textMuted,
  },
  routePlace: {
    ...typography.bodyStrong,
    fontSize: 16,
    color: colors.text,
    marginTop: 1,
  },
  statusPill: {
    backgroundColor: colors.successTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 7,
  },
  statusPillText: {
    ...typography.captionStrong,
    color: colors.success,
  },
  tileRow: {
    flexDirection: 'row',
    gap: spacing.sm + 4,
  },
  tile: {
    ...CARD,
    flex: 1,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 4,
  },
  tileLabel: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
  },
  tileValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs + 2,
  },
  tileValue: {
    ...typography.bodyStrong,
    fontSize: 19,
    color: colors.text,
  },
  tileNote: {
    ...typography.caption,
    fontSize: 11,
    // `textMuted`, not `placeholder`. DESIGN.md §1 demotes #979DA9 on light
    // surfaces by name — it measures 2.72:1 on white and fails AA for text.
    // It is legitimate on navy (~7:1) and as a placeholder; this is neither.
    color: colors.textMuted,
    marginTop: 2,
  },
  goButton: {
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: colors.primaryCta,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  goButtonLabel: {
    ...typography.button,
    fontSize: 18,
    color: colors.onPrimary,
  },
  sectionTitle: {
    ...typography.bodyStrong,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  todaySection: {
    marginTop: spacing.sm,
  },
  todayRow: {
    ...CARD,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  todayDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.success,
  },
  todayPlaces: {
    ...typography.body,
    fontSize: 15,
    color: colors.textBody,
  },
  todayMeta: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  emptyToday: {
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  emptyTodayText: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
