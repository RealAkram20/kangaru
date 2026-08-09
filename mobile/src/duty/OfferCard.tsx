import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import type { DispatchOffer } from '../api/types';
import { isRunningOut, secondsRemaining } from './countdown';
import { Button } from '../ui/components';
import { colors, radius, spacing, typography } from '../ui/theme';

/**
 * A job, with a clock on it (ADR-0024 §3).
 *
 * This is the most time-pressured surface in the app: fifteen seconds, one
 * decision, usually taken with the phone in a cradle and the engine running.
 * Everything below is in service of that.
 */
export function OfferCard({
  offer,
  onAccept,
  onDecline,
  busy,
}: {
  offer: DispatchOffer;
  onAccept: () => void;
  onDecline: () => void;
  busy: boolean;
}) {
  const remaining = useCountdown(offer);
  const entry = useEntrance();

  return (
    <Animated.View
      style={[
        styles.card,
        {
          opacity: entry,
          transform: [
            {
              // From 0.96, never from 0. Nothing in the world appears out of
              // nothing, and a card that grows from a point reads as a
              // gimmick rather than as a job arriving.
              scale: entry.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }),
            },
          ],
        },
      ]}
      accessibilityLiveRegion="assertive"
      accessibilityLabel={`New job. ${offer.pickup.label ?? 'Pickup'}. ${remaining} seconds to answer.`}
    >
      <CountdownBar offer={offer} />

      <View style={styles.header}>
        <Text style={styles.eyebrow}>NEW JOB</Text>
        {/*
          A number, not just the bar. The bar is glanceable and the number is
          checkable, and under time pressure a driver wants both — the bar
          answers "how urgent" from the corner of an eye, the number answers
          "can I finish this sentence first".
        */}
        <Text style={[styles.seconds, isRunningOut(remaining) && styles.secondsUrgent]}>{remaining}s</Text>
      </View>

      <Text style={styles.pickup} numberOfLines={2}>
        {offer.pickup.label ?? 'Pickup'}
      </Text>

      {offer.dropoff.label !== null && (
        <Text style={styles.dropoff} numberOfLines={1}>
          to {offer.dropoff.label}
        </Text>
      )}

      {offer.pickup_distance_km !== null && (
        // The single most useful fact when deciding, so it gets its own line
        // rather than being buried in `reasons`. "Straight-line" is said
        // plainly: ADR-0020 ranks by great-circle distance and promises no
        // ETA, and a driver who reads this as road distance will be late.
        <Text style={styles.distance}>
          {offer.pickup_distance_km.toFixed(1)} km away, straight line
        </Text>
      )}

      <View style={styles.actions}>
        {/*
          Decline first in source order but second on screen, and Accept is
          the wide one. The two are not equal choices: accepting is what the
          driver opened the app for, and a mis-tap that declines costs them a
          fare and the passenger another wait.
        */}
        <View style={styles.declineSlot}>
          <Button label="No" tone="neutral" onPress={onDecline} disabled={busy} />
        </View>
        <View style={styles.acceptSlot}>
          <Button label="Accept" onPress={onAccept} busy={busy} />
        </View>
      </View>
    </Animated.View>
  );
}

/**
 * Seconds left, counted from the server's number.
 *
 * **Seeded from `expires_in_seconds`, not from `expires_at` minus the local
 * clock.** Cheap Android handsets routinely run minutes out, and a countdown
 * against a wrong clock either shows forty seconds on a fifteen-second offer
 * or shows a job that already expired. The server counted the gap on one
 * clock; that number is trustworthy in a way a difference between two clocks
 * is not.
 *
 * The interval only ever counts down locally, so drift within a single
 * fifteen-second offer is irrelevant.
 */
function useCountdown(offer: DispatchOffer): number {
  // Seeded once, from the server's count, and then counted down locally.
  //
  // Deliberately *not* re-seeded on every poll. The offer's expiry is fixed,
  // so a local decrement is accurate over a fifteen-second window, and
  // re-seeding would mean writing state from inside an effect on every poll —
  // a cascading render each time, for a number that was already right.
  //
  // A genuinely different offer is a different `key` in the list, so React
  // remounts this and the initialiser runs again.
  // Seconds *since this offer arrived*, not a clock reading. The arithmetic
  // that turns it into a countdown lives in `./countdown`, where it is
  // covered by tests that cannot be broken by a concurrent renderer.
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed((seconds) => seconds + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [offer.id]);

  return secondsRemaining(offer, elapsed);
}

/**
 * The draining bar.
 *
 * `linear`, because it represents constant motion — time. Any easing here
 * would be a lie about how fast the clock is running, and the one at the end
 * matters most: an ease-out bar appears to stop before the offer does.
 *
 * `scaleX` on the native driver rather than an animated `width`. Width is a
 * layout property and animating it re-runs layout sixty times a second on the
 * JS thread — which is the thread also handling the poll and the accept.
 */
function CountdownBar({ offer }: { offer: DispatchOffer }) {
  const [progress] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const seconds = Math.max(0, offer.expires_in_seconds);

    progress.setValue(1);

    const animation = Animated.timing(progress, {
      toValue: 0,
      duration: seconds * 1000,
      easing: Easing.linear,
      useNativeDriver: true,
    });

    animation.start();

    return () => animation.stop();
  }, [offer.id, offer.expires_in_seconds, progress]);

  return (
    <View style={styles.barTrack}>
      <Animated.View
        style={[
          styles.barFill,
          {
            // Anchored left so it drains towards the edge it started from,
            // rather than shrinking towards its middle from both ends.
            transform: [{ scaleX: progress }],
          },
        ]}
      />
    </View>
  );
}

/**
 * The card's arrival: 200ms, ease-out, opacity and scale together.
 *
 * Under 300ms because this is UI rather than explanation, and ease-out
 * because the card is entering — it should be at its destination almost
 * immediately and settle, not creep in. An ease-in here would waste the first
 * eighty milliseconds of a fifteen-second decision.
 */
function useEntrance(): Animated.Value {
  const [value] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(value, {
      toValue: 1,
      duration: 200,
      easing: Easing.bezier(0.23, 1, 0.32, 1),
      useNativeDriver: true,
    }).start();
  }, [value]);

  return value;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.primary,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  barFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    // Full width, then scaled down. Scaling from the left edge needs the view
    // to already be its final size.
    width: '100%',
    transform: [{ scaleX: 1 }],
    alignSelf: 'flex-start',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eyebrow: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    letterSpacing: 1,
  },
  seconds: {
    ...typography.heading,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  secondsUrgent: {
    // Colour only in the last five seconds, and no flashing. A driver holding
    // a steering wheel does not need an alarm; they need to know the number
    // is small. Motion here would compete with the bar that is already moving.
    color: colors.warning,
  },
  pickup: {
    ...typography.heading,
    color: colors.text,
  },
  dropoff: {
    ...typography.body,
    color: colors.textMuted,
  },
  distance: {
    ...typography.caption,
    color: colors.textMuted,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  declineSlot: { flex: 1 },
  acceptSlot: { flex: 2 },
});