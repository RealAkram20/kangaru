import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Trip, TripEvent, TripRoute } from '../api/types';
import { estimatedFareLabel, formatKilometres, formatMoney } from '../duty/offerPresentation';
import { usePosition, type Fix } from '../location/usePosition';
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
import { useOdometerEnabled } from '../trips/odometerSetting';
import { useTrip, useTripEvents, useTripRoute } from '../trips/queries';
import { StopList } from '../trips/StopList';
import { nextPendingStop, pickupIsLegOrigin } from '../trips/stops';
import { spriteFor } from '../trips/vehicleSprites';
import { statusLabel } from '../trips/transitions';
import { elapsedSeconds, NO_VALUE } from '../trips/waiting';
import { Button, Notice, Screen, ScreenHeader } from '../ui/components';
import { SkeletonCards } from '../ui/Skeleton';
import { DetailRow, GLYPH, Stat, StatRow } from '../ui/facts';
import {
  BanknoteIcon,
  CirclePlusIcon,
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
  const { queueTransition, queued } = useSync();
  // ADR-0047. Decides whether ending the trip opens the reading form or
  // simply completes it.
  const odometerEnabled = useOdometerEnabled();

  const [busy, setBusy] = useState(false);

  // Watching, unlike every other screen in this app. The driver is
  // definitionally moving for this screen's whole life, so a single fix would
  // be wrong within a minute and stay wrong — see `usePosition`.
  const here = usePosition({ watch: true });
  const { data: roadRoute } = useTripRoute(tripId, here);

  /*
    And the whole leg, which is the line the map frames on and draws the
    driven part of. Same request `WaitingForPassengerScreen` makes — no
    origin, so a constant key — which is why this is usually a cache read
    rather than a billed one; the reasoning in full is on `TripMapScreen`.

    Withheld once any stop has been worked: the leg then runs stop to stop
    and no longer starts at the pickup, so the road this returns is not the
    one the driver is on.
  */
  const wholeLegKnown = trip !== undefined && pickupIsLegOrigin(trip.stops ?? []);
  const { data: cachedLeg } = useTripRoute(tripId, null, 'dropoff', wholeLegKnown);

  // Gated where it is *used*, not only where it is asked for — a disabled
  // query still serves whatever its key already holds, and the waiting screen
  // warms this exact key on every job. `TripMapScreen` carries the full story
  // and the figures it produced on a real trip.
  const legRoute = wholeLegKnown ? cachedLeg : undefined;

  const startedAt = startedAtFrom(events, trip?.started_at ?? null);

  if (isLoading && trip === undefined) {
    return (
      <Screen>
        {/*
          The header even while loading: it is what carries the status-bar
          inset, and without it the banner — or the skeleton — paints under the
          clock. The back arrow also works during the wait, which matters when
          the office is unreachable and this screen cannot finish arriving.
        */}
        <ScreenHeader title="Trip in progress" subtitle={null} onBack={() => navigation.goBack()} />
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
        <ScreenHeader title="Trip in progress" subtitle={null} onBack={() => navigation.goBack()} />
        <SyncBanner />
        <Notice message="This trip is not on this phone, and the office is unreachable." />
      </Screen>
    );
  }

  const passenger = trip.passenger_contact;
  const dropoff = located(trip.dropoff) ? toCoordinates(trip.dropoff) : null;

  /*
   * The itinerary, and the stop the run is heading for (ADR-0045).
   *
   * `stops` is undefined on a list payload and empty on every point-to-point
   * trip; both render exactly the screen this always was. `nextStop` is what
   * "the drop-off" *means* mid-circuit — the map, the Navigate button and
   * the drop-off row all read it, so they cannot disagree about where the
   * vehicle is going.
   */
  const stops = trip.stops ?? [];
  const nextStop = nextPendingStop(stops);

  /**
   * The status this trip is heading for, which is not always the one the
   * office has confirmed.
   *
   * `queueTransition` touches no cache and only a completed drain invalidates
   * one, so reading `trip.status` alone meant the pause control did not move
   * when it was pressed — for a moment on a good connection, and **for as long
   * as the dead zone lasts** otherwise. A driver presses again, the second item
   * posts from a status the server has already left, and it parks.
   *
   * `queued` is the outbox's own contents, not a guess: it holds what the
   * driver asked for, it empties when the item goes out, and a refused item
   * leaves it, so this falls back to `trip.status` with the parked banner
   * already explaining why.
   */
  const asked = queued.get(trip.id) ?? null;
  const effective = asked ?? trip.status;

  const paused = effective === 'waiting';

  // Whether the office has actually recorded the pause, as opposed to the
  // driver having asked for it. Only the confirmed case may print a duration —
  // see the notice below.
  const pauseConfirmed = trip.status === 'waiting';

  /**
   * Total time this trip has spent on hold, including the pause running now.
   *
   * Null rather than zero when the timeline has not arrived — the same rule
   * every other figure on this screen follows. A `00:00` on a trip that has
   * been held twice would understate a charge the passenger will see.
   *
   * Computed inside `HoldNotice`, which owns the tick — see that component.
   */

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
  const hold = async (to: 'waiting' | 'trip_resumed', stopId?: number) => {
    setBusy(true);
    // The `finally` is what `end` below already has, and skipping it here was
    // a dead screen: `queueTransition` throws when the outbox is not open,
    // the caller is `void hold(...)`, and a rejection between these two lines
    // left both buttons spinning for the rest of the session with the error
    // swallowed whole.
    try {
      // `from` is the status this transition will actually depart from, which
      // on a pause-then-resume in one dead zone is the one still sitting in
      // the outbox rather than the one the office last confirmed. It is only
      // read when an item fails, to tell "my write is missing" from "the trip
      // moved on without me" — so a stale value here would misreport the one
      // case the reconciliation exists to distinguish.
      //
      // `stopId` is ADR-0045 §2: a pause that carries one is an arrival at
      // that stop, and the plain Pause button carries none — same transition,
      // two meanings, distinguished by the payload exactly as the server does.
      await queueTransition({
        tripId: trip.id,
        from: effective,
        to,
        ...(stopId === undefined ? {} : { stopId }),
      });
    } finally {
      setBusy(false);
    }
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
   * `from` is the trip's *effective* status rather than a constant, because
   * this screen renders three of them and a trip paused at `waiting` completes
   * from `trip_resumed`, not from `trip_started`.
   *
   * **Effective, not confirmed**, for the narrow case that is nonetheless real:
   * a driver resumes and ends the trip in the same dead zone. The resume is
   * still in the outbox, `trip.status` still reads `waiting`, and the closing
   * transition will in fact depart from `trip_resumed`. Same reasoning as
   * `hold` above — `expectedFrom` is what tells a failed item "my write is
   * missing" from "the trip moved on without me".
   */
  const end = () => {
    // **With the odometer off, ending is a transition again** (ADR-0047).
    // The server no longer requires `odometer_end` — it prices the trip from
    // the GPS trace instead — so the reading screen would be a form asking
    // for a number nothing consumes, on the screen where the driver is most
    // eager to be finished.
    //
    // Queued rather than posted, like every other transition on this screen:
    // a drop-off happens wherever the passenger asked for, which is routinely
    // somewhere with no signal (ADR-0023).
    if (!odometerEnabled) {
      setBusy(true);
      void queueTransition({ tripId: trip.id, from: effective, to: 'trip_completed' })
        .then(
          // **The screen must leave, and it did not.** The odometer-on path
          // ends on `OdometerScreen`, which `replace`s to `RideComplete`; this
          // branch queued the completion and stayed put — so the owner's
          // production fleet (odometer off, ADR-0047) watched the subtitle
          // flip to "Completed" over a screen still offering Pause and End.
          // Found on a handset on go-live day, 2026-08-23.
          //
          // `replace`, not `navigate`, for `OdometerScreen`'s own reason: the
          // back gesture must not reopen a trip that has already ended.
          () => navigation.replace('RideComplete', { tripId: trip.id }),
          () => setBusy(false),
        );

      return;
    }

    navigation.navigate('Odometer', {
      tripId: trip.id,
      to: 'trip_completed',
      from: effective,
    });
  };

  return (
    <Screen>
      <ScreenHeader
        title={TITLE}
        // Only when it adds something. `statusLabel` renders both
        // `trip_started` and `trip_resumed` as "Trip in progress", which is
        // the title verbatim; `waiting` renders "Waiting", and a paused trip
        // is exactly the state somebody glancing at this screen needs told.
        //
        // Read off `effective`, not `trip.status`. On the owner's handset this
        // said **"Trip in progress" over "On the way"** — the screen had moved
        // on a queued transition while the subtitle still reported the status
        // the office last confirmed, which in a dead zone is the one from
        // several presses ago. Honest because `SyncBanner` sits directly
        // beneath saying the work is unsent, and `queued` is the outbox's own
        // contents, so this cannot show a status the driver did not ask for.
        subtitle={statusLabel(effective) === TITLE ? null : statusLabel(effective)}
        onBack={() => navigation.goBack()}
      />

      {/*
        Below the header, which carries the status-bar inset: mounted first,
        the banner's text paints under the clock and the battery — the owner's
        screenshot, and the same bug HomeScreen's own comment records.
      */}
      <SyncBanner />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <MapPanel
          trip={trip}
          here={here}
          startedAt={startedAt}
          route={roadRoute ?? null}
          leg={legRoute ?? null}
        />

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
          // Mid-circuit, "the drop-off" is the next stop still to be visited
          // (ADR-0045); the label changes with it so the row cannot read as
          // the journey's end while the run has three sites left.
          label={nextStop === null ? 'Drop-off' : 'Next drop-off'}
          value={nextStop === null ? trip.dropoff.label : nextStop.label}
          caption={nextStop === null ? null : `Stop ${nextStop.sequence} of ${stops.length}`}
          trailing={
            // Navigate needs somewhere to point: the next stop's pin, or the
            // trip's own. A label-only next stop falls back to the trip pin
            // rather than hiding the button — the map screen says in words
            // which target it is drawing.
            (nextStop !== null && located(nextStop)) || dropoff !== null ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Navigate to ${nextStop === null ? trip.dropoff.label : nextStop.label}`}
                onPress={() => navigation.navigate('TripMap', { tripId: trip.id })}
                style={styles.navigate}
              >
                <NavigationIcon color={colors.primaryText} size={18} strokeWidth={2} />
                <Text style={styles.navigateLabel}>Navigate</Text>
              </Pressable>
            ) : null
          }
        />

        {stops.length > 0 && (
          <StopList
            stops={stops}
            destination={trip.dropoff.label}
            // Arriving is the pause (§2): a paused trip has nowhere to
            // arrive from, and the button follows the same `effective`
            // status the Pause/Resume pair reads.
            canArrive={!paused}
            busy={busy}
            onArrive={(stop) => void hold('waiting', stop.id)}
          />
        )}

        <Facts trip={trip} />

        {paused && <HoldNotice events={events} confirmed={pauseConfirmed} />}

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
          {/*
            In both modes, deliberately — the bank flow adds the next site
            *while paused at this one* (ADR-0045 §4), and hiding the button
            behind a resume would make the driver lie about where they are
            to extend their own run. Below End trip: extending the run is
            the occasional act, ending it is the daily one.
          */}
          <Button
            label="Add a drop-off"
            tone="neutral"
            busy={busy}
            onPress={() => navigation.navigate('AddDropoff', { tripId: trip.id })}
            icon={<CirclePlusIcon size={16} />}
          />
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
  startedAt,
  route,
  leg,
}: {
  trip: Trip;
  here: Fix | null;
  startedAt: number | null;
  route: TripRoute | null;
  /**
   * The whole leg's road, or null.
   *
   * What the map frames on, so the camera stops re-fitting itself to the
   * shrinking road ahead — the reason a driver could not see their own
   * progress. What is left of it showing behind the vehicle is the road
   * already driven.
   */
  leg: TripRoute | null;
}) {
  const pickup = located(trip.pickup) ? toCoordinates(trip.pickup) : null;

  /*
   * Mid-circuit the map's target is the next pending stop (ADR-0045) — the
   * same answer the drop-off row gives and the same one the route endpoint
   * draws toward, so the pin, the row and the line cannot point three ways.
   * A label-only stop keeps the trip's own pin: prose is not a place, and
   * the badge must measure to somewhere real or to nothing.
   */
  const nextStop = nextPendingStop(trip.stops ?? []);
  const target =
    nextStop !== null && located(nextStop)
      ? toCoordinates(nextStop)
      : located(trip.dropoff)
        ? toCoordinates(trip.dropoff)
        : null;

  // The road when there is one, the crow's flight when there is not — and the
  // caption below changes with it, because the two are different claims.
  const remaining =
    route !== null
      ? formatKilometres(route.distance_km)
      : here === null || target === null
        ? null
        : formatKilometres(greatCircleKm(here, target));

  // `PickupMap` draws a map only when there is a pickup pin, and renders a
  // short explanatory panel otherwise. The badge floats *over* a map and must
  // not float over that panel — on a real handset it landed on top of the
  // sentence and cut it in half. Found on a device, not in a test.
  const mapped = pickup !== null;

  return (
    <View>
      <PickupMap
        pickup={pickup}
        dropoff={target}
        here={here}
        leg="fare"
        // The stat badge below floats over the map's bottom-right. Without
        // this the map framed the drop-off marker underneath the card
        // describing it — the owner's handset, mid-trip.
        overlay="bottom-right"
        routePolyline={route?.polyline ?? null}
        legPolyline={leg?.polyline ?? null}
        // The driver as the vehicle they are driving, pointed the way they
        // are going — the same silhouette the office's live map draws.
        heading={here?.heading ?? null}
        vehicle={spriteFor(trip.vehicle?.category)}
      />

      <StatBadge
        startedAt={startedAt}
        remaining={remaining}
        byRoad={route !== null}
        mapped={mapped}
      />
    </View>
  );
}

/**
 * The floating stats — distance to go and elapsed time — and the only part
 * of the map panel that ticks.
 *
 * A leaf for the same reason `HoldNotice` is one: the elapsed figure changes
 * once a second, and when it was computed in the screen component that second
 * re-rendered everything, `PickupMap`'s WebView and its 13 KB `source` prop
 * included. Sixty re-marshallings of an unchanged map document per minute,
 * for the whole length of a trip, on the JS thread a tap is answered on — the
 * literal mechanics of "the app is frozen". In here, the tick repaints two
 * lines of text.
 */
function StatBadge({
  startedAt,
  remaining,
  byRoad,
  mapped,
}: {
  startedAt: number | null;
  remaining: string | null;
  byRoad: boolean;
  mapped: boolean;
}) {
  const now = useTicker();
  const driving = startedAt === null ? null : elapsedSeconds(startedAt, now);

  return (
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
      <Text style={styles.badgeCaption}>{byRoad ? 'by road' : 'straight line'}</Text>

      <View style={styles.badgeRule} />

      <Text style={styles.badgeValue}>
        {driving === null ? NO_VALUE : formatTripDuration(driving)}
      </Text>
      {/* "elapsed", not "driving": this is wall-clock from `trip_started`
          and includes every pause, so on a held trip the two differ by
          exactly the time the passenger is being charged for. */}
      <Text style={styles.badgeCaption}>elapsed</Text>
    </View>
  );
}

/**
 * The on-hold notice, with the running duration — and it owns its own tick.
 *
 * See `StatBadge` for why the ticker must live in a leaf. This one renders
 * only while the trip is paused, so the timer costs nothing the rest of the
 * ride.
 */
function HoldNotice({
  events,
  confirmed,
}: {
  events: TripEvent[] | undefined;
  confirmed: boolean;
}) {
  const now = useTicker();
  const waited = events === undefined ? null : waitingSecondsFrom(events, now);

  return (
    <Notice
      tone="info"
      message={
        // "Recorded and priced" stays: it is money, and it is the reason
        // a driver leaves the trip on hold rather than ending it.
        //
        // **The duration needs the office, not just the intent.** It is
        // summed from `trip_events`, and a pause still sitting in the
        // outbox has no row there — so on an unconfirmed hold the events
        // describe *previous* pauses, and printing that total would date
        // this one from the last time the driver stopped. The
        // durationless sentence is the true one until the row exists.
        !confirmed || waited === null
          ? 'On hold. Waiting time is recorded and priced.'
          : `On hold for ${formatTripDuration(waited)}. Waiting time is recorded and priced.`
      }
    />
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
            /*
             * **Withheld on a circuit, and that is the honest answer**
             * (ADR-0045). This is the straight line from pickup to drop-off,
             * which describes a point-to-point job. A bank's ATM run starts
             * and ends at head office, so on the trip that matters most here
             * the two ends are the same place and this read **"Under 100 m"**
             * for a morning's driving — found by rendering the screen with a
             * three-stop circuit, not by any test.
             *
             * There is no honest substitute mid-run: summing the legs would
             * be a straight-line total for a road journey, and `distance_km`
             * and `gps_distance_km` are both written at Trip Completed. So
             * the row renders an em dash, exactly as this screen's docblock
             * says distance *travelled* does, and for the same reason.
             */
            (trip.stops ?? []).length > 0
              ? null
              : located(trip.pickup) && located(trip.dropoff)
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
 * A clock that ticks once a second for as long as its component is mounted.
 *
 * **Lives in `StatBadge` and `HoldNotice`, never in the screen** — see
 * `StatBadge` for what hoisting it cost. The same shape as
 * `WaitingForPassengerScreen`'s, including the decision not to gate it on the
 * timeline having arrived: gating froze `now` at mount, so the first render
 * after the events request landed computed elapsed time against a stale clock
 * and read low. One 1 Hz timer on a mounted leaf costs nothing measurable; a
 * wrong reading costs the figure its point.
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
