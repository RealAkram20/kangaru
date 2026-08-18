import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useDuty, useSetDuty } from '../duty/queries';
import type { TripsStackParams } from '../navigation/types';
import {
  collectNow,
  confirmationNote,
  earningsAnnouncement,
  earningsRows,
  primaryAction,
  settlementDifferenceNote,
  type EarningsRow,
} from '../trips/completion';
import { useDriverStats, useTrip } from '../trips/queries';
import { walletNote, walletValue } from '../trips/statsPresentation';
import { Button, Notice, Screen, ScreenHeader } from '../ui/components';
import { CheckIcon, HandCoinsIcon, WalletIcon } from '../ui/icons';
import { SettlementSheet } from '../wallet/SettlementSheet';
import { kindAction } from '../wallet/settlement';
import { SyncBanner } from '../ui/SyncBanner';
import { colors, motion, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<TripsStackParams, 'RideComplete'>;

/**
 * The moment a trip ends: what it was worth, and where the driver goes next.
 *
 * Pushed by `OdometerScreen` when the closing reading is queued — **not a
 * route on `TripStatus`.** `trip_completed` still belongs to
 * `TripDetailScreen`, and `docs/agent-worklog.md` holds that map. The split is
 * deliberate: this is the *moment*, read once, and `TripDetailScreen` is the
 * *record*, read any time afterwards. Routing the status here would mean
 * opening a ride from last Tuesday and being congratulated for it.
 *
 * ## What the mockup asked for, and what it gets instead
 *
 * The mockup's money card read Fare `12,500`, Tip `+2,000`, Your earnings
 * `14,500`, Platform fee `-2,000`, Total `12,500`. Five rows, four problems,
 * and they were raised before any of this was written:
 *
 * - **No tip.** The concept does not exist on this platform — not a column,
 *   not an `InvoiceLineType`, not a `LedgerEntryKind`, not a field on the
 *   public order form. `docs/screen-rules.md` §1 in its purest form.
 * - **The arithmetic does not close.** It adds a tip, calls the sum
 *   "earnings", subtracts a fee, and lands back on the fare it started from.
 * - **It labels the gross fare as the driver's earnings**, which overstates
 *   their income by the whole commission. `FareEstimate`'s docblock was
 *   written to prevent exactly this confusion.
 * - **2,000 is not the platform's cut of 12,500.** The rate is 20%, so it
 *   would be 2,500 — and the screen does not say "20%" either, because the
 *   rate is a runtime setting and a handset that printed it would go on
 *   printing the old one after the office changed it.
 *
 * What is here instead reconciles by construction: the fare the passenger
 * paid, the fee, and what is left — all three read back from the ADR-0029
 * ledger entry that recorded the credit, with the fee derived server-side as
 * `gross - earned`. See `TripResource::driverEarningsFor()`, which had to be
 * written because the figure existed in the database with no way out.
 *
 * **"Back Online" is a fiction as drawn** — completing a trip does not take a
 * driver off duty, so there is nothing to come back from. The button does the
 * honest version of that intent; see `primaryAction`.
 *
 * **"View Earnings" goes to the trip's record**, because no earnings screen
 * exists. A statement view over `driver_ledger_entries` is a real feature and
 * a real gap, and it is written up in the worklog rather than faked with a
 * button that lands nowhere.
 *
 * ## The state the mockup does not draw, and which a driver sees most
 *
 * Completion is queued through the outbox (ADR-0023), so at the instant this
 * screen mounts the server usually has not settled the fare — `earnings` is
 * null, and upcountry it may stay null for hours. The screen says the trip is
 * saved and will be sent, then fills in by itself when the flush invalidates
 * the cache. A screen that only knew how to draw the settled case would show
 * a driver nothing at all for their morning.
 */
export function RideCompleteScreen({ route, navigation }: Props) {
  const { tripId } = route.params;
  const { data: trip } = useTrip(tripId);
  const { data: stats } = useDriverStats();
  const { data: duty } = useDuty();
  const setDuty = useSetDuty();

  const rows = earningsRows(trip);
  const pending = confirmationNote(trip);
  // What the passenger owes at the kerb while the office measures the trip,
  // and — once it has — why what was taken may differ from what settled
  // (ADR-0045 §5).
  const collect = collectNow(trip);
  const difference = settlementDifferenceNote(trip);

  const onDuty = duty?.on_duty ?? false;
  const primary = primaryAction(onDuty);

  /**
   * Home, always — never `goBack()`.
   *
   * Behind this screen is the live-leg screen for a trip that has just ended.
   * Returning to it would offer an End trip button on a finished journey,
   * which 422s out of the outbox minutes later. Every exit from here resets
   * to the screen where the next job appears.
   */
  const [declaringTip, setDeclaringTip] = useState(false);

  // `TripsHome`, this stack's root. It was `Home`, which also named the tab
  // containing this stack — an ambiguity React Navigation warns about by name.
  const goHome = () => navigation.navigate('TripsHome');

  const finish = () => {
    if (primary.goesOnDuty) {
      // Not awaited, and not queued through the outbox. `useSetDuty` needs a
      // connection by design — a duty change that arrives twenty minutes late
      // puts a driver in the dispatch pool after they have gone home — and
      // blocking the exit on it would strand somebody with no signal on a
      // screen whose job is finished.
      setDuty.mutate({ onDuty: true });
    }

    goHome();
  };

  return (
    <Screen>
      <SyncBanner />

      <ScreenHeader title="Ride complete" subtitle={null} onBack={goHome} />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Celebration />

        {collect !== null && (
          <View
            style={styles.collect}
            accessible
            accessibilityLabel={`Collect ${collect.amount}. ${collect.note}`}
          >
            <Text style={styles.collectLabel}>Collect now</Text>
            <Text style={styles.collectAmount}>{collect.amount}</Text>
            <Text style={styles.collectNote}>{collect.note}</Text>
          </View>
        )}

        {difference !== null && <Notice tone="info" message={difference} />}

        {rows === null ? (
          <Notice tone="info" message={pending ?? ''} />
        ) : (
          <View style={styles.card} accessible accessibilityLabel={earningsAnnouncement(trip)}>
            {rows.map((row, index) => (
              <MoneyRow key={row.label} row={row} ruled={index === rows.length - 1} />
            ))}
          </View>
        )}

        <WalletCard value={walletValue(stats)} note={walletNote(stats)} pending={rows === null} />

        {/*
          Declaring a tip (ADR-0034 §1), and **this is the right moment for
          it**: the driver has just been handed the cash and knows whether
          they were. Asked later it needs a trip picker, and a picker is how a
          driver declares a tip against the wrong job.

          Deliberately *not* a prompt or a required step. Most trips carry no
          tip, and a screen that asks after every one is a screen whose
          question stops being read — the same argument that keeps the
          confirmation dialog off the hold control.
        */}
        <Button
          label={kindAction('tip')}
          tone="neutral"
          icon={<HandCoinsIcon color={colors.textBody} size={18} strokeWidth={2} />}
          onPress={() => setDeclaringTip(true)}
        />

        <View style={styles.actions}>
          <Button label={primary.label} onPress={finish} />
          <Button
            label="Trip details"
            tone="neutral"
            onPress={() => navigation.navigate('TripDetail', { tripId })}
          />
        </View>
      </ScrollView>

      {/* The trip is passed in rather than chosen, so the declaration can only
          ever be about the journey the driver just finished. */}
      {declaringTip && (
        <SettlementSheet kind="tip" tripId={tripId} onClose={() => setDeclaringTip(false)} />
      )}
    </Screen>
  );
}

/**
 * The tick, and the only animation on this screen.
 *
 * DESIGN.md §7 permits motion for "a tick on a completed verification" and
 * this is the one genuinely occasional moment in the app — a driver reaches
 * it a handful of times a day, at the end of a job, with nothing else moving.
 * It marks the transition from working to finished, which is the reason the
 * rules ask for.
 *
 * **The mockup's confetti is not here.** It is decoration with no reason
 * (`docs/screen-rules.md` §5), and it is fifty-odd animated views on a handset
 * that has been running GPS all day.
 *
 * From 0.85 and 0 opacity — never from `scale(0)`, because nothing in the
 * world appears out of nothing and a mark that pops into existence at full
 * size reads as a rendering glitch. Transform and opacity only, so it runs on
 * the UI thread while the outbox writes underneath it.
 *
 * Under reduced motion the scale is dropped and the fade kept: gentler, not
 * absent. A tick that blinks into existence is the jarring change the fade is
 * there to prevent.
 */
function Celebration() {
  const [value] = useState(() => new Animated.Value(0));
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Read before animating. The check is asynchronous on both platforms, so
    // the flag arrives a frame or two late — the same shape `OfferScreen`'s
    // entrance uses, and for the same reason.
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const animation = Animated.timing(value, {
      toValue: 1,
      duration: motion.enter,
      easing: motion.easeOut,
      useNativeDriver: true,
    });

    animation.start();

    return () => animation.stop();
  }, [value]);

  return (
    <View style={styles.celebration}>
      <Animated.View
        style={[
          styles.tick,
          {
            opacity: value,
            transform: reduceMotion
              ? []
              : [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
          },
        ]}
      >
        <CheckIcon size={46} color={colors.onPrimary} strokeWidth={3} />
      </Animated.View>

      {/* One announcement for the pair. Read separately, a decorative tick
          and a heading say the same thing twice. */}
      <View accessible accessibilityRole="header" accessibilityLabel="Great job. Ride completed.">
        <Text style={styles.headline}>Great job!</Text>
        <Text style={styles.subhead}>Ride completed</Text>
      </View>
    </View>
  );
}

/**
 * One line of the breakdown.
 *
 * The minus is drawn here rather than baked into the money string, and the
 * label carries the meaning either way — `walletValue`'s rule, applied to the
 * one row on this screen that subtracts. Tabular figures so the three amounts
 * form a column a driver can add up by eye.
 */
function MoneyRow({ row, ruled }: { row: EarningsRow; ruled: boolean }) {
  return (
    <View style={[styles.row, ruled && styles.rowRuled]}>
      <Text style={[styles.rowLabel, row.emphasis && styles.rowLabelStrong]}>{row.label}</Text>
      <Text style={[styles.rowValue, row.emphasis && styles.rowValueStrong]}>
        {row.sign === 'minus' ? '- ' : ''}
        {row.amount}
      </Text>
    </View>
  );
}

/**
 * The wallet, from `GET /me/stats`.
 *
 * **The figure has no sign and the sentence is not optional.** A negative
 * balance is the ordinary state for cash work (ADR-0029 §5), a minus in front
 * of money is easy to miss and silent about direction, and the first person to
 * read "UGX -4,500" on the home screen asked whether it was a bug.
 * `walletValue` renders the magnitude and `walletNote` says which way it runs;
 * the two must be rendered together, which is why this component takes both.
 *
 * ## Why `pending` exists, and what rendering the screen caught
 *
 * The balance is `SUM(amount_minor)` over the ledger, and **a trip the office
 * has not received yet is not in that sum.** So on the unconfirmed state this
 * figure is short by exactly the fare the driver is holding: finish a 12,500
 * cash ride with 4,500 already owed and the card says 4,500 when the truth is
 * 17,000. It is the same shape of staleness the home screen's tiles had, on
 * the one screen where the driver is looking straight at the cash in question.
 *
 * No test caught it, because every test asserted the figure the payload
 * carried — which was correct. It was visible the moment the two states were
 * rendered side by side.
 */
function WalletCard({ value, note, pending }: { value: string; note: string; pending: boolean }) {
  const caveat = pending ? 'Not counting this trip yet' : null;

  return (
    <View
      style={styles.wallet}
      accessible
      accessibilityLabel={`Wallet balance ${value}. ${note}.${caveat === null ? '' : ` ${caveat}.`}`}
    >
      <View style={styles.walletGlyph}>
        <WalletIcon color={colors.primaryText} size={20} strokeWidth={2} />
      </View>

      <View style={styles.walletText}>
        <Text style={styles.walletLabel}>Wallet balance</Text>
        <Text style={styles.walletNote}>{note}</Text>
        {caveat !== null && <Text style={styles.walletCaveat}>{caveat}</Text>}
      </View>

      <Text style={styles.walletValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  collect: {
    backgroundColor: colors.infoTint,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  collectLabel: {
    ...typography.label,
    color: colors.info,
  },
  collectAmount: {
    ...typography.title,
    color: colors.text,
  },
  collectNote: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 20,
  },
  body: {
    padding: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  celebration: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  tick: {
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: {
    ...typography.display,
    color: colors.text,
    textAlign: 'center',
  },
  subhead: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  /**
   * The rule sits above the last row, not under every one. It separates the
   * inputs from the result, which is the one distinction in the card that
   * carries meaning — a line between every pair would say they are all peers.
   */
  rowRuled: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowLabel: {
    ...typography.body,
    color: colors.textBody,
  },
  rowLabelStrong: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  rowValue: {
    ...typography.bodyStrong,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  rowValueStrong: {
    ...typography.heading,
    color: colors.primaryText,
    fontVariant: ['tabular-nums'],
  },
  wallet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  walletGlyph: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletText: {
    flex: 1,
  },
  walletLabel: {
    ...typography.label,
    color: colors.text,
  },
  walletNote: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
  },
  /**
   * `warning`, not `textMuted`: this line is the difference between a figure
   * a driver can act on and one that is short by the fare in their pocket.
   * Colour is redundant here rather than load-bearing — the sentence says it
   * — which is what DESIGN.md §3 requires of any status colour.
   */
  walletCaveat: {
    ...typography.caption,
    fontSize: 12,
    color: colors.warning,
  },
  walletValue: {
    ...typography.bodyStrong,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  actions: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
});
