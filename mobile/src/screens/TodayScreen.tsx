import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import type { Trip } from '../api/types';
import { useSync } from '../offline/SyncProvider';
import { isInProgress, statusLabel } from '../trips/transitions';
import { useTrips } from '../trips/queries';
import { Card, Empty, Notice, Screen, StatusPill } from '../ui/components';
import { SyncBanner } from '../ui/SyncBanner';
import { colors, radius, spacing, typography } from '../ui/theme';
import type { TripsStackParams } from '../navigation/types';

type Props = NativeStackScreenProps<TripsStackParams, 'Today'>;

export function TodayScreen({ navigation }: Props) {
  const { trips, isLoading, isError, refetch, isRefetching, dataUpdatedAt } = useTrips();
  const { sync, online } = useSync();

  const refresh = useCallback(async () => {
    await Promise.all([refetch(), sync()]);
  }, [refetch, sync]);

  return (
    <Screen>
      <SyncBanner />

      <FlatList
        data={trips}
        keyExtractor={(trip) => String(trip.id)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refresh()}
            tintColor={colors.text}
          />
        }
        ListHeaderComponent={
          // A stale list is served rather than hidden, so the app has to say
          // when it is stale. Without this a driver cannot tell yesterday's
          // work from today's.
          isError && dataUpdatedAt > 0 ? (
            <Notice
              message={`Showing the list from ${formatTime(dataUpdatedAt)}. Could not reach the office.`}
            />
          ) : null
        }
        ListEmptyComponent={
          isLoading ? null : (
            <Empty
              message={
                online
                  ? 'Nothing assigned to you yet. Pull down to check again.'
                  : 'No connection, and nothing saved on this phone yet.'
              }
            />
          )
        }
        renderItem={({ item }) => (
          <TripRow trip={item} onPress={() => navigation.navigate('TripDetail', { tripId: item.id })} />
        )}
      />
    </Screen>
  );
}

function TripRow({ trip, onPress }: { trip: Trip; onPress: () => void }) {
  const live = isInProgress(trip.status);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${trip.origin} to ${trip.destination}, ${statusLabel(trip.status)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.rowWrapper, pressed && styles.pressed]}
    >
      <Card style={live ? styles.liveCard : undefined}>
        <View style={styles.rowHeader}>
          <StatusPill
            label={statusLabel(trip.status)}
            tone={live ? 'live' : trip.status === 'trip_completed' ? 'done' : 'neutral'}
          />
          {trip.vehicle && <Text style={styles.plate}>{trip.vehicle.registration_number}</Text>}
        </View>

        <Text style={styles.route}>{trip.origin}</Text>
        <Text style={styles.arrow}>↓</Text>
        <Text style={styles.route}>{trip.destination}</Text>

        {trip.odometer_start !== null && (
          <Text style={styles.meta}>
            Opening odometer {trip.odometer_start.toLocaleString()} km
            {trip.odometer_end !== null && ` · closing ${trip.odometer_end.toLocaleString()} km`}
          </Text>
        )}
      </Card>
    </Pressable>
  );
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  list: {
    padding: spacing.md,
    gap: spacing.md,
  },
  rowWrapper: {
    borderRadius: radius.lg,
  },
  pressed: {
    opacity: 0.8,
  },
  liveCard: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  plate: {
    ...typography.label,
    color: colors.textMuted,
  },
  route: {
    ...typography.heading,
    fontSize: 18,
    color: colors.text,
  },
  arrow: {
    ...typography.caption,
    color: colors.textMuted,
    marginVertical: 2,
  },
  meta: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
});
