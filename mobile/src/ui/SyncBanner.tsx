import { StyleSheet, Text, View } from 'react-native';

import { useSync } from '../offline/SyncProvider';
import { colors, spacing, typography } from './theme';

/**
 * The permanent, honest statement of what the app is still holding.
 *
 * AGENTS.md requires trip capture to "show sync state clearly", and this is
 * where a driver finds out whether the completion they typed twenty minutes
 * ago has actually reached the office. Silence is the wrong default: a queue
 * that hides itself is indistinguishable from one that has lost the work, and
 * a driver who cannot tell will re-enter the reading on paper.
 *
 * Nothing renders when there is nothing to say and the connection is fine —
 * a permanent green tick trains people to ignore the strip that later turns
 * red.
 */
export function SyncBanner() {
  const { online, pending, parked, bufferedPings } = useSync();

  if (online && pending === 0 && parked.length === 0 && bufferedPings === 0) {
    return null;
  }

  const tone = parked.length > 0 ? colors.danger : online ? colors.surfaceSunken : colors.offline;

  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: tone }]}>
      <Text style={styles.text}>{summarise({ online, pending, parked: parked.length, bufferedPings })}</Text>
    </View>
  );
}

function summarise({
  online,
  pending,
  parked,
  bufferedPings,
}: {
  online: boolean;
  pending: number;
  parked: number;
  bufferedPings: number;
}): string {
  if (parked > 0) {
    return `${parked} ${parked === 1 ? 'item needs' : 'items need'} your attention — open Account to see ${parked === 1 ? 'it' : 'them'}.`;
  }

  const held: string[] = [];

  if (pending > 0) {
    held.push(`${pending} ${pending === 1 ? 'update' : 'updates'}`);
  }

  if (bufferedPings > 0) {
    held.push(`${bufferedPings} GPS ${bufferedPings === 1 ? 'point' : 'points'}`);
  }

  if (!online) {
    return held.length === 0
      ? 'No connection. Your work is saved on this phone.'
      : `No connection. ${held.join(' and ')} saved on this phone, waiting to send.`;
  }

  return held.length === 0 ? 'Connected.' : `Sending ${held.join(' and ')}…`;
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  text: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.primaryText,
  },
});
