import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ProfileStackParams } from '../navigation/types';
import type { OutboxItem } from '../offline/outboxTypes';
import { useSync } from '../offline/SyncProvider';
import { Button, Card, Empty, Screen, ScreenHeader } from '../ui/components';
import { colors, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<ProfileStackParams, 'SyncQueue'>;

/**
 * What is waiting to reach the office, and what is stuck.
 *
 * **This is the half of `AccountScreen` that had to survive its replacement.**
 * ADR-0023 §6: an item the server refused keeps its payload and is *shown*,
 * never dropped — a driver whose closing odometer was rejected has to be able
 * to read the number back to the office over the phone, which means it has to
 * still be here.
 *
 * It gained a screen rather than staying inline for one reason: the profile
 * screen's mockup is a menu, and burying a queue that matters at the bottom of
 * a scroll is how it stops being read. The row that opens this turns red and
 * counts, so it is *louder* when it matters and quiet when it does not — which
 * inline could not be.
 *
 * Parked items are the only thing in this app that need a person. Everything
 * else the outbox holds is a normal delay and needs no attention at all.
 */
export function SyncQueueScreen({ navigation }: Props) {
  const { pending, parked, bufferedPings, dismissParked, sync, online } = useSync();

  return (
    <Screen>
      <ScreenHeader
        title="Updates & sync"
        subtitle={online ? null : 'No connection'}
        onBack={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Card>
          <Row label="Connection" value={online ? 'Online' : 'No connection'} />
          <Row label="Updates waiting" value={String(pending)} />
          <Row label="GPS points waiting" value={String(bufferedPings)} />

          <View style={styles.action}>
            <Button label="Try to send now" tone="neutral" onPress={() => void sync()} />
          </View>
        </Card>

        <Text style={styles.sectionTitle}>Needs your attention</Text>

        {parked.length === 0 ? (
          <Empty message="Nothing is stuck." />
        ) : (
          parked.map((item) => (
            <ParkedCard key={item.id} item={item} onDismiss={() => void dismissParked(item.id)} />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

function ParkedCard({ item, onDismiss }: { item: OutboxItem; onDismiss: () => void }) {
  const confirm = () => {
    Alert.alert(
      'Discard this?',
      'It will not be sent. Tell the office first if it matters.',
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onDismiss },
      ],
    );
  };

  return (
    <Card style={styles.parked}>
      <Text style={styles.parkedTitle}>{describe(item)}</Text>
      <Text style={styles.meta}>{item.lastErrorMessage}</Text>
      {/* The payload verbatim. This is what the driver reads to the office. */}
      <Text style={styles.payload}>{JSON.stringify(item.payload, null, 2)}</Text>
      <Button label="Discard" tone="neutral" onPress={confirm} />
    </Card>
  );
}

function describe(item: OutboxItem): string {
  if (item.kind === 'trip_transition') {
    return `Trip ${item.tripId} — ${item.targetStatus?.replace(/_/g, ' ')}`;
  }

  return item.kind === 'availability_request' ? 'Time-off request' : 'Withdrawing a request';
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.meta}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  meta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  sectionTitle: {
    ...typography.heading,
    color: colors.text,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  rowValue: {
    ...typography.label,
    color: colors.text,
  },
  action: {
    marginTop: spacing.sm,
  },
  parked: {
    borderColor: colors.danger,
  },
  parkedTitle: {
    ...typography.label,
    color: colors.text,
  },
  payload: {
    ...typography.caption,
    fontFamily: 'monospace',
    color: colors.textMuted,
    backgroundColor: colors.background,
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginVertical: spacing.sm,
  },
});
