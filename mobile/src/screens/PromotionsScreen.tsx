import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Animated, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import type { PeakHours, ReferralOffer, WeeklyChallenge } from '../api/endpoints';
import type { ProfileStackParams } from '../navigation/types';
import {
  challengeEnds,
  challengeFraction,
  challengeNote,
  challengeProgress,
  challengeReward,
  peakDay,
  peakHeadline,
  peakIsLive,
  peakNote,
  peakWindow,
  referralCondition,
  referralReward,
  referralShareMessage,
  referralTally,
} from '../promotions/presentation';
import { useDriverPromotions } from '../promotions/queries';
import { Empty, Notice, Screen, ScreenHeader, usePressScale } from '../ui/components';
import { SkeletonCards } from '../ui/Skeleton';
import { AwardIcon, ShareIcon, TrendingUpIcon, UserPlusIcon } from '../ui/icons';
import { colors, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<ProfileStackParams, 'Promotions'>;

/**
 * What the platform is currently offering this driver (ADR-0036, ADR-0037).
 *
 * ## Three cards, and only the ones that are real
 *
 * The mockup drew a Weekly Challenge, a Peak Hours card and a Refer a Friend
 * card. **Two of the three described money the platform could not pay**, and
 * the owner's answer was to build both rather than draw either: peak hours is
 * now a real uplift scheme (ADR-0036) and referrals are a real, verified
 * payout (ADR-0037).
 *
 * Every card is therefore **conditional on its scheme being switched on**, and
 * a scheme that is off draws *nothing* rather than a zeroed card.
 * `docs/screen-rules.md` §1 refuses a zero standing in for a figure that does
 * not exist, and "0 of 40 trips" on a fleet running no bonus scheme is exactly
 * that, dressed as a measurement. A driver on a fleet running one scheme sees
 * one card, and that is correct rather than broken.
 *
 * ## What is not drawn, and why
 *
 * **No illustrations.** The mockup puts a character on each card — a figure on
 * a podium, somebody holding a coin. This app has no illustration set and no
 * asset pipeline, DESIGN.md § Icons makes Lucide the one visual vocabulary,
 * and a stock character would be the only depiction of a person anywhere in
 * the product. Each card takes its Lucide glyph in a soft medallion instead,
 * which is what every other surface here does.
 *
 * **No new colours.** The mockup's blush and lilac cards are not in the
 * palette, and DESIGN.md §8 fails raw hex in component code. The hierarchy the
 * mockup is really drawing — one hero, two secondary — is kept using tokens
 * that exist: the challenge is a filled brand-green hero, peak hours takes the
 * amber tint (a time-limited window, which is what amber is *for* here), and
 * referrals take the green tint. Each is paired with its own glyph and its own
 * words, so none of the three is distinguished by colour alone (§6).
 *
 * **Nothing animates.** The progress bar is the obvious candidate and is
 * deliberately static: the value is the fact a driver opened this screen to
 * read, and a bar that sweeps up to it means the first number they see is the
 * wrong one. `docs/screen-rules.md` §5 — every animation needs a reason, and
 * "it looks nice" is not one. The press feedback on the share control is the
 * app's shared `usePressScale`, which is feedback rather than decoration.
 */
export function PromotionsScreen({ navigation }: Props) {
  const { data, isLoading, isError } = useDriverPromotions();

  // Read once per render rather than per card, so the three cards cannot
  // disagree about what time it is — a challenge that says the week ends today
  // beside a peak window that thinks it is yesterday.
  const now = new Date();

  const nothingOnOffer =
    data !== undefined &&
    data.weeklyChallenge === null &&
    data.peakHours === null &&
    data.referral === null;

  return (
    <Screen>
      <ScreenHeader title="Promotions" subtitle={null} onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {isLoading && <SkeletonCards count={2} style={styles.loading} />}

        {isError && (
          <Notice
            tone="warning"
            message="Could not load what is on offer."
          />
        )}

        {nothingOnOffer && (
          <Empty message="No promotions running." />
        )}

        {data?.weeklyChallenge && (
          <ChallengeCard challenge={data.weeklyChallenge} now={now} />
        )}

        {data?.peakHours && (
          <PeakCard peak={data.peakHours} timezone={data.timezone} now={now} />
        )}

        {data?.referral && (
          <ReferralCard referral={data.referral} currency={data.currency} />
        )}
      </ScrollView>
    </Screen>
  );
}

/**
 * The hero: how far through the weekly trip target this driver is.
 *
 * **The note under the bar is the honest half of this card.** The mockup
 * implies the bonus accumulates; it does not. The award runs over a *closed*
 * week (ADR-0034 §4), so somebody at 30 of 30 on Wednesday has cleared the
 * target and still has nothing until Monday. Without that sentence the card is
 * a promise rather than a progress bar.
 */
function ChallengeCard({ challenge, now }: { challenge: WeeklyChallenge; now: Date }) {
  const progress = challengeProgress(challenge);
  const ends = challengeEnds(challenge, now);
  const reward = challengeReward(challenge);
  const note = challengeNote(challenge);

  return (
    <View
      style={styles.hero}
      accessible
      // One composed sentence. A screen reader walking the grid below would
      // otherwise read "18", "/ 30 trips", "Ends in 3 days" as three
      // disconnected fragments (`docs/screen-rules.md` §6).
      // Every clause ends in a full stop, including the optional one. Without
      // it a reader runs "Ends in 2 days Paid into your wallet" together as a
      // single breathless sentence — found by dumping the tree, which no
      // assertion in the suite was looking at.
      accessibilityLabel={`Weekly challenge. Complete ${challenge.tripTarget} trips to earn ${reward}. You have completed ${challenge.trips}.${ends === null ? '' : ` ${ends}.`} ${note}`}
    >
      <View style={styles.heroTop}>
        <View style={styles.heroText}>
          <Text style={styles.heroTitle}>Weekly Challenge</Text>
          <Text style={styles.heroSub}>Complete {challenge.tripTarget} trips.</Text>

          <Text style={styles.heroEarnLabel}>Earn</Text>
          {/*
            "UGX 50,000 Bonus", as the mockup writes it. The trailing word is
            not decoration: it names which of the wallet's credit kinds this
            will arrive as, so a driver can find it on their statement.
          */}
          <Text style={styles.heroAmount}>
            {reward}
            <Text style={styles.heroAmountKind}> Bonus</Text>
          </Text>
        </View>

        <View style={styles.heroMedallion}>
          <AwardIcon size={30} color={colors.onPrimary} strokeWidth={1.9} />
        </View>
      </View>

      {/*
        A track and a fill, not a percentage label. The mockup draws the bar
        with the count beneath it, and the count is the number a driver acts
        on — a second reading of the same fact as "60%" would just be a figure
        to reconcile against the one below it.
      */}
      <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.fill, { flex: challengeFraction(challenge) }]} />
        <View style={{ flex: 1 - challengeFraction(challenge) }} />
      </View>

      <View style={styles.heroFooter}>
        <Text style={styles.heroCount}>
          <Text style={styles.heroCountDone}>{progress.done} </Text>
          {progress.rest}
        </Text>

        {ends !== null && <Text style={styles.heroEnds}>{ends}</Text>}
      </View>

      <Text style={styles.heroNote}>{note}</Text>
    </View>
  );
}

/**
 * Tonight's peak window.
 *
 * **"Live now" is decided on the handset's clock against the server's
 * instants**, not on the `active` flag alone. The flag was true when the
 * request was made, and this screen caches for five minutes and survives being
 * backgrounded — a card left open across 8 PM would go on claiming the uplift
 * was running after it had stopped.
 */
function PeakCard({ peak, timezone, now }: { peak: PeakHours; timezone: string; now: Date }) {
  const live = peakIsLive(peak, now);
  const window = peakWindow(peak, timezone);
  const headline = peakHeadline(peak);
  const day = peakDay(peak, timezone, now);

  // "Today, 5:00 PM – 8:00 PM" — the mockup's phrasing, and the word is
  // checked rather than assumed: a card cached overnight would otherwise say
  // "Today" about yesterday. When it cannot be established the prefix is
  // dropped, which is incomplete where the word would be wrong.
  const when = day === null ? window : `${day}, ${window}`;

  return (
    <View
      style={[styles.card, styles.peakCard]}
      accessible
      accessibilityLabel={`Peak hours. ${headline}, ${when}. ${live ? 'Running now.' : 'Not running at the moment.'} ${peakNote()}`}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardText}>
          <Text style={styles.cardKicker}>Peak Hours</Text>
          <Text style={[styles.cardHeadline, styles.peakHeadline]}>{headline}</Text>
          <Text style={styles.cardWindow}>{when}</Text>
        </View>

        <View style={[styles.medallion, styles.peakMedallion]}>
          <TrendingUpIcon size={26} color={colors.warning} strokeWidth={1.9} />
        </View>
      </View>

      {/*
        The live state carries a **word**, never the amber alone
        (`docs/screen-rules.md` §6). A dot on its own would be invisible to a
        screen reader and ambiguous in direct sun, which is where this app is
        read.
      */}
      {live && (
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <Text style={styles.liveLabel}>Running now</Text>
        </View>
      )}

      <Text style={styles.cardNote}>{peakNote()}</Text>
    </View>
  );
}

/**
 * The referral offer, and the code that carries it.
 *
 * **Share, not copy.** `expo-clipboard` is not a dependency and a referral
 * card is not a reason to add one; more to the point, a driver sending a code
 * through WhatsApp is what actually happens, where "Copied!" leaves them to
 * find the messaging app themselves.
 */
function ReferralCard({ referral, currency }: { referral: ReferralOffer; currency: string }) {
  const press = usePressScale();

  const reward = referralReward(referral, currency);
  const condition = referralCondition(referral);
  const tally = referralTally(referral, currency);

  const share = () => {
    // Failure is swallowed: dismissing the share sheet rejects on some
    // platforms, and an error toast for "changed my mind" is noise.
    void Share.share({ message: referralShareMessage(referral) }).catch(() => undefined);
  };

  return (
    <View
      style={[styles.card, styles.referralCard]}
      accessible
      accessibilityLabel={`Refer a friend. Earn ${reward} ${condition}. Your code is ${spell(referral.code)}.${tally ? ` ${tally}.` : ''}`}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardText}>
          <Text style={styles.cardKicker}>Refer a Friend</Text>
          <Text style={[styles.cardHeadline, styles.referralHeadline]}>Earn {reward}</Text>
          <Text style={styles.cardWindow}>{condition}</Text>
        </View>

        <View style={[styles.medallion, styles.referralMedallion]}>
          <UserPlusIcon size={26} color={colors.primaryText} strokeWidth={1.9} />
        </View>
      </View>

      <Animated.View style={{ transform: [{ scale: press.scale }] }}>
        <Pressable
          accessibilityRole="button"
          // The code is spelled out for a screen reader. Read as a word,
          // "K7MTQ4RB" is noise; a driver dictating it to somebody needs the
          // letters.
          accessibilityLabel={`Share your referral code, ${spell(referral.code)}`}
          onPress={share}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          style={styles.codeRow}
        >
          <Text style={styles.code} numberOfLines={1}>
            {referral.code}
          </Text>
          <ShareIcon size={20} color={colors.primaryText} strokeWidth={1.9} />
        </Pressable>
      </Animated.View>

      {tally !== null && <Text style={styles.cardNote}>{tally}</Text>}
    </View>
  );
}

/**
 * A code as individual characters, for a screen reader.
 *
 * Without this a reader runs the eight characters together into an invented
 * word, and the one thing a driver needs to do with this code is say it to
 * somebody else.
 */
function spell(code: string): string {
  return code.split('').join(' ');
}

const styles = StyleSheet.create({
  body: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  loading: {
    marginTop: spacing.xl,
  },

  // -- The hero -------------------------------------------------------------
  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.md + 4,
    gap: spacing.md,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  heroText: {
    flex: 1,
    gap: spacing.xs,
  },
  heroTitle: {
    ...typography.heading,
    color: colors.onPrimary,
  },
  heroSub: {
    ...typography.body,
    color: colors.onPrimary,
  },
  heroEarnLabel: {
    ...typography.body,
    color: colors.onPrimary,
    marginTop: spacing.sm,
  },
  heroAmount: {
    // Sora at display size. This is the figure the card exists to state, and
    // it is the one thing on the screen a driver should be able to read from
    // a cradle at arm's length.
    ...typography.title,
    color: colors.onPrimary,
  },
  heroAmountKind: {
    // A step down, so "Bonus" labels the figure rather than competing with it.
    ...typography.heading,
    color: colors.onPrimary,
  },
  heroMedallion: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    // The token that exists for a hairline on a filled green surface, rather
    // than an `rgba()` at the call site (DESIGN.md §8).
    backgroundColor: colors.borderOnPrimary,
  },
  track: {
    flexDirection: 'row',
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.borderOnPrimary,
    overflow: 'hidden',
  },
  fill: {
    backgroundColor: colors.onPrimary,
    borderRadius: radius.pill,
  },
  heroFooter: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  heroCount: {
    ...typography.body,
    color: colors.onPrimary,
    flexShrink: 1,
  },
  heroCountDone: {
    ...typography.bodyStrong,
    color: colors.onPrimary,
  },
  heroEnds: {
    ...typography.body,
    color: colors.onPrimary,
    flexShrink: 1,
  },
  heroNote: {
    ...typography.caption,
    color: colors.onPrimary,
    // A shade back from the figures above it without leaving the palette: this
    // is the sentence that qualifies the promise, so it must stay legible on
    // green rather than fading to decoration.
    opacity: 0.85,
  },

  // -- The secondary cards --------------------------------------------------
  card: {
    borderRadius: radius.lg,
    padding: spacing.md + 4,
    gap: spacing.sm + 4,
  },
  peakCard: {
    backgroundColor: colors.warningTint,
  },
  referralCard: {
    backgroundColor: colors.primaryTint,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  cardText: {
    flex: 1,
    gap: spacing.xs,
  },
  cardKicker: {
    ...typography.heading,
    color: colors.text,
  },
  cardHeadline: {
    ...typography.heading,
    fontSize: 22,
    lineHeight: 28,
  },
  peakHeadline: {
    color: colors.warning,
  },
  referralHeadline: {
    color: colors.primaryText,
  },
  cardWindow: {
    ...typography.body,
    color: colors.textMuted,
  },
  medallion: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peakMedallion: {
    backgroundColor: colors.surface,
  },
  referralMedallion: {
    backgroundColor: colors.surface,
  },
  cardNote: {
    ...typography.caption,
    color: colors.textMuted,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.warning,
  },
  liveLabel: {
    ...typography.captionStrong,
    color: colors.warning,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    // Above the 52pt floor this app holds everywhere: a mis-tap here opens a
    // share sheet rather than posting a transition, but the rule is the rule.
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  code: {
    /*
     * **Not JetBrains Mono**, though DESIGN.md §6 files identifiers under it.
     * `ui/fonts.ts` deliberately does not bundle that family — its job there
     * is dense finance tables, which this app has none of — and naming a
     * family the bundle lacks is the standard React Native trap: Android has
     * nothing to synthesise from and silently renders a system face instead.
     *
     * Inter SemiBold with wide tracking does the actual job here, which is
     * making eight characters separable while somebody reads them aloud.
     */
    ...typography.bodyStrong,
    fontSize: 18,
    letterSpacing: 2,
    color: colors.text,
    flexShrink: 1,
  },
});
