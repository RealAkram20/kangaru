import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ContactDetails, TripStatus } from '../api/types';
import { useSync } from '../offline/SyncProvider';
import { driverActions, shouldStreamGps, statusLabel, type TripAction } from '../trips/transitions';
import { useTrip, useTripEvents } from '../trips/queries';
import { Button, Card, Field, Notice, Screen, StatusPill } from '../ui/components';
import { SyncBanner } from '../ui/SyncBanner';
import { colors, spacing, typography } from '../ui/theme';
import type { TripsStackParams } from '../navigation/types';

type Props = NativeStackScreenProps<TripsStackParams, 'TripDetail'>;

export function TripDetailScreen({ route, navigation }: Props) {
  const { tripId } = route.params;
  const { data: trip, isLoading } = useTrip(tripId);
  const { data: events } = useTripEvents(tripId);
  const { queueTransition } = useSync();

  const [declining, setDeclining] = useState(false);
  const [notes, setNotes] = useState('');
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

  const actions = driverActions(trip);
  // Bound to a local so the null check narrows inside the press handler —
  // TypeScript cannot prove a property is still non-null by the time a
  // callback runs, and it is right not to.
  const passenger = trip.passenger_contact;

  const run = async (action: TripAction) => {
    // The two readings are the product. They get their own screen rather than
    // an inline field, because a number typed by mistake here becomes a
    // billing dispute later.
    if (action.requires === 'odometer_start' || action.requires === 'odometer_end') {
      navigation.navigate('Odometer', {
        tripId: trip.id,
        to: action.to as 'trip_started' | 'trip_completed',
        from: trip.status,
      });

      return;
    }

    if (action.requires === 'notes') {
      setDeclining(true);

      return;
    }

    setBusy(true);
    await queueTransition({ tripId: trip.id, from: trip.status, to: action.to });
    setBusy(false);
  };

  const confirmDecline = async () => {
    if (notes.trim().length === 0) {
      return;
    }

    Alert.alert('Decline this trip?', 'It goes back to dispatch and is recorded against you.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Decline',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await queueTransition({
              tripId: trip.id,
              from: trip.status,
              to: 'rejected',
              notes: notes.trim(),
            });
            setDeclining(false);
            setNotes('');
          })();
        },
      },
    ]);
  };

  return (
    <Screen>
      <SyncBanner />

      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <StatusPill label={statusLabel(trip.status)} tone={shouldStreamGps(trip.status) ? 'live' : 'neutral'} />
          <Text style={styles.route}>{trip.origin}</Text>
          <Text style={styles.arrow}>↓</Text>
          <Text style={styles.route}>{trip.destination}</Text>

          {trip.vehicle && (
            <Text style={styles.meta}>
              {trip.vehicle.registration_number}
              {trip.vehicle.make !== null && ` · ${trip.vehicle.make} ${trip.vehicle.model ?? ''}`}
            </Text>
          )}

          {shouldStreamGps(trip.status) && (
            <Text style={styles.tracking}>● Recording GPS for this trip</Text>
          )}
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Odometer</Text>
          <OdometerLine label="Opening" value={trip.odometer_start} photo={trip.odometer_start_photo_url} />
          <OdometerLine label="Closing" value={trip.odometer_end} photo={trip.odometer_end_photo_url} />
          {trip.distance_km !== null && (
            <Text style={styles.meta}>Distance {trip.distance_km} km</Text>
          )}
        </Card>

        {/*
          The passenger's number, when the server sends one (ADR-0024 §7).
          It withholds it unless this driver is on this trip, the trip is a
          walk-in, and it is live — so there is no rule to re-implement here.
          The field is present or it is not, and the button follows.
        */}
        {passenger !== null && (
          <Card>
            <Text style={styles.sectionTitle}>Passenger</Text>
            <Text style={styles.meta}>{passenger.label}</Text>
            <Button
              label={`Call ${passenger.name}`}
              tone="neutral"
              onPress={() => void callPassenger(passenger)}
            />
          </Card>
        )}

        {actions.length === 0 ? (
          <Notice
            message="There is nothing for you to do on this trip right now."
            tone="info"
          />
        ) : (
          <View style={styles.actions}>
            {actions.map((action) => (
              <Button
                key={action.to}
                label={action.label}
                tone={action.tone}
                busy={busy}
                onPress={() => void run(action)}
              />
            ))}
          </View>
        )}

        {declining && (
          <Card>
            <Field
              label="Why are you declining?"
              hint="The office sees this. It is required."
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
            />
            <Button
              label="Confirm decline"
              tone="danger"
              disabled={notes.trim().length === 0}
              onPress={() => void confirmDecline()}
            />
          </Card>
        )}

        {events !== undefined && events.length > 0 && (
          <Card>
            <Text style={styles.sectionTitle}>Timeline</Text>
            {events.map((event) => (
              <View key={event.id} style={styles.event}>
                <Text style={styles.eventStatus}>{statusLabel(event.to_status as TripStatus)}</Text>
                <Text style={styles.eventTime}>{formatMoment(event.created_at)}</Text>
                {event.notes !== null && <Text style={styles.meta}>{event.notes}</Text>}
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

function OdometerLine({
  label,
  value,
  photo,
}: {
  label: string;
  value: number | null;
  photo: string | null;
}) {
  return (
    <View style={styles.odometerLine}>
      <Text style={styles.meta}>{label}</Text>
      <Text style={styles.odometerValue}>
        {value === null ? '—' : `${value.toLocaleString()} km`}
        {photo !== null && ' 📷'}
      </Text>
    </View>
  );
}

function formatMoment(value: string | null): string {
  if (value === null) {
    return '';
  }

  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? '' : new Date(parsed).toLocaleString();
}

/**
 * Dials the passenger.
 *
 * `tel:` rather than anything cleverer. It hands off to the dialler the
 * driver already knows, works with whatever SIM and network they have, and
 * costs this app no permission — an in-app calling stack would need one, and
 * would still end up placing an ordinary call.
 *
 * A failure here is silent on purpose: the only realistic cause is a handset
 * with no dialler, which is not a state a driver can act on, and the number
 * is on screen above the button either way.
 */
async function callPassenger(contact: ContactDetails): Promise<void> {
  const url = `tel:${contact.phone.replace(/\s+/g, '')}`;

  try {
    await Linking.openURL(url);
  } catch {
    // Nothing useful to say. The number is rendered above.
  }
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.md,
    gap: spacing.md,
  },
  loading: {
    ...typography.body,
    color: colors.textMuted,
    padding: spacing.lg,
  },
  route: {
    ...typography.heading,
    color: colors.text,
    marginTop: spacing.sm,
  },
  arrow: {
    ...typography.caption,
    color: colors.textMuted,
  },
  meta: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  tracking: {
    ...typography.caption,
    color: colors.success,
    marginTop: spacing.sm,
    fontWeight: '700',
  },
  sectionTitle: {
    ...typography.label,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  actions: {
    gap: spacing.sm + 4,
  },
  odometerLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  odometerValue: {
    ...typography.label,
    color: colors.text,
  },
  event: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.sm,
  },
  eventStatus: {
    ...typography.body,
    color: colors.text,
  },
  eventTime: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
