import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Coordinates, Trip } from '../api/types';
import { estimatedFareLabel, formatKilometres, formatMoney } from '../duty/offerPresentation';
import type { TripsStackParams } from '../navigation/types';
import { usePosition } from '../location/usePosition';
import { useSync } from '../offline/SyncProvider';
import { dialPassenger } from '../trips/contact';
import { PickupMap } from '../trips/PickupMap';
import { greatCircleKm, located, toCoordinates } from '../trips/places';
import { useHandover } from '../trips/handover';
import { useTrip, useTripRoute } from '../trips/queries';
import { useOdometerEnabled } from '../trips/odometerSetting';
import { driverActions, statusLabel, type TripAction } from '../trips/transitions';
import { Button, Notice, Screen, ScreenHeader } from '../ui/components';
import { Handover } from '../ui/Handover';
import { DetailRow, GLYPH, RouteRail, Stat, StatRow } from '../ui/facts';
import { NavigationIcon, PhoneIcon, RouteIcon, UserIcon, WalletIcon } from '../ui/icons';
import { SyncBanner } from '../ui/SyncBanner';
import { colors, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<TripsStackParams, 'Pickup'>;

/**
 * What the contact row is called, and the value its caption is compared
 * against so the same word does not print twice.
 */
const PASSENGER_LABEL = 'Passenger';

/**
 * The drive to the passenger (ADR-0024 §7).
 *
 * The other half of `OfferScreen`, on the far side of the accept, and the
 * difference between the two is the point: before the accept a driver is
 * deciding, and after it they are *going somewhere and meeting somebody*. So
 * this screen has a map and a phone number, and the offer screen has neither.
 *
 * ## What the accept released, and what it did not
 *
 * **The passenger's name and number.** ADR-0024 §7 opens both from `accepted`
 * through `trip_completed`, to the assigned driver alone — the server decides
 * (`TripResource::passengerContactFor`) and this screen renders the block when
 * the field is present and simply does not when it is absent. There is no rule
 * duplicated here.
 *
 * **Nothing else.** No photograph, no star rating, no "Regular" badge. The
 * platform has no passenger rating and no loyalty tier, and ADR-0030 — which
 * did add ratings — runs the other way: the *customer* rates the *driver*,
 * once, after the trip, and even that score is withheld below five ratings.
 * Putting a star beside a passenger's name would invert the meaning the
 * platform has just assigned to that glyph.
 *
 * ## No ETA, on a screen that is about to be late
 *
 * ADR-0020 §3 refused to derive minutes from a straight line by name, and this
 * is the screen where the temptation is strongest: a driver on the way to a
 * pickup wants to know how long. ADR-0031 §6 keeps that refusal even now there
 * is a routing engine — a duration is shown only when a provider *sent* one,
 * never computed here. So the map overlay and the facts row both show
 * **distance, said to be straight-line**, and the driver's own maps app is one
 * tap away for the turn-by-turn we do not attempt.
 *
 * ## The map draws one leg: the way to the passenger
 *
 * The approach route (ADR-0031), from where the driver actually is to the
 * pickup, refetched as they close in. The drop-off is on the map as a pin and
 * nothing more — **the passenger's own journey is not this screen's line.**
 * Drawing it here, which is what happened whenever there was no route and no
 * fix, answers a question the driver is not yet asking and puts a road on
 * screen that starts somewhere they are not. `PickupMap`'s `leg` prop is where
 * that rule now lives.
 *
 * Where routing cannot reach — no signal, no fix, no pins — the line is dashed
 * or absent, never invented: a straight line is not a road. `PickupMap`
 * carries the rest of that argument, including why it is MapLibre in a WebView
 * rather than the native map a mockup implies: `react-native-maps` needs a
 * Google billing account to draw a street.
 *
 * The map is also allowed to be absent — a trip keyed in over the phone has no
 * coordinates at all. **Every fact on this screen is legible without it**,
 * which is why the addresses are on a rail below rather than only in a
 * callout, and why the distance is in the facts row as well as on the badge.
 */
export function PickupScreen({ route, navigation }: Props) {
  const { tripId } = route.params;
  const { data: trip, isLoading } = useTrip(tripId);
  const { queueTransition, queued } = useSync();
  // ADR-0047. Drives whether "Start trip" opens the reading form or
  // simply starts the trip.
  const odometerEnabled = useOdometerEnabled();

  /*
    Watched, not a single fix. This screen took one reading on mount, back
    when `here` fed only the "to pickup" figure and a number that ticked while
    the driver was looking at the road was motion for its own sake.

    ADR-0031 changed what the reading is *for*. It is now the origin of the
    approach route, and `useTripRoute` refetches on a changed position — so a
    frozen fix meant the road was drawn from the kerb the driver set off from
    and never redrawn, however far they got. The "You" pin stayed there too.
    A route to the passenger that does not follow the driver is the thing this
    screen exists to provide, not provided.

    The tick the original comment worried about is bounded by the same 100 m
    the figure is rendered to, so the number moves by 0.1 km at a time — real
    progress toward the passenger rather than GPS jitter.
  */
  const here = usePosition({ watch: true });

  /*
    The road to the pickup (ADR-0031), from where the driver is. The approach
    leg: this endpoint used to route only to the drop-off, so this screen kept
    a dashed guess while the trip in progress got a road — the owner, from a
    handset: "we all know that the trip can not be a straight line". Null
    whenever routing is off, there is no fix yet, or the order has no pin;
    `PickupMap` draws the dashed line it always drew.
  */
  const { data: approach, isLoading: routing } = useTripRoute(tripId, here, 'pickup');

  const [busy, setBusy] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  /*
    The moment between accepting and driving — the owner's *"connecting to the
    client, finding the best route"*.

    Both lines are bound to a request actually in flight, which is what keeps
    this clear of `docs/screen-rules.md` §1 and §5 at once: a driver on their
    twentieth job has both answers cached and never sees this at all.
    `useHandover` owns that argument, the delay that makes it true, and the
    ceiling that stops a slow route holding the screen.

    `isLoading` rather than `isPending` in both cases, deliberately: React
    Query leaves a request *pending* while it is paused for want of a network,
    and a hand-over that waits on a paused request would sit there until the
    driver found signal. `isLoading` is pending **and fetching**, which is the
    only state worth reporting.
  */
  const handover = useHandover([
    { label: 'Connecting to the passenger', pending: isLoading && trip === undefined },
    { label: 'Finding the road to the pickup', pending: routing },
  ]);

  if (handover.visible && handover.label !== null) {
    return (
      <Screen>
        {/*
          The header stays. It carries the status-bar inset — without it the
          hand-over's own words paint under the clock, which is the bug this
          screen's skeleton branch already recorded — and the back arrow keeps
          working, so a driver is never held by a moment they did not ask for.
        */}
        <ScreenHeader title="Pickup passenger" subtitle={null} onBack={() => navigation.goBack()} />
        <SyncBanner />
        <Handover
          label={handover.label}
          // The pickup, once the trip has landed. Null on the opening step
          // because the platform genuinely does not know yet — ADR-0024 §7
          // releases the passenger's details on the accept, and this surface
          // is often on screen precisely because that fetch is in flight.
          caption={trip?.pickup.label ?? null}
          step={handover.step}
          total={handover.total}
        />
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
        <ScreenHeader title="Pickup passenger" subtitle={null} onBack={() => navigation.goBack()} />
        <SyncBanner />
        <Notice message="This trip is not on this phone, and the office is unreachable." />
      </Screen>
    );
  }

  const passenger = trip.passenger_contact;
  const actions = driverActions(trip, { odometerEnabled });

  // What this trip has been asked to become and has not yet been confirmed at.
  // Read off the outbox — see `SyncState.queued`, and the block above the
  // actions for what it prevents.
  const asked = queued.get(trip.id) ?? null;

  const run = async (action: TripAction) => {
    // A reading goes to the screen built for readings. This branch is only
    // reachable when the trip is already `passenger_onboard` on this screen —
    // a resume after a kill, or a boarding queued from here — and it used to
    // hand the driver to `TripDetail` instead: the record view, mostly em
    // dashes this early, with one button on it that asked for the same press
    // again. Two screens of detour between "Start trip" and the form the
    // server requires. The odometer replaces itself with `TripInProgress`
    // when the reading lands, so this is now one tap from the journey.
    if (action.requires === 'odometer_start' || action.requires === 'odometer_end') {
      navigation.navigate('Odometer', {
        tripId: trip.id,
        to: action.to as 'trip_started' | 'trip_completed',
        from: trip.status,
      });

      return;
    }

    // A decline needs written notes, and `TripDetail` owns that sheet. The
    // one remaining handoff to the record view from here, and the right one:
    // declining is stepping out of the journey, not a step of it.
    if (action.requires !== null) {
      navigation.navigate('TripDetail', { tripId: trip.id });

      return;
    }

    setBusy(true);
    setSaveFailed(false);

    // The `try/finally` is load-bearing, not defensive dressing. The caller
    // is `void run(action)`, so a `queueTransition` that throws — the outbox's
    // SQLite refused to open, the enqueue itself failed — used to escape
    // between `setBusy(true)` and `setBusy(false)`: every button on this
    // screen stayed spinning for the rest of the session and the error was
    // swallowed whole. `WaitingForPassengerScreen` had this right first.
    try {
      // Queued, not posted. A pickup happens in a stairwell, a basement car
      // park, a street with no signal — `SyncProvider` holds the transition and
      // sends it when there is a network (ADR-0023), and `SyncBanner` says so.
      await queueTransition({ tripId: trip.id, from: trip.status, to: action.to });
    } catch {
      setSaveFailed(true);

      return;
    } finally {
      setBusy(false);
    }

    // "I've arrived" is the seam between the drive and the wait —
    // `isPickupPhase` says so in as many words — so the press that ends the
    // drive opens the waiting screen, where boarding, the opening reading and
    // the start are one press. Without this the driver who taps through the
    // leg here never meets that screen: they get "Passenger on board", then
    // "Start trip", then the `TripDetail` detour above. Found on the
    // emulator, reported as "we don't need this blank trip details".
    //
    // `replace`, not `navigate`: the drive must not sit in the stack behind
    // the wait, or the back gesture returns to a kerb-approach screen whose
    // buttons the queue has already outrun.
    if (action.to === 'driver_arrived') {
      navigation.replace('WaitingForPassenger', { tripId: trip.id });
    }
  };

  return (
    <Screen>
      <ScreenHeader
        title="Pickup passenger"
        subtitle={statusLabel(trip.status)}
        onBack={() => navigation.goBack()}
      />

      {/*
        Below the header, which carries the status-bar inset: mounted first,
        the banner's text paints under the clock and the battery — the owner's
        screenshot, and the same bug HomeScreen's own comment records.
      */}
      <SyncBanner />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <MapPanel trip={trip} here={here} routePolyline={approach?.polyline ?? null} />

        {passenger !== null && (
          <DetailRow
            icon={<UserIcon {...GLYPH} />}
            label={PASSENGER_LABEL}
            value={passenger.name}
            // The channel, and only when it says something the label above
            // does not. `DirectContactChannel` returns "Passenger" today,
            // which would print the word twice; under a masking provider it
            // becomes "Passenger (via KangaruRide)", and *that* a driver must
            // see — otherwise they save a proxy number to their contacts and
            // ring it next week. See `ContactDetails`.
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

        <RouteRail pickup={trip.pickup.label} dropoff={trip.dropoff.label} />

        <Facts trip={trip} here={here} />

        {/*
          **A transition already queued is not offered again.**

          `actions` comes from `allowed_transitions`, which the server computed
          for the status it last confirmed — so between the press and the drain
          it still lists the move the driver has already made. On a good
          connection that is a flicker; in the stairwell and the basement car
          park this screen is written for, it is the rest of the leg. A driver
          who presses "On my way" twice queues it twice, and the second posts
          from a status the server has left: refused, parked, and now needing a
          human.

          `queued` is the outbox's own contents rather than an optimistic guess,
          so this cannot show a move the driver did not make, and a refused item
          drops out of it — returning the buttons rather than stranding them.
        */}
        {saveFailed && (
          <Notice tone="danger" message="Could not save that. Try again in a moment." />
        )}

        {asked !== null ? (
          <Notice
            tone="info"
            // The status, plus where the record of it currently is. Same
            // vocabulary as the odometer's footnote, deliberately: a driver
            // meets this sentence on both screens and it means one thing.
            message={`${statusLabel(asked)}. Saved on this phone, sent when you have signal.`}
          />
        ) : actions.length === 0 ? (
          <Notice message="There is nothing for you to do on this trip right now." tone="info" />
        ) : (
          <View style={styles.actions}>
            {actions.map((action, index) => (
              <Button
                key={action.to}
                label={action.label}
                // The server lists the expected path first
                // (`TripStatus::allowedTransitions`), so the first action is
                // the one this screen exists for — "I've arrived" — and it
                // gets the filled button. Ordering is not re-decided here;
                // `driverActions` documents why.
                tone={index === 0 ? 'primary' : 'neutral'}
                busy={busy}
                onPress={() => void run(action)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

/**
 * Where things are, when the platform knows.
 *
 * A thin wrapper over the shared `PickupMap`, which owns the MapLibre
 * document and the no-coordinates case. What lives here is the badge over it:
 * the same straight-line distance the facts row states, put where the mockup
 * puts it, because a driver glancing at the map should not have to look
 * anywhere else to learn how close they are.
 */
function MapPanel({
  trip,
  here,
  routePolyline,
}: {
  trip: Trip;
  here: Coordinates | null;
  routePolyline: string | null;
}) {
  const pickup = located(trip.pickup) ? toCoordinates(trip.pickup) : null;
  const dropoff = located(trip.dropoff) ? toCoordinates(trip.dropoff) : null;

  const away =
    here === null || pickup === null ? null : formatKilometres(greatCircleKm(here, pickup));

  return (
    <View>
      {/*
        `leg="approach"` and not the default. This map answers one question —
        where is the passenger and how do I get to them — and the drop-off is
        on it only as a pin. Left implicit, the map fell through to the fare
        leg whenever there was no route and no fix, and drew the passenger's
        journey on the screen for driving to the passenger.
      */}
      <PickupMap
        pickup={pickup}
        dropoff={dropoff}
        here={here}
        leg="approach"
        // The distance badge below is floated over the map's bottom-left, so
        // the map frames its pins clear of that corner.
        overlay="bottom-left"
        routePolyline={routePolyline}
      />

      {away !== null && (
        <View style={styles.mapBadge}>
          <Text style={styles.mapBadgeValue}>{away}</Text>
          {/*
            Said on the badge, not only in a docblock. A bare "4.6 km" beside
            a map reads as road distance, and a driver who plans on it arrives
            late — the crow's flight under-reads every time.
          */}
          <Text style={styles.mapBadgeCaption}>straight line</Text>
        </View>
      )}
    </View>
  );
}
/**
 * Three facts: how far to the passenger, how far the job runs, what it pays.
 *
 * The mockup's middle cell was an ETA and is a distance instead — see the
 * screen's docblock. The fare cell shows the settled figure once there is one
 * and the estimate before that, labelled differently, because a quote and a
 * bill are different claims (ADR-0026 §2) and `is_estimate` travels in both
 * payloads so nothing has to guess which it holds.
 */
function Facts({ trip, here }: { trip: Trip; here: Coordinates | null }) {
  const pickup = located(trip.pickup) ? toCoordinates(trip.pickup) : null;
  const dropoff = located(trip.dropoff) ? toCoordinates(trip.dropoff) : null;

  const away =
    here === null || pickup === null ? null : formatKilometres(greatCircleKm(here, pickup));
  const journey =
    pickup === null || dropoff === null ? null : formatKilometres(greatCircleKm(pickup, dropoff));

  const settled = trip.fare;
  const estimate = trip.estimated_fare;

  const money = settled ?? estimate;

  return (
    <StatRow>
      {[
        <Stat key="away" icon={<NavigationIcon {...GLYPH} />} label="To pickup" value={away} />,
        <Stat key="journey" icon={<RouteIcon {...GLYPH} />} label="Journey" value={journey} />,
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
      ]}
    </StatRow>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    ...typography.heading,
    color: colors.text,
  },
  status: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  body: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm + 4,
  },
  mapBadge: {
    position: 'absolute',
    left: spacing.sm + 4,
    bottom: spacing.sm + 4,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mapBadgeValue: {
    ...typography.bodyStrong,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  mapBadgeCaption: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
  },
  mapMissing: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSunken,
    padding: spacing.md,
  },
  mapMissingText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  call: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryCta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    gap: spacing.sm + 4,
    marginTop: spacing.xs,
  },
});
