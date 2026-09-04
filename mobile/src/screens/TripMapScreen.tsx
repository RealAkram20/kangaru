import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';

import type { TripsStackParams } from '../navigation/types';
import { openDirections } from '../trips/directions';
import { PickupMap } from '../trips/PickupMap';
import { journeyAnnouncement, journeyProgress, journeyTotal } from '../trips/journey';
import { located, greatCircleKm, toCoordinates } from '../trips/places';
import { nextPendingStop, pickupIsLegOrigin } from '../trips/stops';
import { spriteFor } from '../trips/vehicleSprites';
import { usePosition } from '../location/usePosition';
import { useTrip, useTripRoute } from '../trips/queries';
import { formatKilometres } from '../duty/offerPresentation';
import { Button, Notice, Screen, ScreenHeader } from '../ui/components';
import { NavigationIcon } from '../ui/icons';
import { colors, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<TripsStackParams, 'TripMap'>;

/**
 * The map, given the whole screen.
 *
 * Built because tapping *Navigate* threw a driver straight out of the app into
 * Google Maps, and the complaint was not that the maps app is bad — it is that
 * being ejected mid-job to see where you are going is jarring, and coming back
 * means finding the app again with a passenger in the car.
 *
 * So the tap now **expands the map that was already on the screen**: the same
 * map document, the same pins, the driver's live position, pinch to zoom.
 * The hand-off is still one button away, and it is still the right answer for
 * actual guidance — see below.
 *
 * ## Why this is not turn-by-turn, and what it would cost to be
 *
 * There is no voice, no re-routing and no lane guidance here, and adding them
 * is not a matter of effort. It needs a navigation SDK — realistically
 * Mapbox's — which is a **metered paid service** and a **native module**, so
 * it cannot run in Expo Go and would need every handset rebuilt. That is weeks
 * of work and a permanent monthly bill to end up worse than the free app
 * already on the driver's phone, which has Kampala's one-way system and live
 * traffic and which they already know how to use.
 *
 * The honest division stays: this platform answers *where*, and the maps app
 * answers *how*. What changes is that answering "where" no longer costs the
 * driver their place in the app.
 *
 * ## One leg, and the driver's own
 *
 * There *is* a route line now (ADR-0031), and the only thing this screen has
 * to get right about it is which leg it asks for. Before boarding that is the
 * road to the passenger; after it, the road to the drop-off. The header, the
 * target pin, the "Open in Maps" hand-off, the by-road distance and the drawn
 * line all read from one `boarded` flag so they cannot disagree — which they
 * did, for as long as the route request ignored it.
 *
 * The honest division still stands where routing cannot reach: no key, no
 * signal, no pins, and the map falls back to `PickupMap`'s dashed direct line
 * with the footer saying in words that it is not a road distance.
 */
export function TripMapScreen({ route, navigation }: Props) {
  const { tripId } = route.params;
  const { data: trip } = useTrip(tripId);

  // Watching, as the trip screen does: this map shows the driver moving, and a
  // single fix taken on open would freeze them at the door they came in by.
  const here = usePosition({ watch: true });

  // Where the driver is *going*, which depends on where they are in the job:
  // the passenger is in the car from `trip_started` onward, so the useful
  // destination is the drop-off; before that it is the pickup. Sending a
  // driver to a pickup they have already made is the kind of small wrongness
  // that makes an app feel like it is not paying attention.
  //
  // Read off `trip?.status` up here, above the hooks and above the early
  // return, because **the route request needs it too** — see below.
  const boarded =
    trip?.status === 'trip_started' ||
    trip?.status === 'waiting' ||
    trip?.status === 'trip_resumed' ||
    trip?.status === 'passenger_onboard';

  /*
    The road for the leg the driver is actually on, refetched when they have
    moved ~100 m rather than on a clock — see `useTripRoute`. Null whenever
    routing is off, unconfigured or unreachable, which the map draws as its
    dashed direct line.

    **The leg is the fix here.** This asked for the drop-off unconditionally,
    while the header, the target pin and the "Open in Maps" button all
    respected `boarded` — so a driver on the way to a pickup read "Pickup" at
    the top, a road to somewhere else in the middle, and a by-road distance
    for a journey they had not started. On order 40 that is 7.3 km of approach
    drawn as 71.0 km of fare.
  */
  const { data: roadRoute } = useTripRoute(
    tripId,
    here,
    boarded ? 'dropoff' : 'pickup',
    trip !== undefined,
  );

  /*
    And the **whole** leg — the road from the pickup to where this leg ends,
    which is what the driver's own position is measured against.

    The complaint: *"the driver can not see where he is from the entire route
    so they find it hard to tell the progress visually"*. The road above
    starts under the driver's feet and the camera framed itself on it, so it
    filled the screen at every stage of a job. This is the fixed line the map
    frames on instead, and the denominator under the bar below.

    **It is very nearly free.** The origin is omitted, so the query key holds
    no position and never changes — it is byte for byte the request
    `WaitingForPassengerScreen` already makes, and a driver reaches this
    screen through that one on every trip, so React Query usually answers
    from cache without asking anybody. Off that path it is one request per
    trip against the ten or twenty ADR-0031 5's deviation trigger already
    spends, and `RouteService` caches a fixed origin *and* destination across
    every driver on that pair.

    Withheld in two cases, both because the ratio would be a lie rather than
    because the request costs anything:

    - **the approach**, whose whole road starts wherever the driver was when
      they accepted — a position this platform does not record;
    - **mid-circuit**, once any stop has been worked: the leg then runs stop
      to stop, and measuring what is left of it against a road starting at
      the pickup compares two different journeys. See `pickupIsLegOrigin`.
  */
  const wholeLegKnown = boarded && pickupIsLegOrigin(trip?.stops ?? []);
  const { data: cachedLeg } = useTripRoute(
    tripId,
    null,
    'dropoff',
    trip !== undefined && wholeLegKnown,
  );

  /*
    **`enabled` withholds the request; it does not withhold the answer.** That
    distinction is the whole reason this line exists, and it was found on an
    emulator rather than in a test.

    `WaitingForPassengerScreen` asks this exact question — same trip, same leg,
    no origin — earlier in every job, so by the time a driver is mid-circuit
    the key is already warm. A disabled `useQuery` still hands back whatever
    the cache holds for its key, so the road from the *pickup* went on being
    served on a circuit whose leg had long since moved on. On a real Jinja run
    that read **83.8 km to go, of 69.4 km** — the remaining road longer than
    the whole journey it was being measured against, and the bar pinned at
    zero because the clamp was the only thing catching it.

    So the value is gated where it is used, not only where it is fetched.
  */
  const legRoute = wholeLegKnown ? cachedLeg : undefined;

  if (trip === undefined) {
    return (
      <Screen>
        <ScreenHeader title="Map" onBack={() => navigation.goBack()} />
        <Notice message="This trip is not on this phone, and the office is unreachable." />
      </Screen>
    );
  }

  const pickup = located(trip.pickup) ? toCoordinates(trip.pickup) : null;

  /*
   * Mid-circuit, "the drop-off" is the next pending stop (ADR-0045) — the
   * same answer the in-progress screen's row gives and the same destination
   * the route endpoint draws toward, so the header, the pin, the line and
   * "Open in Maps" all move together when a stop is added. A label-only
   * stop keeps the trip's own pin (prose is not a place); its name still
   * takes the header, because that *is* where the driver is going.
   */
  const nextStop = nextPendingStop(trip.stops ?? []);
  const dropoff =
    nextStop !== null && located(nextStop)
      ? toCoordinates(nextStop)
      : located(trip.dropoff)
        ? toCoordinates(trip.dropoff)
        : null;

  const target = boarded ? dropoff : pickup;
  const targetLabel = boarded
    ? (nextStop?.label ?? trip.dropoff.label)
    : trip.pickup.label;

  const away = here === null || target === null ? null : formatKilometres(greatCircleKm(here, target));

  // What is left, and whether it followed a road — two different claims, and
  // the caption below is how a driver tells them apart.
  const byRoad = (roadRoute ?? null) !== null;
  const remaining = byRoad ? formatKilometres(roadRoute!.distance_km) : away;

  /*
    How far through, as a fraction of the leg — from two road distances the
    provider measured to the same destination, and from nothing else. Null
    whenever either is missing, which draws no bar rather than an empty one.

    Minutes appear only when the provider sent them: ADR-0031 6 forbids
    deriving a duration here, and it forbids it *especially* from this
    fraction, which is the most tempting distance in the app to turn into a
    time.
  */
  const progress = journeyProgress(roadRoute?.distance_km, legRoute?.distance_km);
  const total = journeyTotal(legRoute ?? null);

  const caption = byRoad
    ? roadRoute!.duration_seconds === null
      ? 'by road'
      : `by road · about ${Math.max(1, Math.round(roadRoute!.duration_seconds / 60))} min`
    : 'straight line — not the road distance';

  return (
    <Screen>
      <ScreenHeader
        title={boarded ? 'Drop-off' : 'Pickup'}
        subtitle={targetLabel}
        onBack={() => navigation.goBack()}
      />

      <View style={styles.map}>
        <PickupMap
          pickup={pickup}
          dropoff={dropoff}
          here={here}
          fill
          leg={boarded ? 'fare' : 'approach'}
          routePolyline={roadRoute?.polyline ?? null}
          // The whole journey, so the camera can hold still over it and the
          // road already driven stays on the map behind the vehicle.
          legPolyline={legRoute?.polyline ?? null}
          // The driver, as the vehicle they are actually in. Unknown or
          // missing category draws a generic car — `spriteFor`'s own fallback.
          heading={here?.heading ?? null}
          vehicle={spriteFor(trip.vehicle?.category)}
        />
      </View>

      <View style={styles.footer}>
        {remaining !== null && (
          <View
            style={styles.distance}
            // One sentence for the whole card. A headline figure, a bar and a
            // caption linearise into three disconnected fragments, and a bar
            // linearises into nothing at all — screen-rules §6.
            accessible
            accessibilityLabel={journeyAnnouncement({
              remaining,
              total: progress === null ? null : total,
              byRoad,
              durationSeconds: roadRoute?.duration_seconds ?? null,
            })}
          >
            <Text style={styles.distanceValue}>{remaining}</Text>

            {/*
              The bar, with the whole leg's length at the far end of it —
              which is where the journey ends, so that is where the number
              belongs. Without a stated total a bar is the shape `Handover`
              refuses: something filling at a rate somebody chose.

              It does not animate. §5 forbids decoration on a surface a driver
              watches for a whole trip, and there would be nothing to see
              anyway: the fraction moves when a new road arrives, which is
              about one per cent at a time.
            */}
            {progress !== null && total !== null && (
              <View style={styles.rail}>
                {/*
                  The graphic is hidden and the figure beside it is not. A bar
                  linearises into nothing a screen reader can use, and the card
                  above already says both distances in words — but the total is
                  real text and stays in the tree, because hiding it would take
                  a number off the screen for anybody reading it any other way.
                */}
                <View
                  style={styles.track}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  <View style={{ flexGrow: progress }} />
                  <View style={[styles.ahead, { flexGrow: 1 - progress }]} />
                </View>
                <Text style={styles.railTotal}>{total}</Text>
              </View>
            )}

            <Text style={styles.distanceCaption}>{caption}</Text>
          </View>
        )}

        {target !== null && (
          <Button
            label="Open in Maps"
            tone="neutral"
            onPress={() => void openDirections(target, targetLabel)}
            icon={<NavigationIcon color={colors.textBody} size={18} strokeWidth={2} />}
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
  footer: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  distance: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSunken,
  },
  rail: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  /**
   * The bar itself, which is **a legend for the map above it**.
   *
   * The grey is the road already driven and the green is the road still to
   * drive, in that order and in those colours, because that is exactly what
   * the map is drawing a few centimetres higher. Filling it the conventional
   * way — green growing from the left as progress accrues — would have given
   * the same two colours the opposite meanings on one screen.
   *
   * `primaryCta` rather than the map line's `primary`: the two read as the
   * same green, and this is the darker of them because a small solid block
   * needs more contrast than a stroke over a pale basemap does. Measured, not
   * eyeballed (DESIGN.md §8) — 3.65:1 between the two halves, against the
   * 3:1 a non-text UI component owes; `primary` was 2.27 and failed.
   *
   * Two flex children rather than a percentage width: the ratio is exact
   * either way, and this one is typed — React Native's `DimensionValue` takes
   * a literal `${number}%`, which a computed template string is not.
   */
  track: {
    flex: 1,
    flexDirection: 'row',
    height: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    overflow: 'hidden',
  },
  ahead: {
    flexBasis: 0,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryCta,
  },
  railTotal: {
    ...typography.captionStrong,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  distanceValue: {
    ...typography.heading,
    color: colors.primaryText,
    fontVariant: ['tabular-nums'],
  },
  distanceCaption: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
