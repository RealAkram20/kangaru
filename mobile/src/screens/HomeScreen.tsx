import { DrawerActions } from '@react-navigation/native';
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

import { authorizedImageSource } from '../api/imageSource';
import type { DriverPresence, Trip } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { useDutyToggle } from '../duty/useDutyToggle';
import type { TripsStackParams } from '../navigation/types';
import { useNotifications } from '../notifications/queries';
import { useDriverProfile } from '../profile/queries';
import { useSync } from '../offline/SyncProvider';
import { isLiveLeg, statusLabel, tripDestination } from '../trips/transitions';
import { useDriverStats, useTrips } from '../trips/queries';
import { money, ratingNote, ratingValue, walletNote, walletValue } from '../trips/statsPresentation';
import { TripMap } from '../trips/TripMap';
import { usePressScale } from '../ui/components';
import {
  BagIcon,
  BellIcon,
  ChevronRightIcon,
  GaugeIcon,
  MenuIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  StarIcon,
  WalletIcon,
} from '../ui/icons';
import { SyncBanner } from '../ui/SyncBanner';
import { colors, MIN_TOUCH_HEIGHT, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<TripsStackParams, 'TripsHome'>;

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

  // The same query the drawer reads, so the header and the drawer cannot show
  // one driver two faces. Cached by whichever opened first.
  const { data: driverProfile } = useDriverProfile();
  const photoUrl = driverProfile?.photo_url ?? null;
  const { trips, isRefetching, refetch } = useTrips();
  const { data: stats, refetch: refetchStats } = useDriverStats();
  const { sync } = useSync();

  /*
    The shared act, not a bare `useSetDuty().mutate`. This screen used to call
    the mutation directly and drop its result on the floor, which lost the
    three things `useDutyToggle` exists to keep together: the location
    permission asked at sign-on, the shift's vehicle travelling with the
    request, and — the one that was found on a handset — the server's refusal.
    A driver off their roster tapped "Go online", the office answered
    `409 DRIVER_UNAVAILABLE "This driver is not rostered for that time."`,
    and this screen showed nothing at all: the switch stayed where it was, the
    driver assumed the button was broken, and sat waiting for offers that could
    never come. ADR-0017 put that sentence on the server precisely so the app
    can show it verbatim, and now it does — under the switch it answers.
  */
  const { duty, onDuty, dispatchable, busy: dutyBusy, refusal, toggle } = useDutyToggle();

  /*
    What the office has said, for the bell in the top bar.

    **Not the offer poll this used to read.** The bell opens the inbox now, so
    it has to count what is *in* the inbox — a badge saying "3" over a control
    that opens a list with nothing unread in it is a lie told by the one
    element on the screen whose whole job is to be counted on.

    Job offers lost nothing by this: they were never reachable through the
    bell, they are painted over every screen by `OfferPresenter`, and they
    arrive on the lock screen as a push. This query is not polled at all (see
    `useNotifications`) — the inbox changes a few times a day.
  */
  const { data: inbox } = useNotifications();
  const unread = inbox?.unread ?? 0;

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
  const { active, unanswered, completedToday } = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const isToday = (iso: string | null) =>
      iso !== null && new Date(iso).getTime() >= startOfDay.getTime();

    return {
      // `isLiveLeg`, not `isInProgress`: an offer just accepted sits in
      // `accepted`, which the latter excludes — so the card vanished at the
      // exact moment a passenger started waiting.
      active: trips.find((trip) => isLiveLeg(trip.status)) ?? null,
      // A desk-assigned trip the driver has not answered (ADR-0064). Before
      // this card it surfaced only in the Trips list's Upcoming group, which
      // is nowhere a driver looks while parked at a kerb — an owner watched
      // a freshly dispatched delivery reach the handset and show nothing.
      unanswered: trips.find((trip) => trip.status === 'assigned') ?? null,
      completedToday: trips
        .filter((trip) => trip.status === 'trip_completed' && isToday(trip.completed_at))
        // Newest first, which `trips.index` does not give: the server orders
        // by what is coming next, and this list asks the opposite question.
        .sort((a, b) => Date.parse(b.completed_at ?? '') - Date.parse(a.completed_at ?? '')),
    };
  }, [trips]);

  return (
    <View style={styles.screen}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open menu"
          hitSlop={8}
          /*
            Opens the drawer, which is what this button always looked like it
            did. It used to jump to the Profile *tab* — a hamburger that
            switched tabs, which is the one thing a hamburger does not mean.
            The drawer is two levels up: this screen sits in the Trips stack,
            inside the tab navigator, inside the drawer.
          */
          onPress={() => navigation.getParent()?.getParent()?.dispatch(DrawerActions.openDrawer())}
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
            // The drawer's row is worded exactly this way. One control that
            // reads two different ways to a screen reader is two controls as
            // far as the person using it is concerned.
            accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            hitSlop={8}
            /*
              The inbox — which is what a bell has always meant, and what this
              one did not do. It went to `Today`, a second copy of this screen's
              own list, and that screen is gone: the owner's *"the notification
              icon should be linked to the notification page, and make sure
              this page is removed"*.

              `getParent()`, because `Notifications` lives on the **Profile**
              stack (ADR-0039) rather than on this one — the same hop the
              Earnings and Wallet tiles below make, plus the screen inside the
              tab. The drawer's Notifications row lands in the identical place.
            */
            /*
              **`initial: false`, and its absence here was a real bug.**

              Navigating into a tab that has not been rendered yet does not
              push onto its stack — React Navigation builds that stack's
              *initial state* out of what it was handed. Without this word the
              Profile stack came into existence as `["Notifications"]` at index
              0, with `ProfileHome` never in it: nothing to pop, so pressing
              the Profile tab appeared to do nothing and Android's back gesture
              left the app.

              `DrawerContent.go` was fixed for exactly this and
              `nestedNavigate.test.tsx` documents it; **this call site was
              missed**, which is why it came back as the owner's *"we are
              stuck, sometimes"* and *"clicking profile sends us to the
              notifications"*. Sometimes, because it only bites when the driver
              has not visited Profile since the app started.
            */
            onPress={() =>
              navigation
                .getParent()
                ?.navigate('Profile', { screen: 'Notifications', initial: false })
            }
            style={styles.topBarButton}
          >
            <BellIcon color={colors.text} size={22} strokeWidth={2} />

            {/* Unread messages from the office — the same count the drawer's
                row carries, from the same query, so the two cannot disagree. */}
            {unread > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unread}</Text>
              </View>
            )}
          </Pressable>

          {/*
            **The avatar is a control, and it was not one.** It sat here as a
            bare `View`: the most person-shaped thing on the screen, in the
            corner every app puts an account button in, doing nothing. The
            owner's *"most time people will click on it"* is simply what a
            driver does with it.

            **And it shows the photograph now.** The comment this replaces said
            "the platform holds no avatar" — true when it was written and wrong
            since ADR-0041. `DrawerContent` has been rendering `photo_url` all
            along, so a driver who set a photo saw their face in the drawer and
            their initial here. Same source, same fallback, from a query the
            drawer has already warmed — and the same **authorized** source, for
            the reason spelled out on the `Image` below.
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Your profile"
            hitSlop={8}
            // `getParent()`, like the bell above it: Profile is a sibling tab,
            // not a screen on this stack, and navigating locally would throw.
            onPress={() => navigation.getParent()?.navigate('Profile', { screen: 'ProfileHome' })}
          >
            <View style={styles.avatar}>
              {photoUrl === null ? (
                // Initials are the ordinary case, not a failure: a driver who
                // has not sent the office a photograph has one permanently.
                <Text style={styles.avatarLetter}>
                  {(user?.name ?? '?').trim().charAt(0).toUpperCase()}
                </Text>
              ) : (
                <Image
                  // **Authorized, not bare.** ADR-0041 streams the portrait
                  // from an endpoint behind `auth:sanctum`, so a source without
                  // the bearer token is answered with a 401 and draws an empty
                  // circle — with nothing on screen to say why. This read as
                  // working during development only because `expo-image`
                  // caches by URL and the drawer, which did send the header,
                  // had already fetched the same picture; on a handset that
                  // opened this screen first there was never anything to hit.
                  source={authorizedImageSource(photoUrl)}
                  style={styles.avatarPhoto}
                  contentFit="cover"
                  transition={120}
                  // Decorative: the pressable above carries the label.
                  accessibilityElementsHidden
                />
              )}
            </View>

            {onDuty && <View style={styles.avatarOnline} />}
          </Pressable>
        </View>
      </View>

      {/*
        Under the top bar, not above it. It sat first in this view, above the
        bar that carries the status-bar inset, so its first line was drawn
        under the clock and the battery — the owner's screenshot. Every other
        screen mounts it below its header; this one now does too.
      */}
      <SyncBanner />

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
          dispatchable={dispatchable}
          busy={dutyBusy}
          refusal={refusal}
          onToggle={() => void toggle()}
        />

        {/* Earnings takes the width because it is the number a driver opens the
            app for; the trip count rides beside it because it is one digit. */}
        <View style={styles.statRow}>
          {/*
            Pressable, and the tile a driver would naturally tap to see their
            money now actually opens it. It was a plain `View` — the one place
            on the home screen where the obvious gesture did nothing.

            "Earnings today" is literally true, which it was not before. This
            tile used to sum the gross fare passengers paid and was called
            "Fares today" for that reason: without a commission model, calling
            a gross figure earnings would have overstated a driver's
            take-home. ADR-0029 settled the split — `earnings_today_minor` is
            the driver's *own share*, from `fare_earned` ledger entries (§5).

            The Earnings screen measures the same "today" this tile does: both
            take the day boundary from `settings.regional.timezone` via
            `DriverEarningsService`, so the figure here and the figure there
            are the same number rather than two readings of the word.
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Earnings today. Opens your earnings."
            // `getParent()`, because Earnings is a **tab** now rather than a
            // screen pushed onto this stack. The tile still works and still
            // lands in the same place; what changed is that the driver can
            // also reach it from the bar without coming through Home.
            onPress={() => navigation.getParent()?.navigate('Earnings')}
            style={styles.statCardWide}
          >
            <StatCardBody
              label="Earnings today"
              value={money(stats?.earnings_today_minor, stats?.currency)}
              // `ReceiptIcon`, matching the Earnings tab's glyph. It was
              // `ChartIcon`, which left two pictures meaning "earnings" one
              // scroll apart — DESIGN.md § Icons wants one vocabulary.
              icon={<ReceiptIcon color={colors.primary} size={20} strokeWidth={2.2} />}
            />
          </Pressable>

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
              // One decision, shared with Today's list — see `tripDestination`.
              const to = tripDestination(active.status, active.id);

              navigation.navigate(to.screen, to.params as never);
            }}
          />
        )}

        {/*
          After the active card, not before: a job in hand outranks a job on
          offer. When nothing is live this is the top card, which is the
          whole point — the desk's assignment is the next thing this driver
          decides, not something to find in a list.
        */}
        {unanswered !== null && (
          <AssignedTripCard
            trip={unanswered}
            onOpen={() => {
              const to = tripDestination(unanswered.status, unanswered.id);

              navigation.navigate(to.screen, to.params as never);
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
        {/* Pressable, like the Earnings tile beside it. The balance answers
            *what*; the statement behind it answers *why*, which is the only
            question a driver actually has about this figure. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Wallet balance ${walletValue(stats)}. ${walletNote(stats)}. Opens your wallet.`}
          // A tab now, like Earnings above — see that tile for why this is
          // `getParent()`.
          onPress={() => navigation.getParent()?.navigate('Wallet')}
          style={styles.walletCard}
        >
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
        </Pressable>

        <GoDutyButton
          onDuty={onDuty}
          busy={dutyBusy}
          onPress={() => void toggle()}
        />

        <CompletedToday
          trips={completedToday}
          onOpen={(id) => navigation.navigate('TripDetail', { tripId: id })}
          onSeeAll={() => navigation.navigate('TripsHistory')}
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
  dispatchable,
  busy,
  refusal,
  onToggle,
}: {
  onDuty: boolean;
  /** The server's verdict, not the toggle's position — see `DutyBar`. */
  dispatchable: boolean;
  busy: boolean;
  /** The office's answer when a sign-on was refused, in its own words. */
  refusal: string | null;
  onToggle: () => void;
}) {
  return (
    <View style={styles.dutyCard}>
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

      {/*
        Directly under the switch that was refused, so cause and answer sit
        together — a toast would be gone before a driver looked up from the
        knob that did not move. `alert` so a screen reader announces it
        without the driver hunting for why nothing changed.
      */}
      {refusal !== null && (
        <Text accessibilityRole="alert" style={styles.dutyRefusal}>
          {refusal}
        </Text>
      )}

      {/*
        On duty is not the same as findable, and the gap between the two is
        where "I'm online but get nothing" lives — the owner sat in it for an
        hour. `DutyBar`'s sentence, verbatim, so the drawer and this card
        never describe one state in two ways. Quiet while a refusal is up:
        the refusal already explains why nothing is coming.
      */}
      {refusal === null && onDuty && !dispatchable && (
        <Text style={styles.dutyRefusal}>
          Waiting for a location fix — you may not get jobs yet
        </Text>
      )}
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

/**
 * A desk-assigned trip the driver has not answered (ADR-0064).
 *
 * The ActiveTripCard's shape without its map: there is no leg to draw —
 * the driver has not taken the job — and a map under a question reads as
 * "you are going here", which the app must not say before they answer.
 * The tap lands on the trip record, where Accept and Decline live.
 */
function AssignedTripCard({ trip, onOpen }: { trip: Trip; onOpen: () => void }) {
  const press = usePressScale();

  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`New trip assigned from ${trip.origin} to ${trip.destination}. Opens the trip to accept or decline.`}
        onPress={onOpen}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={styles.activeCard}
      >
        <View style={styles.activeHead}>
          <Text style={styles.activeTitle}>New trip assigned</Text>
          <View style={styles.flex} />
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>Accept or decline</Text>
          </View>
        </View>

        <View style={styles.route}>
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

/**
 * The day's finished work, newest first — what the driver has to show for it.
 *
 * **The way into the trip history**, which is why *See all* is here rather
 * than on a card of its own: this section is already the question "what have I
 * done", and the history is the same question over a longer window. A separate
 * tile for it would be a second door to one room.
 *
 * The link is on the empty state too. A driver who has finished nothing *today*
 * is exactly the one most likely to want last week — and a screen that only
 * offers the door once there is something behind it hides it from the person
 * looking for it.
 */
function CompletedToday({
  trips,
  onOpen,
  onSeeAll,
}: {
  trips: Trip[];
  onOpen: (tripId: number) => void;
  onSeeAll: () => void;
}) {
  if (trips.length === 0) {
    return (
      <View style={styles.emptyToday}>
        <Text style={styles.emptyTodayText}>
          No trips finished today yet. Completed work will appear here.
        </Text>
        <SeeAllTrips onPress={onSeeAll} />
      </View>
    );
  }

  return (
    <View style={styles.todaySection}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Earlier today</Text>
        <SeeAllTrips onPress={onSeeAll} />
      </View>

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
 * The way to the full history. Matches the wallet's *View all* exactly — same
 * words, same chevron, same green — because they are the same gesture on two
 * screens, and two spellings of one control is how an app starts feeling like
 * several.
 */
function SeeAllTrips({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="View all trips"
      onPress={onPress}
      hitSlop={10}
      style={styles.viewAll}
    >
      <Text style={styles.viewAllLabel}>View all</Text>
      <ChevronRightIcon color={colors.primaryText} size={18} strokeWidth={2.2} />
    </Pressable>
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
  /**
   * 30 to 40. The owner's *"logo is too small in the Home page"*.
   *
   * It sits between two 44pt controls and was drawn a third shorter than
   * either, which is what made it read as small rather than as the thing the
   * bar is named after. 40 matches the controls it sits between without
   * growing the bar: `topBar` has no fixed height and the row is centred, so
   * the extra ten points come out of the padding either side of the mark
   * rather than pushing the content down.
   *
   * `contentFit` on the image keeps the aspect ratio, so this is a ceiling on
   * the height rather than a stretch.
   */
  wordmark: {
    flex: 1,
    height: 40,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    // Clips the photograph to the circle; without it a square image spills out
    // of the pill on Android.
    overflow: 'hidden',
  },
  avatarPhoto: {
    width: '100%',
    height: '100%',
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
  dutyCard: {
    ...CARD,
    backgroundColor: colors.surfaceSunken,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  dutyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
  },
  // Amber, the same voice as `DutyBar`'s refusal: a refusal is the office
  // saying "not now", not a fault. Indented past the gauge icon so it reads as
  // belonging to the label beside it.
  dutyRefusal: {
    ...typography.caption,
    color: colors.warning,
    marginTop: spacing.xs,
    marginLeft: 22 + spacing.sm + 2,
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
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  viewAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  viewAllLabel: {
    ...typography.captionStrong,
    color: colors.primaryText,
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
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyTodayText: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
