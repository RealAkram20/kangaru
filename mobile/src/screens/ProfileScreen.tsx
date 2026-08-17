import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import type { ProfileStackParams } from '../navigation/types';
import { useSync } from '../offline/SyncProvider';
import { useDriverProfile } from '../profile/queries';
import {
  documentsSummary,
  initials,
  monthYear,
  tripsTotal,
  vehicleName,
  vehicleType,
} from '../profile/presentation';
import { useDriverStats } from '../trips/queries';
import { ratingNote, ratingValue } from '../trips/statsPresentation';
import { Card, MenuRow, Screen, ScreenHeader } from '../ui/components';
import { FileTextIcon, StarIcon } from '../ui/icons';
import { SyncBanner } from '../ui/SyncBanner';
import { colors, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<ProfileStackParams, 'ProfileHome'>;

/**
 * The driver's profile — who they are on this platform, and the four things
 * they can do about it.
 *
 * Replaces `AccountScreen`, which was the account page plus the parked outbox
 * queue in one scroll. The queue has not been dropped; it has its own screen
 * and a row that goes red and counts (see `SyncQueueScreen`). ADR-0023 §6
 * requires a refused update to keep its payload and be *shown*, and burying it
 * under a redesign was the one thing this change must not do.
 *
 * ## What the mockup asked for that this platform cannot produce
 *
 * - **A photograph of the driver.** ADR-0041 has since built driver photos, so
 *   this paragraph's original claim — that no avatar existed anywhere — is no
 *   longer true and is corrected rather than left to mislead. The photo is
 *   shown in the **drawer**, which is where the mockup for it put one; this
 *   screen keeps the monogram, because a driver reading their own profile
 *   already knows what they look like and the space buys a fact instead.
 * - **A bare "4.8".** ADR-0030 §3 withholds a score below five ratings, and
 *   `ratingValue`/`ratingNote` are the same pair the home screen uses — one
 *   vocabulary for one number, and the threshold stays on the server.
 * - **"Bank Details".** No bank rail exists and ADR-0029 §6 rules one out by
 *   name. Settling up is a *request the office answers* (ADR-0032) and already
 *   lives on the Wallet tab, so the row names the real destination.
 * - **"Settings".** It has one now, and the rows that used to be underneath
 *   here are in it. See the note above the remaining card.
 *
 * **"Documents — Verified" is the one the owner chose to build rather than
 * drop** (ADR-0033). Printing "Verified" against a compliance fact the
 * platform did not hold would be relied on by a driver at a checkpoint.
 */
export function ProfileScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { data: profile } = useDriverProfile();
  const { data: stats } = useDriverStats();
  // Only for the banner. The parked-queue *row* moved to Settings with the
  // rest of the account actions; `SyncBanner` below still needs the provider.
  useSync();

  // The driver's own record is the subject of this screen, but a driver whose
  // profile has not loaded still knows their own name — the account carries
  // one. Falling back to it beats an em dash where a person's name goes.
  const name = profile?.name ?? user?.name ?? 'Driver';

  const documents = documentsSummary(profile?.documents);

  return (
    <Screen>
      {/*
        The arrow is explicit rather than `goBack()`, which on a tab root is a
        silent no-op — the pattern `WalletScreen` and `EarningsScreen` already
        established when the bar went to four.
      */}
      <ScreenHeader
        title="Driver Profile"
        subtitle={null}
        onBack={() => navigation.getParent()?.navigate('Home')}
      />

      <SyncBanner />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Card>
          <View style={styles.identity}>
            {/*
              A monogram where the mockup drew a photograph. Marked
              `accessibilityElementsHidden` because the name is read out
              immediately beside it — a screen reader announcing "JK" and then
              "John Kamau" is the same fact twice, the second time usefully.
            */}
            <View style={styles.monogram} accessibilityElementsHidden importantForAccessibility="no">
              <Text style={styles.monogramText}>{initials(name)}</Text>
            </View>

            <View style={styles.identityText}>
              <Text style={styles.name} numberOfLines={2}>
                {name}
              </Text>

              <View
                style={styles.ratingRow}
                accessible
                accessibilityLabel={`Rating ${ratingValue(stats)}. ${ratingNote(stats) ?? 'Not loaded yet'}. ${tripsTotal(profile)} completed.`}
              >
                <StarIcon size={18} />
                <Text style={styles.rating}>{ratingValue(stats)}</Text>
                {/*
                  The count is what makes an em dash legible while the score is
                  withheld — a bare dash invites a driver to assume the worst
                  about a number that can end their income.
                */}
                <Text style={styles.ratingNote} numberOfLines={1}>
                  {ratingNote(stats) ?? '—'} · {tripsTotal(profile)}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.rule} />

          <Fact label="Phone" value={profile?.phone ?? '—'} />
          <Fact label="Vehicle" value={vehicleName(profile)} />
          <Fact label="Vehicle type" value={vehicleType(profile)} />
          <Fact label="Member since" value={monthYear(profile?.member_since)} />
        </Card>

        {/*
          **The navigation rows are gone, and that is the change.** This screen
          carried eight of them — Documents, Performance, Promotions, Time off,
          Settling up, Change password, Updates & sync, Log out — and the drawer
          now carries the whole map of the app. The owner's instruction was "we
          don't need to repeat the menus", and two lists that drift is worse
          than either: a driver who learned the app from one would find rows
          missing from the other.

          **Nothing was deleted.** The places went to the drawer; the acts on
          this account went to Settings, which the drawer opens. Every one of
          the eight is still one or two taps away.

          What is left is what this screen is actually for: who the driver is,
          what they drive, and whether their papers are in order.
        */}
        <Card style={styles.menu}>
          <MenuRow
            icon={<FileTextIcon color={colors.primary} size={22} strokeWidth={2} />}
            label="Vehicle & Documents"
            value={documents.label}
            tone={documents.tone}
            announcement={`Vehicle and documents. ${documents.label}.`}
            onPress={() => navigation.navigate('Documents')}
          />
        </Card>

      </ScrollView>
    </Screen>
  );
}

/**
 * Label left, value right, on one line.
 *
 * Deliberately **not** `DetailRow` from `ui/facts.tsx`, which is a different
 * shape for a different job: it carries a glyph and stacks the value under the
 * label, which is right for a pickup address read from a cradle and wrong for
 * four short facts a driver is scanning down. Extending `DetailRow` with a
 * layout switch would make one component answer two questions badly.
 *
 * It is the row `AccountScreen` already had, moved rather than duplicated —
 * that screen is gone.
 *
 * `accessible` on the wrapper composes the pair into one announcement, per
 * `docs/screen-rules.md` §6: without it a screen reader walks four labels and
 * then four values, and nothing tells the listener which belongs to which.
 */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.factLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.factValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  monogram: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monogramText: {
    ...typography.title,
    color: colors.primaryText,
  },
  identityText: {
    flex: 1,
  },
  name: {
    ...typography.heading,
    color: colors.text,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    marginTop: spacing.xs,
  },
  rating: {
    ...typography.bodyStrong,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  ratingNote: {
    ...typography.caption,
    color: colors.textMuted,
    flexShrink: 1,
  },
  rule: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  factLabel: {
    ...typography.body,
    color: colors.textMuted,
    // Shrinkable, but half as fast as the value. `flexShrink: 0` protected the
    // label at the cost of letting a long value overflow the row — and "Vehicle
    // type" is four times longer in German than in English, so a fixed label is
    // a row that breaks in the second country PRODUCT.md is built for.
    flexShrink: 1,
  },
  factValue: {
    ...typography.bodyStrong,
    color: colors.text,
    // The value yields first: a truncated "Toyota Wish · UBB 12…" still tells a
    // driver which car, where a truncated label tells them nothing about which
    // fact they are looking at.
    flexShrink: 2,
    textAlign: 'right',
  },
  menu: {
    // The rows carry their own vertical padding, so the card only needs its
    // gutters — otherwise the first and last rows sit in a double margin.
    paddingVertical: spacing.xs,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
  },
});
