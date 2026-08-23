import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { TripStop } from '../api/types';
import { CheckIcon, MapPinIcon } from '../ui/icons';
import { colors, radius, spacing, typography } from '../ui/theme';
import { inRunOrder } from './stops';

/**
 * The run's itinerary, as a worklist (ADR-0045).
 *
 * Deliberately not an extension of `RouteRail`: the rail states the two ends
 * of a job and is read at a standstill; this is the middle of the job — rows
 * with state, one of which carries the day's most important button. The
 * earlier decision not to widen `RouteRail` for multi-point stands.
 *
 * ## What each row says, and why in words
 *
 * Status is carried by a word beside the glyph — "Visited", "You're here",
 * "Next" — never by colour alone (DESIGN.md §8, and the colour-blind drivers
 * `RouteRail`'s own comment counts). Rows are numbered by `sequence`, which
 * is the server's order and the only order (§7: nothing reorders a circuit).
 *
 * ## The Arrived button
 *
 * One per list, on the first pending stop, only while the trip is moving —
 * arriving *is* the pause (§2), so a paused trip has nowhere to arrive from.
 * It queues `waiting` with the stop's id through the same outbox as every
 * other transition; in a dead zone the tap still lands and drains later.
 * 52pt, because it posts a state transition (docs/screen-rules.md §6).
 */
export function StopList({
  stops,
  destination,
  canArrive,
  busy,
  onArrive,
}: {
  stops: readonly TripStop[];
  /** The trip's own drop-off — the terminal row, after every stop. */
  destination: string;
  /** False while paused: arriving is the pause, so there is nowhere to arrive from. */
  canArrive: boolean;
  busy: boolean;
  onArrive: (stop: TripStop) => void;
}) {
  const ordered = inRunOrder(stops);
  const nextId = ordered.find((stop) => stop.status === 'pending')?.id ?? null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Route</Text>

      {ordered.map((stop) => {
        const isNext = stop.id === nextId;

        return (
          <View key={stop.id} style={styles.row}>
            <View style={[styles.glyph, isNext && styles.glyphNext]}>
              {stop.status === 'done' ? (
                <CheckIcon color={colors.textMuted} size={16} strokeWidth={2} />
              ) : (
                <MapPinIcon
                  color={isNext || stop.status === 'arrived' ? colors.primaryText : colors.textMuted}
                  size={16}
                  strokeWidth={2}
                />
              )}
            </View>

            <View style={styles.text}>
              <Text
                style={[styles.label, stop.status === 'done' && styles.labelDone]}
                numberOfLines={2}
              >
                {stop.sequence}. {stop.label}
              </Text>
              {stopCaption(stop, isNext) !== null && (
                <Text style={styles.caption}>{stopCaption(stop, isNext)}</Text>
              )}
            </View>

            {isNext && canArrive && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Arrived at ${stop.label}`}
                disabled={busy}
                onPress={() => onArrive(stop)}
                style={({ pressed }) => [styles.arrive, pressed && styles.arrivePressed]}
              >
                <Text style={styles.arriveLabel}>Arrived</Text>
              </Pressable>
            )}
          </View>
        );
      })}

      <View style={styles.row}>
        <View style={styles.glyph}>
          <MapPinIcon color={colors.danger} size={16} strokeWidth={2} />
        </View>
        <View style={styles.text}>
          <Text style={styles.label} numberOfLines={2}>
            {destination}
          </Text>
          <Text style={styles.caption}>Final drop-off</Text>
        </View>
      </View>
    </View>
  );
}

/**
 * The status, in words. Null on a later pending stop — its turn will come,
 * and a column of identical captions is noise, not information.
 */
function stopCaption(stop: TripStop, isNext: boolean): string | null {
  if (stop.status === 'done') {
    return 'Visited';
  }

  if (stop.status === 'arrived') {
    return "You're here";
  }

  if (stop.status === 'skipped') {
    return 'Skipped';
  }

  return isNext ? 'Next' : null;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  title: {
    ...typography.captionStrong,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  glyph: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphNext: {
    backgroundColor: colors.primaryTint,
  },
  text: {
    flex: 1,
  },
  label: {
    ...typography.body,
    color: colors.primaryText,
  },
  labelDone: {
    color: colors.textMuted,
  },
  caption: {
    ...typography.caption,
    color: colors.textMuted,
  },
  arrive: {
    height: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryCta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrivePressed: {
    opacity: 0.85,
  },
  arriveLabel: {
    ...typography.captionStrong,
    color: colors.onPrimary,
  },
});
