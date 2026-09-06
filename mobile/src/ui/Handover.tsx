import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { usePulse } from './Skeleton';
import { useReducedMotion } from './motion';
import { RouteIcon } from './icons';
import { colors, motion, radius, spacing, typography } from './theme';

/**
 * The moment between two legs of a job.
 *
 * A driver accepts, and the app has two things to do before the drive means
 * anything: find out who it is and find the road to them. This is what stands
 * there while that happens — and, at the far end, while the map hands over
 * from the approach to the passenger's own journey.
 *
 * ## It is a report, not a loading screen
 *
 * Every line it shows is bound to a request genuinely in flight; `useHandover`
 * in `trips/handover.ts` owns that rule and the argument for it, including why
 * a warm cache never sees this surface at all. **Nothing here is on a timer**,
 * which is what keeps it clear of `docs/screen-rules.md` §1 — a sentence the
 * app is not doing is a fabricated value like any other.
 *
 * ## Why a rail rather than a spinner
 *
 * The same argument `Skeleton` makes: a spinner says *something is happening*
 * and stops there. A driver in a cradle, glancing up, wants to know whether
 * this is nearly over or has stalled, and a rail of known length answers that
 * while a rotating circle cannot. The steps behind the current one are filled
 * — they really are done — so the surface reports progress rather than
 * performing it.
 *
 * A rail also degrades honestly. One step is one bar, and that reads as *this
 * is the only thing left*, which at the arrival seam is exactly true.
 *
 * ## The motion, and the reason it is allowed
 *
 * §5 forbids decoration on a high-frequency surface. Two things run here and
 * both carry meaning: the active bar pulses — the shared `usePulse`, the same
 * rhythm every placeholder in the app uses — because a still rail on a dead
 * connection is indistinguishable from one that has stopped; and the surface
 * fades in over `motion.enter` because a full screen appearing instantly under
 * a driver's eyes reads as the app having crashed into something else.
 *
 * Under reduced motion the pulse holds at the bright end and the entrance is
 * immediate. Gentler, not absent: the words and the rail are unchanged, and
 * they were always the part carrying the meaning.
 *
 * ## What it does not say
 *
 * No minutes, no percentage, no "almost there". ADR-0020 §3 and ADR-0031 §6
 * both refuse a duration the platform has not been given, and a progress bar
 * that fills at a rate somebody chose is the same lie in a friendlier shape.
 */
export function Handover({
  label,
  caption,
  step,
  total,
}: {
  /** What is happening now. One short clause, in the driver's words. */
  label: string;
  /**
   * Who or where, when the platform knows it yet.
   *
   * Null on the opening step deliberately — the passenger's name arrives with
   * the trip, and this surface is often on screen precisely because it has not
   * (ADR-0024 §7 releases the name on the accept, not before the fetch).
   */
  caption: string | null;
  /** Which step is being reported, zero-based. */
  step: number;
  /** How many steps this hand-over has. */
  total: number;
}) {
  const reduced = useReducedMotion();
  const pulse = usePulse();
  const entrance = useEntrance(reduced);

  return (
    <Animated.View
      style={[styles.screen, { opacity: entrance }]}
      // One announcement for the whole surface. A screen reader given a rail,
      // a heading and a caption separately reads three fragments; this is the
      // one sentence a driver needs, and it re-announces as the step changes
      // because the label is part of it.
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={caption === null ? label : `${label}. ${caption}`}
      // Said in words as well as position, per screen-rules §6 — the rail is
      // the only visual carrier of "how far through" and a rail is not
      // available to a screen reader.
      accessibilityValue={{ min: 1, max: total, now: step + 1 }}
    >
      <View style={styles.badge}>
        {/*
          Static. DESIGN.md §7: a glyph a driver meets hundreds of times a day
          never animates, and the pulse below already says the app is working.
        */}
        <RouteIcon color={colors.primary} size={26} strokeWidth={2} />
      </View>

      <Text style={styles.label}>{label}</Text>

      {caption !== null && <Text style={styles.caption}>{caption}</Text>}

      {/*
        Hidden from the screen reader: the container above already states the
        step and the total, and a row of unlabelled views linearises into
        noise — the lesson `Skeleton` records about placeholder blocks.
      */}
      <View style={styles.rail} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {Array.from({ length: total }, (_, index) => (
          <Animated.View
            key={index}
            style={[
              styles.bar,
              // Reached, whether finished or happening — the rail's filled
              // length is how far through the job is.
              index <= step && styles.barFilled,
              // Only the step actually happening pulses. Pulsing the finished
              // ones would say they are still running, and pulsing the whole
              // rail would say nothing at all. This is also the only thing
              // separating the active bar from a done one, which is fine
              // here and nowhere else: the label above names the live step in
              // words, so no meaning rests on the motion alone (§6).
              index === step ? { opacity: pulse } : null,
            ]}
          />
        ))}
      </View>
    </Animated.View>
  );
}

/**
 * The fade in, or nothing at all when the phone asks for less motion.
 *
 * Opacity only — screen-rules §5 — and `useNativeDriver`, because this runs
 * while the JS thread is parsing the very response the surface stands in for.
 *
 * There is no fade *out*. The surface is unmounted by its screen the moment
 * the work lands, and holding a finished job behind a dissolve is the one
 * thing a driver waiting on this screen would actually be charged for.
 */
function useEntrance(reduced: boolean): Animated.Value | number {
  const [value] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduced) {
      value.setValue(1);

      return undefined;
    }

    const animation = Animated.timing(value, {
      toValue: 1,
      duration: motion.enter,
      easing: motion.easeOut,
      useNativeDriver: true,
    });

    animation.start();

    return () => animation.stop();
  }, [reduced, value]);

  return reduced ? 1 : value;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  badge: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryTint,
  },
  label: {
    ...typography.heading,
    color: colors.text,
    textAlign: 'center',
  },
  caption: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    // Pulled up against the label: the two are one statement — what is
    // happening, and who it is about — and the container gap reads them as
    // two unrelated lines.
    marginTop: -spacing.sm,
  },
  rail: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
    // Narrow enough that the bars stay legible as *steps* rather than
    // stretching into a progress bar, which would imply a rate.
    width: 148,
  },
  bar: {
    flex: 1,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  barFilled: {
    backgroundColor: colors.primary,
  },
});
