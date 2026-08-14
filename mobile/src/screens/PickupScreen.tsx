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
import { useTrip } from '../trips/queries';
import { driverActions, statusLabel, type TripAction } from '../trips/transitions';
import { Button, Notice, Screen } from '../ui/components';
import { DetailRow, GLYPH, RouteRail, Stat, StatRow } from '../ui/facts';
import {
  ChevronLeftIcon,
  NavigationIcon,
  PhoneIcon,
  RouteIcon,
  UserIcon,
  WalletIcon,
} from '../ui/icons';
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
 * pickup wants to know how long. The honest answer is that the platform does
 * not know — it has no routing engine, and the crow's-flight distance
 * under-reads against real roads. So the map overlay and the facts row both
 * show **distance, said to be straight-line**, and the driver's own maps app
 * is one tap away for the part we cannot answer.
 *
 * ## The map is an orientation aid, not a route
 *
 * Markers only — no line between them. The platform has no routing engine, and
 * a straight line is not a road; drawing one would tell a driver to go a way
 * that may not exist. `PickupMap` carries the rest of that argument, including
 * why it is MapLibre in a WebView rather than the native map a mockup implies:
 * `react-native-maps` needs a Google billing account to draw a street.
 *
 * The map is also allowed to be absent — a trip keyed in over the phone has no
 * coordinates at all. **Every fact on this screen is legible without it**,
 * which is why the addresses are on a rail below rather than only in a
 * callout, and why the distance is in the facts row as well as on the badge.
 */
export function PickupScreen({ route, navigation }: Props) {
  const { tripId } = route.params;
  const { data: trip, isLoading } = useTrip(tripId);
  const { queueTransition } = useSync();
  const here = usePosition();

  const [busy, setBusy] = useState(false);

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
  const actions = driverActions(trip);

  const run = async (action: TripAction) => {
    // Odometer capture and a decline both need more than a tap, and both
    // already have screens. This one only ever posts the plain transitions
    // of the pickup leg — on my way, I've arrived — so anything asking for
    // more is handed back to the full trip screen rather than half-built
    // here.
    if (action.requires !== null) {
      navigation.navigate('TripDetail', { tripId: trip.id });

      return;
    }

    setBusy(true);
    // Queued, not posted. A pickup happens in a stairwell, a basement car
    // park, a street with no signal — `SyncProvider` holds the transition and
    // sends it when there is a network (ADR-0023), and `SyncBanner` says so.
    await queueTransition({ tripId: trip.id, from: trip.status, to: action.to });
    setBusy(false);
  };

  return (
    <Screen>
      <SyncBanner />

      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
          hitSlop={10}
          style={styles.back}
        >
          <ChevronLeftIcon color={colors.text} size={26} strokeWidth={2.2} />
        </Pressable>

        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            Pickup passenger
          </Text>
          <Text style={styles.status} numberOfLines={1}>
            {statusLabel(trip.status)}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <MapPanel trip={trip} here={here} />

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

        {actions.length === 0 ? (
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
function MapPanel({ trip, here }: { trip: Trip; here: Coordinates | null }) {
  const pickup = located(trip.pickup) ? toCoordinates(trip.pickup) : null;
  const dropoff = located(trip.dropoff) ? toCoordinates(trip.dropoff) : null;

  const away = here === null || pickup === null ? null : formatKilometres(greatCircleKm(here, pickup));

  return (
    <View>
      <PickupMap pickup={pickup} dropoff={dropoff} here={here} />

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

  const away = here === null || pickup === null ? null : formatKilometres(greatCircleKm(here, pickup));
  const journey = pickup === null || dropoff === null ? null : formatKilometres(greatCircleKm(pickup, dropoff));

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
  loading: {
    ...typography.body,
    color: colors.textMuted,
    padding: spacing.lg,
  },
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
