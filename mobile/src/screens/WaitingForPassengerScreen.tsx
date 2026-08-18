import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Trip } from '../api/types';
import type { TripsStackParams } from '../navigation/types';
import { dialPassenger } from '../trips/contact';
import { PickupMap } from '../trips/PickupMap';
import { located, toCoordinates } from '../trips/places';
import { useTrip, useTripEvents } from '../trips/queries';
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
 */
export function WaitingForPassengerScreen({ route, navigation }: Props) {
  const { tripId } = route.params;
  const { data: trip, isLoading } = useTrip(tripId);
  const { data: events } = useTripEvents(tripId);

  const arrivedAt = arrivedAtFrom(events);
  const now = useTicker();

  if (isLoading && trip === undefined) {
    return (
      <Screen>
        <SyncBanner />
        <SkeletonCards count={1} style={styles.loading} />
      </Screen>
    );
  }

  if (trip === undefined) {
    return (
      <Screen>
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
   * The one move the driver has from here: open the opening reading.
   *
   * **This press commits nothing, and that is a change.** It used to queue
   * `passenger_onboard` first, on the reasoning that boarding and starting are
   * one act in the car. The act is one; the *commit* was two, and the split
   * cost more than it bought:
   *
   * - A driver who opened the form and backed out — wrong passenger, a
   *   dashboard they could not read yet — left the trip committed at
   *   `passenger_onboard`, a state whose only screen is that same form
   *   (`activeTripRoute`). There was no way back to here.
   * - The reading is required by the server for `trip_started`
   *   (`TransitionTripRequest`), so the first transition could be queued and
   *   the second abandoned, leaving a boarded trip that never started.
   *
   * `OdometerScreen` now queues both from its single submit, in the same
   * per-trip stream and the same order (ADR-0023 §5), so the server sees no
   * difference and the driver commits once. `from` is this trip's real status
   * rather than the one that used to be queued ahead of it — the odometer
   * reads it to decide whether boarding still needs posting.
   */
  const start = () => {
    navigation.navigate('Odometer', {
      tripId: trip.id,
      to: 'trip_started',
      from: trip.status,
    });
  };

  return (
    <Screen>
      <SyncBanner />

      <ScreenHeader
        title="Waiting for Passenger"
        subtitle={statusLabel(trip.status)}
        onBack={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
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
              // **The "if" is not padding.** Nothing notifies the passenger
              // (see the module docblock); their ride screen shows this only
              // while it is open. Dropping the qualifier turns the one honest
              // line on this screen into a promise the platform cannot keep.
              : "Shown on the passenger's screen, if it is open."}
          </Text>
        </View>

        <MapPanel trip={trip} />

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

        <View style={styles.actions}>
          <Button label="Start Trip" tone="primary" onPress={start} />
        </View>
      </ScrollView>
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
 */
function MapPanel({ trip }: { trip: Trip }) {
  const pickup = located(trip.pickup) ? toCoordinates(trip.pickup) : null;
  const dropoff = located(trip.dropoff) ? toCoordinates(trip.dropoff) : null;

  return <PickupMap pickup={pickup} dropoff={dropoff} here={null} />;
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
});
