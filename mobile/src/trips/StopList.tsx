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
  extensions = [],
  nextId,
  canArrive,
  busy,
  onArrive,
}: {
  stops: readonly TripStop[];
  /** The trip's own drop-off — the terminal row, after every *stop*. */
  destination: string;
  /**
   * Places the passenger asked to be taken on to, **after** the drop-off.
   *
   * A separate prop rather than more rows in `stops`, because they belong on
   * the other side of the destination and a single ordered list cannot say
   * that. Rendering them among the stops pointed a driver at an extension
   * before the place they were hired to reach — found on a handset, not in a
   * test.
   */
  extensions?: readonly TripStop[];
  /**
   * The leg the driver is heading for, or null when that is the drop-off
   * itself.
   *
   * **Passed in rather than worked out here.** This list used to take the
   * first pending stop, which stopped being the right answer once extensions
   * shared the table: they sort by `sequence` like a stop but belong after
   * the destination. `nextPlace` is the one place that decision is made, and
   * the map pin, the drop-off row and this list all read it — so they cannot
   * point three ways, which they did on a handset.
   */
  nextId: number | null;
  /** False while paused: arriving is the pause, so there is nowhere to arrive from. */
  canArrive: boolean;
  busy: boolean;
  onArrive: (stop: TripStop) => void;
}) {
  const ordered = inRunOrder(stops);

  /**
   * One row, used for both halves of the journey.
   *
   * **Extensions were rendered by a second, simpler loop and it trapped a
   * driver.** They had no Arrived control, so an accepted extension could
   * never be marked done — and `End trip` refuses while one is outstanding.
   * The owner hit it: *"i can not end the trip"*, with no way forward on the
   * screen at all. One row for both is what makes that impossible to
   * reintroduce.
   */
  const leg = (stop: TripStop, label: string) => {
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
            {label}
          </Text>
          {caption(stop, isNext) !== null && (
            <Text style={styles.caption}>{caption(stop, isNext)}</Text>
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
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Route</Text>

      {ordered.map((stop) => leg(stop, `${stop.sequence}. ${stop.label}`))}

      <View style={styles.row}>
        <View style={styles.glyph}>
          <MapPinIcon color={colors.danger} size={16} strokeWidth={2} />
        </View>
        <View style={styles.text}>
          <Text style={styles.label} numberOfLines={2}>
            {destination}
          </Text>
          <Text style={styles.caption}>
            {extensions.length > 0 ? 'Agreed drop-off' : 'Final drop-off'}
          </Text>
        </View>
      </View>

      {/*
        After the drop-off, because that is where they happen — and through
        the same row, so they carry the same Arrived control. The caption
        above changes with them: "Final" stops being true the moment the
        passenger has asked to be carried on.

        No `sequence` in the label. It is 1-based over the whole table, so an
        extension on a walk-in reads "1." while sitting *below* the
        destination — a number that contradicts its own position.
      */}
      {extensions.map((extension) => leg(extension, extension.label))}
    </View>
  );
}
/**
 * The status, in words. Null on a later pending stop — its turn will come,
 * and a column of identical captions is noise, not information.
 */
function caption(stop: TripStop, isNext: boolean): string | null {
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
