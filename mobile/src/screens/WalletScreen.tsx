import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { DriverSettlementRequest, SettlementRequestKind } from '../api/endpoints';
import type { WalletStackParams } from '../navigation/types';
import { useDriverStats } from '../trips/queries';
import { walletHeading, walletNote, walletValue } from '../trips/statsPresentation';
import { Screen, ScreenHeader } from '../ui/components';
import { SkeletonRows } from '../ui/Skeleton';
import {
  ChevronRightIcon,
  CirclePlusIcon,
  SquareArrowUpIcon,
  WalletIcon,
} from '../ui/icons';
import { colors, radius, spacing, typography } from '../ui/theme';
import { SettlementSheet } from '../wallet/SettlementSheet';
import { StatementRow } from '../wallet/StatementRow';
import {
  hasOpenRequest,
  kindAction,
  openRequests,
  requestAmount,
  requestNote,
  requestTitle,
  SETTLEMENT_KINDS,
} from '../wallet/settlement';
import { useDriverLedger, useSettlementRequests } from '../wallet/queries';

type Props = NativeStackScreenProps<WalletStackParams, 'WalletHome'>;

/** How many movements the wallet shows before *View all*. */
const RECENT = 5;

/**
 * The wallet: what the driver and the office owe each other, the two ways to
 * settle it, and the last few movements behind the figure.
 *
 * ## The balance card is not the mockup's, and deliberately
 *
 * It said **Available Balance UGX 135,000** over **Withdraw** and **Add
 * Money**. ADR-0029 §5 makes this figure *"what the office and the driver owe
 * each other, net"*, and **negative is the normal state for cash work** — a
 * rider holds the platform's money until they settle. "Available" describes
 * money you could spend; this is usually money you owe. So the card keeps the
 * established pair: `walletValue` renders the magnitude **with no sign**, and
 * `walletNote` puts the direction in words. The first person shown
 * `UGX -4,500` asked whether the minus was a bug, which settled it.
 *
 * ## The two buttons, and what changed to make them honest
 *
 * The owner ruled that Withdraw and Add Money should become **requests the
 * office acts on**, which needed a superseding ADR — ADR-0029 §6 rules payout
 * out by name, and AGENTS.md requires a superseding ADR to move a decision.
 * ADR-0032 is that, and it does not weaken §6's principle: the platform still
 * *"records that it happened rather than making it happen"*. Cash changes
 * hands at the depot; this records that it did.
 *
 * They are not called Withdraw and Deposit. A driver is not depositing into an
 * account this platform holds and there is nothing to withdraw from, so the
 * app says **"I've paid the office"** and **"Request a payout"**.
 *
 * **A pending request changes nothing**, and the screen says so on every one.
 * If it moved the balance, a driver could request their way out of what they
 * owe.
 *
 * ## Still not here
 *
 * **Tips and bonuses exist now** (ADR-0034) and appear here as ordinary
 * statement rows, so this paragraph is shorter than it was. What survived the
 * change is the *naming*: a row says **"Tip"**, never "Tip from Sarah N." —
 * ADR-0024 §7 releases a passenger's details only while a trip is live, and
 * this list is permanent and scrollable. The server sends no name.
 *
 * A tip is **commissionable**, so it arrives as a pair — the driver's share
 * and the gross they are holding — exactly as a cash fare does. Both halves
 * are shown, for the same reason `cash_collected` is: hiding the debit makes
 * a prettier list that no longer sums to the balance above it.
 *
 * Still no **Withdrawal** row: `settlement` runs *both* ways and is far more
 * often cash going *to* the office, so that label names the rarer half.
 */
export function WalletScreen({ navigation }: Props) {
  const { data: stats } = useDriverStats();
  const { data: requests } = useSettlementRequests();
  const ledger = useDriverLedger();

  const [sheet, setSheet] = useState<SettlementRequestKind | null>(null);

  const entries = (ledger.data?.pages.flatMap((page) => page.entries) ?? []).slice(0, RECENT);
  const waiting = openRequests(requests);

  return (
    <Screen>
      {/*
        The arrow goes **to the Home tab**, not through `goBack()`.

        A first pass dropped it entirely when the wallet became a tab root, on
        the grounds that `goBack()` on a stack root is a silent no-op — which
        is true, and was the wrong conclusion. The mockup draws the arrow
        *and* the tab bar together, and it is right to: a driver arrives here
        from the Home screen's balance card, and the gesture back out of a
        money screen is one they expect to work.

        `navigate('Home')` is the honest version of that arrow. It always does
        something, wherever the driver came from, and it lands where the card
        that opened this screen lives.
      */}
      <ScreenHeader
        title="Wallet"
        subtitle={null}
        onBack={() => navigation.getParent()?.navigate('Home')}
      />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View
          style={styles.balanceCard}
          accessible
          accessibilityLabel={`${walletHeading(stats)}, ${walletValue(stats)}. ${walletNote(stats)}.`}
        >
          <View style={styles.balanceHead}>
            <Text style={styles.balanceLabel}>{walletHeading(stats)}</Text>
            <WalletIcon color={colors.onPrimary} size={22} strokeWidth={2} />
          </View>

          <Text style={styles.balanceValue}>{walletValue(stats)}</Text>

          {/*
            The two buttons live **inside** the green card, as the mockup draws
            them, rather than on the surface below it. That is not only
            styling: it puts the action next to the figure it acts on, and the
            white-on-green pair is what makes the card read as one control
            surface instead of a banner with a toolbar under it.
          */}
          <View style={styles.actions}>
            {SETTLEMENT_KINDS.map((kind) => {
              const open = hasOpenRequest(requests, kind);
              const Glyph = kind === 'payout' ? SquareArrowUpIcon : CirclePlusIcon;

              return (
                <Pressable
                  key={kind}
                  accessibilityRole="button"
                  accessibilityLabel={kindAction(kind)}
                  // The button says "Withdraw"; the hint says what actually
                  // happens. ADR-0032 is unchanged — this raises a request the
                  // office answers, and nothing moves until it does. The short
                  // label is the mockup's and the hint is the truth a screen
                  // reader gets for free; the sheet repeats it before any
                  // figure is typed.
                  accessibilityHint={
                    open
                      ? 'You already have one of these waiting for the office.'
                      : 'Sends a request to the office. Nothing is transferred by this app.'
                  }
                  accessibilityState={{ disabled: open }}
                  disabled={open}
                  onPress={() => setSheet(kind)}
                  style={[styles.action, open && styles.actionDisabled]}
                >
                  <Glyph color={colors.primaryText} size={20} strokeWidth={2} />
                  <Text style={styles.actionLabel}>{kindAction(kind)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/*
          The open requests, under the buttons that raised them. Shown rather
          than only disabling the button: a control that goes dead with no
          explanation leaves a driver wondering whether they imagined pressing
          it.
        */}
        {waiting.map((request) => (
          <PendingRequest key={request.id} request={request} />
        ))}

        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Transactions</Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View all transactions"
            onPress={() => navigation.navigate('Transactions')}
            hitSlop={8}
            style={styles.viewAll}
          >
            <Text style={styles.viewAllLabel}>View all</Text>
            <ChevronRightIcon color={colors.primaryText} size={18} strokeWidth={2.2} />
          </Pressable>
        </View>

        {entries.length === 0 ? (
          ledger.isLoading ? (
            <SkeletonRows count={3} style={styles.loading} />
          ) : (
            <Text style={styles.empty}>Nothing here yet.</Text>
          )
        ) : (
          entries.map((entry, index) => (
            <View key={entry.id}>
              {index > 0 && <View style={styles.separator} />}
              <StatementRow entry={entry} compact />
            </View>
          ))
        )}
      </ScrollView>

      {sheet !== null && <SettlementSheet kind={sheet} onClose={() => setSheet(null)} />}
    </Screen>
  );
}

/**
 * A request the office has not answered.
 *
 * The sentence under it is the load-bearing part: **"Your balance has not
 * changed yet."** A driver who has just told the office they paid 47,000 and
 * sees the same balance needs to be told that is expected, not that the app
 * lost it.
 */
function PendingRequest({ request }: { request: DriverSettlementRequest }) {
  return (
    <View
      style={styles.pending}
      accessible
      accessibilityLabel={`${requestTitle(request)}, ${requestAmount(request)}. ${requestNote(request)}`}
    >
      <View style={styles.pendingText}>
        <Text style={styles.pendingTitle}>{requestTitle(request)}</Text>
        <Text style={styles.pendingNote}>{requestNote(request)}</Text>
      </View>

      <Text style={styles.pendingAmount}>{requestAmount(request)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  balanceCard: {
    backgroundColor: colors.primaryCta,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  balanceHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  balanceLabel: {
    ...typography.body,
    color: colors.onPrimary,
  },
  balanceValue: {
    ...typography.odometer,
    color: colors.onPrimary,
    marginTop: spacing.xs,
    fontVariant: ['tabular-nums'],
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm + 4,
    marginTop: spacing.lg,
  },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    // No border. These sit on the green card now, and `colors.border` is
    // tuned for light surfaces — on green it reads as a smudge rather than an
    // edge. Solid white against `primaryCta` is its own boundary.
    backgroundColor: colors.surface,
  },
  actionDisabled: {
    opacity: 0.45,
  },
  actionLabel: {
    ...typography.captionStrong,
    color: colors.primaryText,
    flexShrink: 1,
  },
  pending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningTint,
  },
  pendingText: {
    flex: 1,
  },
  pendingTitle: {
    ...typography.label,
    color: colors.text,
  },
  pendingNote: {
    ...typography.caption,
    fontSize: 12,
    color: colors.warning,
  },
  pendingAmount: {
    ...typography.bodyStrong,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    ...typography.heading,
    color: colors.text,
  },
  viewAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 44,
  },
  viewAllLabel: {
    ...typography.captionStrong,
    fontSize: 15,
    color: colors.primaryText,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
  },
  empty: {
    ...typography.body,
    color: colors.textMuted,
    paddingVertical: spacing.lg,
  },
  loading: {
    paddingVertical: spacing.lg,
  },
});
