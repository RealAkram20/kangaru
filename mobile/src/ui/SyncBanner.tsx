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
  const { online, pending, parked, bufferedPings, stalled, storageFailed } = useSync();

  // The one failure that outranks everything else on this strip: the phone's
  // own storage would not open, so nothing a driver does can be saved for
  // later. Every trip button on the app is about to refuse — this sentence is
  // the difference between that reading as "broken app" and being an
  // instruction.
  if (storageFailed) {
    return (
      <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: colors.danger }]}>
        <Text style={[styles.text, { color: colors.onPrimary }]}>
          This phone&apos;s offline storage could not be opened. Trip updates cannot be saved —
          restart the app, and report it if this keeps happening.
        </Text>
      </View>
    );
  }

  if (online && pending === 0 && parked.length === 0 && bufferedPings === 0) {
    return null;
  }

  // A stalled queue takes the amber band, not the quiet grey one. The grey is
  // for "this is in hand"; a queue that has not moved in half a minute is the
  // same practical situation as no coverage, and it earns the same colour —
  // the words below are what tell the two apart.
  const tone =
    parked.length > 0
      ? colors.danger
      : online && !stalled
        ? colors.surfaceSunken
        : colors.offline;

  // The ink follows the ground. This was `primaryText` — dark green — on
  // every tone, which on the red "needs your attention" band and the amber
  // "no connection" band was green on red: the one banner that exists to be
  // read, unreadable exactly when it had something to say. Seen on a handset
  // over the home screen. `docs/screen-rules.md` §6: never carry meaning by
  // colour alone, and never make the words themselves the casualty of it.
  const ink = tone === colors.surfaceSunken ? colors.primaryText : colors.onPrimary;

  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: tone }]}>
      <Text style={[styles.text, { color: ink }]}>
        {summarise({ online, pending, parked: parked.length, bufferedPings, stalled })}
      </Text>
    </View>
  );
}

function summarise({
  online,
  pending,
  parked,
  bufferedPings,
  stalled,
}: {
  online: boolean;
  pending: number;
  parked: number;
  bufferedPings: number;
  stalled: boolean;
}): string {
  if (parked > 0) {
    // Named for where they actually are: Profile → Updates & sync. "Open
    // Account" was the row's old home, and a banner that sends a driver to a
    // place that no longer holds the thing is a banner they stop reading.
    return `${parked} ${parked === 1 ? 'item needs' : 'items need'} your attention — see Updates & sync in your Profile.`;
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

  /*
    Online, and getting nowhere.

    "Sending 3 updates…" is a claim of progress, and a driver who reads it
    concludes the office has their work — which is the one thing this banner
    exists to stop them believing wrongly. The owner's screenshot showed that
    sentence over a count that climbed from 1 to 3 while the API was down and
    nothing had moved in either direction.

    The phone is deliberately not blamed. It *has* signal, which the driver can
    see, and telling them otherwise sends them looking for a mast. What has
    gone is the office, and the sentence says so and then says the thing that
    actually matters: the work is not lost.
  */
  if (stalled && held.length > 0) {
    return `Can't reach the office. ${held.join(' and ')} saved on this phone, still trying.`;
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
  },
});
