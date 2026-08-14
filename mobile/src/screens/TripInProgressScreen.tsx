import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Coordinates, Trip, TripRoute } from '../api/types';
import { estimatedFareLabel, formatKilometres, formatMoney } from '../duty/offerPresentation';
import { usePosition } from '../location/usePosition';
import type { TripsStackParams } from '../navigation/types';
import { useSync } from '../offline/SyncProvider';
import { dialPassenger } from '../trips/contact';
import { PickupMap } from '../trips/PickupMap';
import { located, greatCircleKm, toCoordinates } from '../trips/places';
import {
  durationAnnouncement,
  formatTripDuration,
  startedAtFrom,
  tripPaymentLabel,
  waitingSecondsFrom,
} from '../trips/progress';
import { useTrip, useTripEvents, useTripRoute } from '../trips/queries';
import { statusLabel } from '../trips/transitions';
import { elapsedSeconds, NO_VALUE } from '../trips/waiting';
import { Button, Notice, Screen, ScreenHeader } from '../ui/components';
import { DetailRow, GLYPH, Stat, StatRow } from '../ui/facts';
import {
  BanknoteIcon,
  NavigationIcon,
  PauseIcon,
  PhoneIcon,
  PlayIcon,
  RouteIcon,
  SquareIcon,
  UserIcon,
  WalletIcon,
} from '../ui/icons';
import { SyncBanner } from '../ui/SyncBanner';
import { colors, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<TripsStackParams, 'TripInProgress'>;

/** Matches `PickupScreen` — `DirectContactChannel` returns this as the label. */
const PASSENGER_LABEL = 'Passenger';

/** The heading, and the string the status line is checked against. */
const TITLE = 'Trip in progress';

/**
 * The journey itself: `trip_started`, `waiting` and `trip_resumed`.
 *
 * The last of the three live-leg screens. `PickupScreen` is the drive to the
 * passenger, `WaitingForPassengerScreen` is the wait at the kerb, and this is
 * the ride — one status belongs to one screen, and
 * `docs/agent-worklog.md` holds the map. `passenger_onboard` is not here: it
 * belongs to `OdometerScreen`, which is where the opening reading is taken and
 * which posts `trip_started` on its way out.
 *
 * ## Five things the mockup drew that are not here
 *
 * Raised before any code was written; the owner ruled on each. Three of them
 * `PickupScreen` refused independently, which is worth noting — three agents
 * reading the same ADRs reached the same answer.
 *
 * - **No "12 min", and no "ETA 10:05 AM".** ADR-0020 §3 declined to derive
 *   minutes from a straight line by name. The clock time is the worse of the
 *   two: it is a promise, made to somebody sitting in the car, and real roads
 *   are longer than the crow's flight so it is a promise that runs short. The
 *   badge shows distance and *elapsed* time instead — both measured.
 * - **No rating beside the passenger's name.** ADR-0030's ratings run the
 *   other way: the customer rates the driver, and even that is withheld below
 *   five of them. A star here would invert the glyph's meaning platform-wide.
 * - **No avatar.** `ContactDetails` is `{name, phone, label}`; customers have
 *   no photograph anywhere in the schema, and a stock face misidentifies the
 *   person in the car.
 * - **No "Applepay".** The platform knows `cash`, `mobile_money` and `card`
 *   (`OfferPaymentMethod`). Apple Pay is not one of them, nothing implements
 *   it, and it would need a paid integration — which `quality-control` makes
 *   an owner's decision rather than an agent's. The real payment method is
 *   shown instead, and renders as an em dash when nobody stated one.
 * - **No route line on the map.** There is no routing engine. `PickupMap`
 *   draws markers only and says why: a straight line is not a road, and
 *   drawing one tells a driver to go a way that may not exist.
 *
 * ## The two figures that are real
 *
 * **Distance still to go** is straight-line from where the driver is *now* to
 * the drop-off, recomputed as they move (`usePosition({ watch: true })`), and
 * labelled "straight line" in words on the badge. It is the one number here
 * that is supposed to change.
 *
 * **Elapsed time** is counted from the `trip_started` row in `trip_events` —
 * the append-only timeline, not `trips.started_at`, because AGENTS.md's rule
 * is that trip timing comes from the timeline rather than from a column an
 * update can quietly move.
 *
 * Distance *travelled* is deliberately absent: `gps_distance_km` and
 * `distance_km` are both written at Trip Completed, so mid-journey there is
 * no such figure to show and an em dash would be a row that never fills.
 */
export function TripInProgressScreen({ route, navigation }: Props) {
  const { tripId } = route.params;
  const { data: trip, isLoading } = useTrip(tripId);
  const { data: events } = useTripEvents(tripId);
  const { queueTransition } = useSync();

  const [busy, setBusy] = useState(false);

  // Watching, unlike every other screen in this app. The driver is
  // definitionally moving for this screen's whole life, so a single fix would
  // be wrong within a minute and stay wrong — see `usePosition`.
  const here = usePosition({ watch: true });
  const { data: roadRoute } = useTripRoute(tripId, here);

  const startedAt = startedAtFrom(events, trip?.started_at ?? null);
  const now = useTicker();

  if (isLoading && trip === undefined) {
    return (
      <Screen>
        <SyncBanner />
        <Text style={styles.loading}>Loading…</Text>
      </Screen>
    );
  }

  if (trip === undefined) {
    return (
      <Screen>
        <SyncBanner />
        <Notice message="This trip is not on this phone and the office cannot be reached." />
      </Screen>
    );
  }

  const passenger = trip.passenger_contact;
  const dropoff = located(trip.dropoff) ? toCoordinates(trip.dropoff) : null;

  const driving = startedAt === null ? null : elapsedSeconds(startedAt, now);

  const paused = trip.status === 'waiting';

  /**
   * Total time this trip has spent on hold, including the pause running now.
   *
   * Null rather than zero when the timeline has not arrived — the same rule
   * every other figure on this screen follows. A `00:00` on a trip that has
   * been held twice would understate a charge the passenger will see.
   */
  const waited = events === undefined ? null : waitingSecondsFrom(events, now);

  /**
   * Holding the trip, and picking it up again.
   *
   * **Both are billable acts**, which is the whole reason this screen has the
   * control at all rather than leaving a driver to explain a wait afterwards:
   * `WalkInFareService::settle()` runs `TripPricingEngine`, which prices a
   * `WAITING` line from the periods these two transitions open and close.
   *
   * **Deliberately no confirmation dialog**, and the reasoning is arithmetic
   * rather than taste. `WaitingTimeCalculator` truncates the total to whole
   * minutes once, at the end — so a mis-tap corrected within seconds bills
   * nothing at all. A confirmation on a reversible, zero-cost mistake is a
   * dialog a driver dismisses without reading, which is how a confirmation
   * stops protecting the case that matters.
   *
   * Queued through the outbox like every other transition. Worth knowing that
   * `waiting ⇄ trip_resumed` is the lifecycle's **only cycle**, and therefore
   * the one place a blind replay is accepted rather than 409'd — it would
   * write a second `trip_events` row and bill the pause twice. ADR-0023's
   * reconciliation is what prevents that, and nothing here re-implements it.
   */
  const hold = async (to: 'waiting' | 'trip_resumed') => {
    setBusy(true);
    await queueTransition({ tripId: trip.id, from: trip.status, to });
    setBusy(false);
  };

  /**
   * Ending the trip is the odometer, not a transition.
   *
   * `trip_completed` requires the closing reading — `TransitionTripRequest`
   * makes `odometer_end` mandatory on it — so posting the transition from
   * here would 422 after the driver had already put the phone down. The
   * reading is also two of the six data points the anchor client accepts this
   * platform on, which is why it has a screen of its own rather than an
   * inline field: a number typed by mistake here becomes a billing dispute
   * later.
   *
   * `from` is the trip's *current* status rather than a constant, because
   * this screen renders three of them and a trip paused at `waiting` completes
   * from `trip_resumed`, not from `trip_started`.
   */
  const end = () => {
    navigation.navigate('Odometer', {
      tripId: trip.id,
      to: 'trip_completed',
      from: trip.status,
    });
  };

  return (
    <Screen>
      <SyncBanner />

      <ScreenHeader
        title={TITLE}
        // Only when it adds something. `statusLabel` renders both
        // `trip_started` and `trip_resumed` as "Trip in progress", which is
        // the title verbatim; `waiting` renders "Waiting", and a paused trip
        // is exactly the state somebody glancing at this screen needs told.
        subtitle={statusLabel(trip.status) === TITLE ? null : statusLabel(trip.status)}
        onBack={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <MapPanel trip={trip} here={here} driving={driving} route={roadRoute ?? null} />

        {passenger !== null && (
          <DetailRow
            icon={<UserIcon {...GLYPH} />}
            label={PASSENGER_LABEL}
            value={passenger.name}
            // Only when the channel says something the label does not — see
            // `PickupScreen`, which carries the full reasoning about the
            // masking provider ADR-0024 §7 designs for.
            caption={passenger.label === PASSENGER_LABEL ? null : passenger.label}
            trailing={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Call ${passenger.name}`}
                onPress={() => void dialPassenger(passenger)}
                style={styles.call}
              >
                <PhoneIcon color={colors.onPrimary} size={20} strokeWidth={2} />
              </Pressable>
            }
          />
        )}

        <DetailRow
          icon={<NavigationIcon {...GLYPH} />}
          label="Drop-off"
          value={trip.dropoff.label}
          caption={null}
          trailing={
            dropoff !== null ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Navigate to ${trip.dropoff.label}`}
                onPress={() => navigation.navigate('TripMap', { tripId: trip.id })}
                style={styles.navigate}
              >
                <NavigationIcon color={colors.primaryText} size={18} strokeWidth={2} />
                <Text style={styles.navigateLabel}>Navigate</Text>
              </Pressable>
            ) : null
          }
        />

        <Facts trip={trip} />

        {paused && (
          <Notice
            tone="info"
            message={
              waited === null
                ? 'This trip is on hold. Waiting time is recorded on the trip and priced by the tariff.'
                : `On hold for ${formatTripDuration(waited)}. Waiting time is recorded on the trip and priced by the tariff.`
            }
          />
        )}

        <View style={styles.actions}>
          {/*
            Two modes, not one mode with an extra button, and the graph is why.
            `TripStatus::WAITING` allows exactly one exit — `TRIP_RESUMED` —
            so **End trip is not reachable from a paused trip**. Rendering it
            anyway would 422 through the outbox, minutes later, after the
            driver had put the phone down and walked away from a journey they
            believed was finished.
          */}
          {paused ? (
            <Button
              label="Resume trip"
              tone="primary"
              busy={busy}
              onPress={() => void hold('trip_resumed')}
              icon={<PlayIcon size={16} />}
            />
          ) : (
            <>
              <Button
                label="Pause trip"
                tone="neutral"
                busy={busy}
                onPress={() => void hold('waiting')}
                icon={<PauseIcon size={16} />}
              />
              <Button
                label="End trip"
                tone="danger"
                busy={busy}
                onPress={end}
                icon={<SquareIcon size={16} />}
              />
            </>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

/**
 * The map, with the one badge the platform can honestly fill.
 *
 * Where the mockup put three lines — minutes, kilometres and a clock time —
 * this puts two, and neither is derived from the other. `PickupMap` owns the
 * MapLibre document and the no-coordinates case; a trip keyed in at the desk
 * has no pins at all, and every fact on this screen stays legible without one.
 */
function MapPanel({
  trip,
  here,
  driving,
  route,
}: {
  trip: Trip;
  here: Coordinates | null;
  driving: number | null;
  route: TripRoute | null;
}) {
  const pickup = located(trip.pickup) ? toCoordinates(trip.pickup) : null;
  const dropoff = located(trip.dropoff) ? toCoordinates(trip.dropoff) : null;

  // The road when there is one, the crow's flight when there is not — and the
  // caption below changes with it, because the two are different claims.
  const remaining =
    route !== null
      ? formatKilometres(route.distance_km)
      : here === null || dropoff === null
        ? null
        : formatKilometres(greatCircleKm(here, dropoff));

  // `PickupMap` draws a map only when there is a pickup pin, and renders a
  // short explanatory panel otherwise. The badge floats *over* a map and must
  // not float over that panel — on a real handset it landed on top of the
  // sentence and cut it in half. Found on a device, not in a test.
  const mapped = pickup !== null;

  return (
    <View>
      <PickupMap
        pickup={pickup}
        dropoff={dropoff}
        here={here}
        boarded
        routePolyline={route?.polyline ?? null}
      />

      <View
        style={mapped ? styles.badge : styles.badgeInline}
        accessible
        accessibilityLabel={
          `${remaining === null ? 'Distance to the drop-off is not available.' : `${remaining} to the drop-off, straight line.`} ` +
          durationAnnouncement(driving)
        }
      >
        <Text style={styles.badgeValue}>{remaining ?? NO_VALUE}</Text>
        {/*
          Said on the badge, not only in a docblock. A bare "4.6 km" beside a
          map reads as road distance, and a driver who plans on it arrives
          late — the crow's flight under-reads every time.
        */}
        <Text style={styles.badgeCaption}>{route === null ? 'straight line' : 'by road'}</Text>

        <View style={styles.badgeRule} />

        <Text style={styles.badgeValue}>
          {driving === null ? NO_VALUE : formatTripDuration(driving)}
        </Text>
        {/* "elapsed", not "driving": this is wall-clock from `trip_started`
            and includes every pause, so on a held trip the two differ by
            exactly the time the passenger is being charged for. */}
        <Text style={styles.badgeCaption}>elapsed</Text>
      </View>
    </View>
  );
}

/**
 * Two facts: what the job is worth, and how it settles.
 *
 * The fare is the *estimate* while the trip runs — `fare` stays null until
 * `WalkInFareService::settle()` runs at completion, and a quote and a bill are
 * different claims (ADR-0026 §2). `is_estimate` travels in both payloads so
 * nothing here has to infer which figure it holds.
 *
 * The mockup's third cell was "1.6 km", which is the distance still to go and
 * is already on the badge above, where it belongs — it is the figure that
 * changes, and repeating it here would be one fact twice.
 */
function Facts({ trip }: { trip: Trip }) {
  const settled = trip.fare;
  const estimate = trip.estimated_fare;
  const money = settled ?? estimate;

  return (
    <StatRow>
      {[
        <Stat
          key="fare"
          icon={<WalletIcon {...GLYPH} />}
          label={settled === null ? estimatedFareLabel : 'Fare'}
          value={
            money === null || money.currency === null
              ? null
              : formatMoney(money.total_minor, money.currency)
          }
          emphasis
        />,
        <Stat
          key="payment"
          icon={<BanknoteIcon {...GLYPH} />}
          label="Payment"
          value={tripPaymentLabel(trip.payment)}
        />,
        <Stat
          key="journey"
          icon={<RouteIcon {...GLYPH} />}
          label="Journey"
          value={
            located(trip.pickup) && located(trip.dropoff)
              ? formatKilometres(
                  greatCircleKm(toCoordinates(trip.pickup), toCoordinates(trip.dropoff)),
                )
              : null
          }
        />,
      ]}
    </StatRow>
  );
}

/**
 * A clock that ticks once a second for as long as the screen is mounted.
 *
 * The same shape as `WaitingForPassengerScreen`'s, including the decision not
 * to gate it on the timeline having arrived: gating froze `now` at mount, so
 * the first render after the events request landed computed elapsed time
 * against a stale clock and read low. One 1 Hz timer on a mounted screen costs
 * nothing measurable; a wrong reading costs the figure its point.
 */
function useTicker(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, []);

  return now;
}

const styles = StyleSheet.create({
  loading: {
    ...typography.body,
    color: colors.textMuted,
    padding: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.sm,
  },
  headerText: {
    flex: 1,
  },
  title: {
    ...typography.heading,
    color: colors.primaryText,
  },
  status: {
    ...typography.caption,
    color: colors.textMuted,
  },
  body: {
    padding: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  badge: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    // A hairline rather than a shadow: the map beneath is pale and a drop
    // shadow on a light-on-light panel reads as a smudge on a phone in sun.
    borderWidth: 1,
    borderColor: colors.border,
  },
  /**
   * The same panel when there is no map to float over: in the flow, full
   * width, and reading as a row of two facts rather than as a card that has
   * come loose from something.
   */
  badgeInline: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeValue: {
    ...typography.bodyStrong,
    color: colors.primaryText,
    // Tabular figures, or the seconds re-centre the whole badge every tick.
    fontVariant: ['tabular-nums'],
  },
  badgeCaption: {
    ...typography.caption,
    color: colors.textMuted,
  },
  badgeRule: {
    height: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  call: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryCta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navigate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm + 2,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTint,
  },
  navigateLabel: {
    ...typography.captionStrong,
    color: colors.primaryText,
  },
  actions: {
    gap: spacing.sm,
  },
});
