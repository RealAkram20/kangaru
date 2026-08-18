import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, MIN_TOUCH_HEIGHT, radius, spacing, typography } from '../ui/theme';
import { useDutyToggle } from './useDutyToggle';

/**
 * On duty or off, and the one control that decides whether this driver exists
 * to the matcher at all (ADR-0024 §2).
 *
 * ## Why it says "dispatchable" and not just "on"
 *
 * A driver can be on duty and still be invisible: their last position may
 * have gone stale in a basement, past `dispatch.presence_ttl_seconds`. The
 * server computes that and serves it, and this shows the server's answer
 * rather than the toggle's position.
 *
 * The alternative — showing the switch and nothing else — produces the worst
 * bug this feature can have in the field: a driver sitting for an hour under
 * a green light, certain the platform is ignoring them, with no way to tell
 * that their phone stopped reporting. Nothing appears broken. That is
 * precisely why it needs saying out loud.
 */
export function DutyBar() {
  /*
   * The act itself now lives in `useDutyToggle`, extracted when the drawer
   * grew its own Go Offline button (AGENTS.md: if it appears twice it becomes
   * shared). **Nothing about the behaviour changed** — the permission prompt,
   * the vehicle travelling with the request, and the server's own refusal
   * wording all moved together, which was the point: the half a second copy
   * would have dropped is the permission, and its absence is invisible until a
   * driver signs on and never gets a job.
   */
  const { isLoading, onDuty, dispatchable, busy, refusal, toggle } = useDutyToggle();
  const setDuty = { isPending: busy };

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: onDuty, busy: setDuty.isPending }}
        accessibilityLabel={onDuty ? 'Go off duty' : 'Go on duty'}
        disabled={setDuty.isPending || isLoading}
        onPress={() => void toggle()}
        style={({ pressed }) => [
          styles.bar,
          onDuty ? styles.barOn : styles.barOff,
          pressed && styles.barPressed,
        ]}
      >
        <View style={styles.textColumn}>
          <Text style={styles.title}>{onDuty ? 'On duty' : 'Off duty'}</Text>
          <Text style={styles.subtitle}>{subtitleFor(onDuty, dispatchable, setDuty.isPending)}</Text>
        </View>

        {/*
          A dot, not a switch graphic. The whole bar is the target — a
          44pt-high strip is far easier to hit at arm's length in a cradle
          than a toggle at one end of it, and this is the control a driver
          uses with a thumb while doing something else.
        */}
        <View style={[styles.dot, onDuty && dispatchable && styles.dotLive, onDuty && !dispatchable && styles.dotWaiting]} />
      </Pressable>

      {refusal !== null && <Text style={styles.refusal}>{refusal}</Text>}
    </View>
  );
}

function subtitleFor(onDuty: boolean, dispatchable: boolean, busy: boolean): string {
  if (busy) {
    return 'Telling the office…';
  }

  if (!onDuty) {
    return 'Tap to start your shift and get jobs';
  }

  return dispatchable
    ? 'Jobs will come to this phone'
    : 'Waiting for a location fix — you may not get jobs yet';
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  bar: {
    minHeight: MIN_TOUCH_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  barOn: {
    backgroundColor: colors.successTint,
    borderColor: colors.success,
  },
  barOff: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  // Instant rather than animated, unlike `Button`. This control is a
  // commitment — starting or ending a shift — and the momentary flatness
  // reads as weight. A springy toggle would invite the idle tapping that
  // signs somebody on and straight back off.
  barPressed: { opacity: 0.85 },
  textColumn: { flex: 1, gap: 2 },
  title: { ...typography.label, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textMuted },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.border,
    marginLeft: spacing.md,
  },
  dotLive: { backgroundColor: colors.success },
  // Amber, not green: on duty but not yet findable. The distinction is the
  // whole reason this component reads `dispatchable` from the server.
  dotWaiting: { backgroundColor: colors.warning },
  refusal: {
    ...typography.caption,
    color: colors.warning,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
});