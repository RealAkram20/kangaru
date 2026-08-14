import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';

import type { TripsStackParams } from '../navigation/types';
import { openDirections } from '../trips/directions';
import { PickupMap } from '../trips/PickupMap';
import { located, greatCircleKm, toCoordinates } from '../trips/places';
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
 * MapLibre document, the same pins, the driver's live position, pinch to zoom.
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
 * ## No route line yet
 *
 * The two pins still have nothing drawn between them, for the reason
 * `PickupMap` gives: a straight line is not a road. A real one needs a
 * routing engine, the owner has chosen Google Directions for it, and that
 * needs an API key and an ADR — it is a new paid dependency, and a real road
 * duration would also overturn ADR-0020 §3's refusal to show an ETA, which
 * was a refusal to *invent* one rather than a refusal to have one. Neither is
 * a change to make on the way past.
 */
export function TripMapScreen({ route, navigation }: Props) {
  const { tripId } = route.params;
  const { data: trip } = useTrip(tripId);

  // Watching, as the trip screen does: this map shows the driver moving, and a
  // single fix taken on open would freeze them at the door they came in by.
  const here = usePosition({ watch: true });

  // Refetched when the driver has moved ~100 m, not on a clock — see
  // `useTripRoute`. Null whenever routing is off, unconfigured or unreachable,
  // which the map draws as its dashed direct line.
  const { data: roadRoute } = useTripRoute(tripId, here);

  if (trip === undefined) {
    return (
      <Screen>
        <ScreenHeader title="Map" onBack={() => navigation.goBack()} />
        <Notice message="This trip is not on this phone and the office cannot be reached." />
      </Screen>
    );
  }

  const pickup = located(trip.pickup) ? toCoordinates(trip.pickup) : null;
  const dropoff = located(trip.dropoff) ? toCoordinates(trip.dropoff) : null;

  // Where the driver is *going*, which depends on where they are in the job:
  // the passenger is in the car from `trip_started` onward, so the useful
  // destination is the drop-off; before that it is the pickup. Sending a
  // driver to a pickup they have already made is the kind of small wrongness
  // that makes an app feel like it is not paying attention.
  const boarded =
    trip.status === 'trip_started' ||
    trip.status === 'waiting' ||
    trip.status === 'trip_resumed' ||
    trip.status === 'passenger_onboard';

  const target = boarded ? dropoff : pickup;
  const targetLabel = boarded ? trip.dropoff.label : trip.pickup.label;

  const away = here === null || target === null ? null : formatKilometres(greatCircleKm(here, target));

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
          boarded={boarded}
          routePolyline={roadRoute?.polyline ?? null}
        />
      </View>

      <View style={styles.footer}>
        {(roadRoute ?? null) !== null ? (
          <View style={styles.distance}>
            <Text style={styles.distanceValue}>{formatKilometres(roadRoute!.distance_km)}</Text>
            {/*
              Two different claims, and the caption is how a driver tells them
              apart. This one followed a road; the fallback below did not.
              Minutes appear only when the provider sent them — ADR-0031 §6
              forbids deriving a duration here, whatever distance is in hand.
            */}
            <Text style={styles.distanceCaption}>
              {roadRoute!.duration_seconds === null
                ? 'by road'
                : `by road · about ${Math.max(1, Math.round(roadRoute!.duration_seconds / 60))} min`}
            </Text>
          </View>
        ) : (
          away !== null && (
            <View style={styles.distance}>
              <Text style={styles.distanceValue}>{away}</Text>
              <Text style={styles.distanceCaption}>straight line — not the road distance</Text>
            </View>
          )
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
