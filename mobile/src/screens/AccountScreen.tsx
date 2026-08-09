import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { useSync } from '../offline/SyncProvider';
import type { OutboxItem } from '../offline/outboxTypes';
import { Button, Card, Empty, Screen } from '../ui/components';
import { SyncBanner } from '../ui/SyncBanner';
import { colors, spacing, typography } from '../ui/theme';
import type { AccountStackParams } from '../navigation/types';

type Props = NativeStackScreenProps<AccountStackParams, 'AccountHome'>;

/**
 * The account, and — more importantly — the parked queue.
 *
 * Parked items are the one thing in this app that need a person, so they get a
 * screen rather than a toast. ADR-0023 §6: an item that cannot be sent keeps
 * its payload and is shown, never dropped. A driver whose closing odometer was
 * refused has to be able to read the number back to the office over the phone,
 * which means it has to still be here.
 */
export function AccountScreen({ navigation }: Props) {
  const { user, signOut } = useAuth();
  const { pending, parked, bufferedPings, dismissParked, sync, online } = useSync();

  const confirmSignOut = () => {
    const warning =
      pending > 0
        ? `${pending} ${pending === 1 ? 'update is' : 'updates are'} still waiting to send. They stay on this phone and will go out when you sign in again.`
        : 'You will need your password to sign back in.';

    Alert.alert('Sign out?', warning, [
      { text: 'Stay signed in', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  return (
    <Screen>
      <SyncBanner />

      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={styles.name}>{user?.name ?? 'Driver'}</Text>
          <Text style={styles.meta}>{user?.email}</Text>
          <Text style={styles.meta}>{user?.role_label}</Text>
          <View style={styles.action}>
            {/* Accounts arrive with a password an administrator typed into a
                console (ADR-0016). This is the only way it becomes theirs. */}
            <Button
              label="Change password"
              tone="neutral"
              onPress={() => navigation.navigate('ChangePassword')}
            />
          </View>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Sync</Text>
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

        <View style={styles.action}>
          <Button label="Sign out" tone="danger" onPress={confirmSignOut} />
        </View>
      </ScrollView>
    </Screen>
  );
}

function ParkedCard({ item, onDismiss }: { item: OutboxItem; onDismiss: () => void }) {
  const confirm = () => {
    Alert.alert(
      'Discard this?',
      'It will not be sent. Read the details to the office first if they matter.',
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
    <View style={styles.row}>
      <Text style={styles.meta}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.md,
    gap: spacing.md,
  },
  name: {
    ...typography.heading,
    color: colors.text,
  },
  meta: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
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
    borderRadius: 8,
    marginVertical: spacing.sm,
  },
});
