import { StyleSheet, Text, View } from 'react-native';

import { useSync } from '../offline/SyncProvider';
import { colors, spacing, typography } from './theme';

/**
 * The one thing this strip still says: the phone cannot save anything.
 *
 * ## What was removed, and on whose decision
 *
 * Until 2026-08-28 this reported the whole queue — updates waiting, GPS
 * points buffered, no connection, and a red band for anything parked. The
 * owner asked for it silenced, was shown what that costs, and chose it. The
 * decision is theirs; the cost is written down here so nobody rediscovers it
 * as a mystery:
 *
 * - **AGENTS.md's "show sync state clearly" is no longer met by any screen.**
 * - A driver whose completion never reached the office now has **no
 *   on-screen sign of it**. The removed docblock's warning is worth keeping
 *   in view: a queue that hides itself is indistinguishable from one that has
 *   lost the work, and a driver who cannot tell will re-enter the reading on
 *   paper.
 *
 * **Nothing was deleted, only quietened.** `SyncProvider` still queues,
 * drains, parks and reports a parked item to Sentry exactly as before, and
 * Profile → Updates & sync still lists every held and parked item with a
 * Discard on each. The information moved out of the driver's face; it did not
 * go away. The old wording — each sentence of it arrived at on a handset — is
 * in git if this is ever reinstated.
 *
 * ## Why the storage failure is still shown
 *
 * Because it is not a sync status — it is an instruction. When the phone's
 * own storage will not open, *every* trip button is about to refuse, and this
 * sentence is the difference between that reading as "broken app" and being
 * something a driver can act on. Silencing it too would leave them tapping
 * controls that fail with no explanation anywhere in the app.
 *
 * That is a judgement, not an instruction I was given. Say so if it should go
 * as well — it is a one-line change.
 */
export function SyncBanner() {
  const { storageFailed } = useSync();

  if (!storageFailed) {
    return null;
  }

  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: colors.danger }]}>
      <Text style={[styles.text, { color: colors.onPrimary }]}>
        This phone&apos;s offline storage could not be opened. Trip updates cannot be saved —
        restart the app, and report it if this keeps happening.
      </Text>
    </View>
  );
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
