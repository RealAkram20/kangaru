import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { Trip } from '../api/types';
import type { TripsStackParams } from '../navigation/types';
import { useSync } from '../offline/SyncProvider';
import { dialPassenger } from '../trips/contact';
import { useOdometerEnabled } from '../trips/odometerSetting';
import { validateOdometerReading } from '../trips/odometer';
import { OdometerCapture } from '../trips/OdometerCapture';
import { PickupMap } from '../trips/PickupMap';
import { located, toCoordinates } from '../trips/places';
import { useHandover } from '../trips/handover';
import { useTrip, useTripEvents, useTripRoute } from '../trips/queries';
import { statusLabel } from '../trips/transitions';
import {
  arrivedAtFrom,
  elapsedSeconds,
  fillFraction,
  formatElapsed,
  NO_VALUE,
  waitingAnnouncement,
} from '../trips/waiting';
import { WaitingRing } from '../trips/WaitingRing';
import { Button, Notice, Screen, ScreenHeader } from '../ui/components';
import { Handover } from '../ui/Handover';
import { SkeletonCards } from '../ui/Skeleton';
import { DetailRow, GLYPH } from '../ui/facts';
import { MapPinIcon, NavigationIcon, PhoneIcon, UserIcon } from '../ui/icons';
import { SyncBanner } from '../ui/SyncBanner';
import { colors, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<TripsStackParams, 'WaitingForPassenger'>;

/** Matches `PickupScreen` — `DirectContactChannel` returns this as the label. */
const PASSENGER_LABEL = 'Passenger';

/**
 * The wait at the kerb: `driver_arrived`, until somebody gets in the car.
 *
 * The seam with `PickupScreen` is the driver's own "I've arrived" press —
 * `isPickupPhase` ends where `isWaitingForPassenger` begins, and
 * `docs/agent-worklog.md` holds the one map of status to screen. That screen
 * is about *getting there*; this one is about *standing there*, which is a
 * different problem with a different unknown: not "where is it" but "how long
 * have I been here, and is this still happening".
 *
 * ## Five things the mockup drew that are not here
 *
 * Each was raised before any code was written, and each is a rule rather than
 * a preference. `PickupScreen` reached the first three independently, which is
 * worth noting — two agents reading the same ADRs refused the same elements.
 *
 * - **No rating beside the passenger's name.** ADR-0030's ratings run the
 *   other way: the *customer* rates the *driver*, once, after the trip, and
 *   even that is withheld below five of them. "Driver rates the passenger too"
 *   is listed there as out of scope. A star here would invert the meaning the
 *   platform has just assigned to that glyph.
 * - **No avatar.** `ContactDetails` is `{name, phone, label}` and customers
 *   have no photograph anywhere in the schema. A stock face is worse than
 *   none: it misidentifies the person a driver is scanning a kerb for.
 * - **No Chat button.** There is no messaging in this platform — no table, no
 *   endpoint, no screen. `trips/contact.ts` explains why there is deliberately
 *   not even an SMS fallback.
 * - **No Cancel Trip button.** `TripPolicy::DRIVER_JOURNEY_STATES` withholds
 *   both `cancelled` and `no_show` from a driver, so the mockup's red button
 *   was a 403 on every press. `transitions.ts` names this exact trap: serving
 *   `allowed_transitions` verbatim "would put a button on the screen whose
 *   only outcome is a refusal". A driver-reported no-show is the honest
 *   feature and needs its own ADR; today they ring the office.
 * - **"Passenger notified that you've arrived" is not true.** Nothing notifies
 *   them. The only push this platform sends about a trip is
 *   `TripOfferedNotification`, to drivers. The customer's ride screen shows
 *   `driver_arrived` only while it is open and polling, so the line below says
 *   that instead — a driver who believes a passenger was buzzed will wait in
 *   silence rather than ring them.
 *
 * ## The clock is measured; the ring's ceiling is a setting
 *
 * The figure is real: the moment of arrival is the `driver_arrived` row in
 * `trip_events`, the same append-only timeline billing derives waiting charges
 * from (AGENTS.md: "never from a mutable column"). Counting from a local
 * timestamp taken on mount was the alternative, and it restarts at zero every
 * time the driver backgrounds the app to make a call — on the one screen whose
 * whole job is saying how long they have been there.
 *
 * The *arc* is the compromise. A filling arc is a fraction of something, and
 * this platform bounds nothing at the kerb, so the denominator is
 * `dispatch.pickup_wait_target_seconds` — served, documented in three places
 * as having no consequence, and drawn so that it cannot read as a deadline:
 * it completes and holds while the figure keeps counting. See
 * `trips/waiting.ts`.
 *
 * ## The opening reading is taken here, and one press starts the trip
 *
 * The owner's ruling, from a handset at 02:00 with a passenger beside them:
 * *"we want to limit the clicks … when we onboard the client it automatically
 * starts the trip"*. Before this the kerb was: press "Start Trip", land on a
 * separate odometer form, type, press "Record and start trip" — two screens
 * and two presses for one act, on the one moment a driver's hands are busiest.
 *
 * Now the reading is typed *while waiting* — the driver has time here and
 * nothing else to do with it — and the single button below, "Passenger on
 * board", queues boarding and the start together, in one per-trip stream and
 * in order (ADR-0023 §5). The server sees exactly the sequence it always saw;
 * the driver commits once. Nothing is committed until that press, so backing
 * out leaves the trip here, at `driver_arrived`, not stranded at
 * `passenger_onboard` with no screen but a form.
 *
 * The reading is still **required** before the button enables — the server
 * demands it for `trip_started` (`TransitionTripRequest`), and the owner's
 * ruling on the billing algorithm makes the odometer a *backup witness*, not a
 * gate to remove: it enters the arithmetic only when the GPS trace cannot be
 * trusted (`docs/measured-distance-plan.md`). What was removed is the second
 * screen, not the number.
 */
export function WaitingForPassengerScreen({ route, navigation }: Props) {
  const { tripId } = route.params;
  const { data: trip, isLoading } = useTrip(tripId);
  const { data: events } = useTripEvents(tripId);
  const { queueTransition, queued } = useSync();
  // The fare itself, pickup to drop-off, as a road (ADR-0031) — the same line
  // the passenger is looking at on their own screen. No `here`: the driver is
  // at the pickup, and the server routes from it when given no fix.
  const { data: fareRoute, isLoading: routing } = useTripRoute(tripId, null);

  const arrivedAt = arrivedAtFrom(events);
  const now = useTicker();

  const odometerEnabled = useOdometerEnabled();
  const [reading, setReading] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  // No opening reading to compare against — this *is* the opening reading —
  // so only the "is it a number" rule applies here; the ceiling bites at the
  // closing one.
  const readingError = validateOdometerReading(reading, null, null);

  /*
    The other seam, and the one the owner described as the switch: *"when i
    alive we then switch to his or her route by her order"*. Arriving is
    exactly where the map stops answering "how do I reach them" and starts
    answering "where are we going" — a different road, from a different
    endpoint — and this says so while that road is being fetched.

    One step, not two. The trip is already on this phone by the time a driver
    arrives at a kerb, so the connecting line would be a sentence about work
    that is not happening; `Handover` draws a single bar and it reads as *this
    is the only thing left*, which is true.

    Same `isLoading` reasoning as `PickupScreen`, and the same ceiling: this
    screen carries the waiting clock the passenger is being charged against
    (ADR-0026), and nothing may hold that behind a road.
  */
  const handover = useHandover([{ label: "Switching to the passenger's route", pending: routing }]);

  if (handover.visible && handover.label !== null) {
    return (
      <Screen>
        {/*
          The header even here: it carries the status-bar inset, and without it
          the words paint under the clock. The back arrow keeps working too.
        */}
        <ScreenHeader
          title="Waiting for Passenger"
          subtitle={null}
          onBack={() => navigation.goBack()}
        />
        <SyncBanner />
        <Handover
          label={handover.label}
          caption={trip?.dropoff.label ?? null}
          step={handover.step}
          total={handover.total}
        />
      </Screen>
    );
  }

  if (isLoading && trip === undefined) {
    return (
      <Screen>
        {/*
          The header even while loading: it is what carries the status-bar
          inset, and without it the banner — or the skeleton — paints under the
          clock. The back arrow also works during the wait, which matters when
          the office is unreachable and this screen cannot finish arriving.
        */}
        <ScreenHeader
          title="Waiting for Passenger"
          subtitle={null}
          onBack={() => navigation.goBack()}
        />
        <SyncBanner />
        <SkeletonCards count={1} style={styles.loading} />
      </Screen>
    );
  }

  if (trip === undefined) {
    return (
      <Screen>
        {/*
          The header even while loading: it is what carries the status-bar
          inset, and without it the banner — or the skeleton — paints under the
          clock. The back arrow also works during the wait, which matters when
          the office is unreachable and this screen cannot finish arriving.
        */}
        <ScreenHeader
          title="Waiting for Passenger"
          subtitle={null}
          onBack={() => navigation.goBack()}
        />
        <SyncBanner />
        <Notice message="This trip is not on this phone, and the office is unreachable." />
      </Screen>
    );
  }

  const passenger = trip.passenger_contact;

  // Bound to a local so the guard still narrows inside the press handler below
  // — TypeScript cannot prove a property is unchanged by the time a callback
  // runs, and it is right not to.
  const pickupPoint = located(trip.pickup) ? toCoordinates(trip.pickup) : null;

  const waited = arrivedAt === null ? null : elapsedSeconds(arrivedAt, now);
  const figure = waited === null ? NO_VALUE : formatElapsed(waited);
  const fraction = waited === null ? 0 : fillFraction(waited, trip.pickup_wait_target_seconds);

  /**
   * The one move the driver has from here: the passenger gets in, the trip
   * starts.
   *
   * **Boarding and the start are queued together, from this press.**
   * `driver_arrived -> trip_started` is not a legal edge (`TripStatus::
   * allowedTransitions`), so `passenger_onboard` is posted in between — but
   * from the same press as the start, never before it. Posting it on its own
   * used to commit the trip to a state whose only screen was the odometer
   * form, with no way back here; and since the server requires the reading
   * for `trip_started`, the first transition could be queued and the second
   * abandoned, leaving a boarded trip that never started. Both land in the
   * same per-trip stream and drain strictly in order (ADR-0023 §5).
   *
   * `replace`, not `navigate`: this screen must not sit in the stack behind
   * the trip in progress, or the back gesture reopens a kerb the driver has
   * already left — and, in a dead zone, a screen byte-identical to this one
   * whose only button would queue a second boarding the server refuses.
   */
  const board = async () => {
    // Only meaningful while a reading is being asked for. With the odometer
    // off `reading` is the empty string it was initialised to, and
    // `validateOdometerReading` rightly objects to that — so leaving this
    // guard unconditional would make the button dead on exactly the
    // deployments that removed the field (ADR-0047).
    if (odometerEnabled && readingError !== undefined) {
      return;
    }

    setBusy(true);
    setSaveFailed(false);

    try {
      await queueTransition({ tripId, from: 'driver_arrived', to: 'passenger_onboard' });
      await queueTransition({
        tripId,
        from: 'passenger_onboard',
        to: 'trip_started',
        // **Omitted, not sent as null or zero, when no reading was taken.**
        // `Number.parseInt('', 10)` is `NaN`, which serialises to `null` and
        // reaches a server that would accept it as a real reading of nothing.
        // The trip would then start with an opening of 0 and, if the setting
        // were ever switched back on mid-journey, complete with a distance
        // equal to the whole vehicle's lifetime mileage.
        ...(odometerEnabled
          ? { odometerStart: Number.parseInt(reading, 10), photoUri }
          : {}),
      });
    } catch {
      // The queue could not accept it — the database is not open yet, or the
      // write failed. The one thing that must not happen is navigating away as
      // though it were saved: the reading stays on screen so the driver can
      // try again or write it down.
      setBusy(false);
      setSaveFailed(true);

      return;
    }

    setBusy(false);
    navigation.replace('TripInProgress', { tripId });
  };

  return (
    <Screen>
      <ScreenHeader
        title="Waiting for Passenger"
        /*
          The status the driver asked for, falling back to the one the office
          confirmed — never the confirmed one alone. This screen is reached by
          queueing `driver_arrived` and replacing the pickup screen, so in a
          dead zone the header read **"Waiting for Passenger" over "On the
          way"**: a title and a subtitle contradicting each other, on the
          owner's handset, with "Sending 1 update…" between them.

          `queued` is the outbox's own contents rather than an optimistic
          guess — the argument `SyncState.queued` makes at length — so this
          shows what the driver actually pressed, and falls back the moment an
          item is refused.
        */
        subtitle={statusLabel(queued.get(trip.id) ?? trip.status)}
        onBack={() => navigation.goBack()}
      />

      {/*
        Below the header, which carries the status-bar inset: mounted first,
        the banner's text paints under the clock and the battery — the owner's
        screenshot, and the same bug HomeScreen's own comment records.
      */}
      <SyncBanner />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/*
          One announcement for the whole waiting state, composed rather than
          left to linearise. The ring hides its own subtree from the screen
          reader so this is not interrupted by a bare number every second.
        */}
          <View style={styles.clock} accessible accessibilityLabel={waitingAnnouncement(waited)}>
            <WaitingRing seconds={waited} fraction={fraction} label={figure} />

            <Text style={styles.blurb}>
              {waited === null
                ? 'Waiting time shows once your arrival reaches the office.'
                : // **The "if" is not padding.** Nothing notifies the passenger
                  // (see the module docblock); their ride screen shows this only
                  // while it is open. Dropping the qualifier turns the one honest
                  // line on this screen into a promise the platform cannot keep.
                  "Shown on the passenger's screen, if it is open."}
            </Text>
          </View>

          <MapPanel trip={trip} routePolyline={fareRoute?.polyline ?? null} />

          {passenger !== null && (
            <DetailRow
              icon={<UserIcon {...GLYPH} />}
              label={PASSENGER_LABEL}
              value={passenger.name}
              // Only when the channel says something the label does not.
              // `DirectContactChannel` returns "Passenger" today, which would
              // print the word twice; under the masking provider ADR-0024 §7
              // designs for it becomes "Passenger (via KangaruRide)", and that a
              // driver must see — or they save a proxy number to their contacts
              // and ring it next week. Same rule as `PickupScreen`.
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
            icon={<MapPinIcon {...GLYPH} />}
            label="Pickup"
            value={trip.pickup.label}
            caption={null}
            // Present only when there are coordinates to hand over, which is the
            // same rule the call button follows: a trip keyed in at the desk has
            // none, and every corporate trip has none. A Navigate button that
            // opened a maps app on nothing — or worse, on 0°,0° in the Atlantic
            // — is the failure `located()` exists to prevent.
            trailing={
              pickupPoint !== null ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Navigate to ${trip.pickup.label}`}
                  onPress={() => navigation.navigate('TripMap', { tripId: trip.id })}
                  style={styles.navigate}
                >
                  <NavigationIcon color={colors.primaryText} size={18} strokeWidth={2} />
                  <Text style={styles.navigateLabel}>Navigate</Text>
                </Pressable>
              ) : null
            }
          />

          {/*
          The opening reading, typed while there is time to type it. See the
          module docblock — this is what took the second screen out of the
          kerb. The heading names the reading for what it is, so a driver does
          not mistake it for the closing one.
        */}
          {saveFailed && (
            <Notice tone="danger" message="Could not save. Try again, and write the number down." />
          )}

          {/*
            **Gone entirely when the office has switched the odometer off**
            (ADR-0047), heading included. Leaving a disabled or optional field
            here would be worse than either state: the driver reads a labelled
            input as something the office wants, and an empty one they were
            allowed to skip is a field that looks like it failed to save.
          */}
          {odometerEnabled && (
            <>
              <Text style={styles.sectionTitle}>Opening odometer</Text>

              <OdometerCapture
                reading={reading}
                onChangeReading={setReading}
                error={readingError}
                photoUri={photoUri}
                onChangePhoto={setPhotoUri}
              />
            </>
          )}

          <View style={styles.actions}>
            <Button
              // One label for one act. "Start Trip" opened a form whose own
              // button said "Record and start trip" — the same words twice, a
              // press apart, which read as one press that did not work.
              label="Passenger on board"
              tone="primary"
              busy={busy}
              // With no reading asked for there is nothing to withhold the
              // press on — gating on an empty field the driver was never
              // shown would be a button that never enables.
              disabled={odometerEnabled && (reading === '' || readingError !== undefined)}
              onPress={() => void board()}
            />
            {/*
            ADR-0023 queues this rather than sending it. A driver who does not
            know that will sit in a dead zone waiting for a confirmation that
            is not coming.
          */}
            <Text style={styles.footnote}>Saved on this phone, sent when you have signal.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/**
 * Where the pickup is, when the platform knows.
 *
 * The shared `PickupMap`, which owns the MapLibre document and the
 * no-coordinates case. No distance badge and no current position, unlike
 * `PickupScreen`: the driver is *at* the pickup, so "4.6 km away" is either
 * wrong or zero, and a second GPS read to say "0.0 km" would spend battery to
 * state the obvious.
 *
 * The dropoff is passed so the map can frame both. A driver waiting at a kerb
 * glancing at where the job goes is orienting themselves for the drive out.
 *
 * `leg="fare"` and stated rather than left to the default: this is the screen
 * where the map hands over from the drive to the passenger to the passenger's
 * own journey, and that handover should be legible in the call, not inherited.
 */
function MapPanel({ trip, routePolyline }: { trip: Trip; routePolyline: string | null }) {
  const pickup = located(trip.pickup) ? toCoordinates(trip.pickup) : null;
  const dropoff = located(trip.dropoff) ? toCoordinates(trip.dropoff) : null;

  return (
    <PickupMap
      pickup={pickup}
      dropoff={dropoff}
      here={null}
      leg="fare"
      routePolyline={routePolyline}
    />
  );
}

/**
 * A clock that ticks once a second for as long as the screen is mounted.
 *
 * `setInterval` rather than an animation frame loop: the figure changes once
 * per second and the ring steps with it, so sixty callbacks a second would
 * produce fifty-nine identical renders. This screen is left open for minutes
 * at a time in a cradle, which is exactly where that waste would be paid.
 *
 * **It runs even before the arrival time is known**, which looks like waste
 * and is the cheaper of the two options. Gating it on the timeline having
 * arrived was the first version: it saved a re-render of a static em dash, and
 * it bought a real bug. `now` would then be frozen at mount until the first
 * tick *after* activation, so a screen whose events request took three seconds
 * would compute its first elapsed figure against a three-second-old clock and
 * read low — briefly, on the one number this screen exists to state. One timer
 * on a mounted screen costs nothing measurable; a wrong reading costs the
 * screen its point.
 *
 * The first tick lands up to a second late, which is left alone: aligning to
 * the true second boundary needs a second timer to find it, and being a
 * fraction of a second out on a figure nobody bills from is not worth the bug
 * surface.
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
    // Was a Text style for the word "Loading…"; the placeholder that
    // replaced it wants the gutter and nothing else.
    padding: spacing.md,
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
  clock: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  blurb: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
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
    // 44pt tall, which is the platform floor rather than this app's 52 — it is
    // a secondary control beside a row of text, and a mis-tap on it opens a
    // maps app rather than posting a state transition. `Start Trip` below is
    // the one that moves the lifecycle, and it takes the full height.
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
  flex: { flex: 1 },
  sectionTitle: {
    ...typography.label,
    color: colors.text,
    marginTop: spacing.xs,
  },
  footnote: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 20,
  },
});
