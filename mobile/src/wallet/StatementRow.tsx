import { StyleSheet, Text, View } from 'react-native';

import type { DriverLedgerEntry } from '../api/endpoints';
import { AwardIcon, BanknoteIcon, CarIcon, HandCoinsIcon, PackageIcon } from '../ui/icons';
import { colors, radius, spacing, typography } from '../ui/theme';
import { rowAmount, rowAnnouncement, rowDirection, rowTitle, rowWhen } from './presentation';

/**
 * One movement of a driver's money.
 *
 * Extracted from `WalletScreen` when `TransactionsScreen` needed the same row
 * — AGENTS.md: *"Never duplicate UI. If a component appears more than once,
 * convert it into a reusable component."* The wallet shows the last few and
 * the transactions screen shows all of them, and they must not drift into two
 * ways of writing the same fact about somebody's pay.
 *
 * The glyph follows the kind of work and is **redundant to the title beside
 * it** rather than carrying meaning of its own (DESIGN.md §7: an icon means
 * something only alongside a label). Lucide only, all three already in
 * `ui/icons.tsx`.
 *
 * Colour follows direction and is likewise redundant: the amount already
 * carries a `+` or a true `−`, and the composed screen-reader sentence says
 * "in your favour" or "owed to the office" in words. Never colour alone
 * (AGENTS.md § Accessibility).
 */
export function StatementRow({
  entry,
  compact = false,
}: {
  entry: DriverLedgerEntry;
  /**
   * Drops the server's explanation line, leaving title and time — the
   * mockup's wallet row.
   *
   * **The wallet shows the last five; the Transactions screen shows all of
   * them.** That is the split this prop draws: a glance versus a record. The
   * description is where ADR-0029 §3 freezes the commission rate that applied,
   * so it is never *removed* from the app — it is on the screen a driver opens
   * to ask why a figure is what it is, and off the one they open to see
   * whether today's work has landed.
   */
  compact?: boolean;
}) {
  const direction = rowDirection(entry);

  return (
    <View style={styles.row} accessible accessibilityLabel={rowAnnouncement(entry)}>
      <View style={styles.glyph}>
        <RowIcon entry={entry} />
      </View>

      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {rowTitle(entry)}
        </Text>
        {/* Two lines: the server's explanation carries the commission rate
            that applied, and truncating it to one hides the half that says
            which rate. */}
        {!compact && (
          <Text style={styles.detail} numberOfLines={2}>
            {entry.description}
          </Text>
        )}
        <Text style={styles.when}>{rowWhen(entry.created_at)}</Text>
      </View>

      <Text
        style={[
          styles.amount,
          direction === 'in' && styles.amountIn,
          direction === 'out' && styles.amountOut,
        ]}
      >
        {rowAmount(entry)}
      </Text>
    </View>
  );
}

function RowIcon({ entry }: { entry: DriverLedgerEntry }) {
  const tint = colors.primaryText;

  // The tip pair and the bonus take their own glyphs before the service-type
  // branch below (ADR-0034) — a tip hangs off a trip, so it would otherwise
  // draw that trip's car or package and read as a second fare.
  if (entry.kind === 'tip_earned' || entry.kind === 'tip_cash_collected') {
    return <HandCoinsIcon color={tint} size={20} strokeWidth={2} />;
  }

  if (entry.kind === 'bonus') {
    return <AwardIcon color={tint} size={20} strokeWidth={2} />;
  }

  if (entry.service_type === 'delivery') {
    return <PackageIcon color={tint} size={20} strokeWidth={2} />;
  }

  if (entry.kind === 'fare_earned') {
    return <CarIcon color={tint} size={20} strokeWidth={2} />;
  }

  // Cash collected, settlement and adjustment are all movements of money
  // rather than of a vehicle.
  return <BanknoteIcon color={tint} size={20} strokeWidth={2} />;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  glyph: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
  },
  title: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  detail: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
  },
  when: {
    ...typography.caption,
    fontSize: 12,
    color: colors.placeholder,
    marginTop: 2,
  },
  amount: {
    ...typography.bodyStrong,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  amountIn: {
    color: colors.primaryText,
  },
  amountOut: {
    color: colors.textBody,
  },
});
