import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DispatchOffer, OfferPaymentMethod } from '../api/types';
import { CountdownRing } from '../duty/CountdownRing';
import {
  estimatedFareLabel,
  fareBasis,
  formatKilometres,
  formatMoney,
  itemTypeLabel,
  offerAnnouncement,
  offerChipLabel,
  offerSubtitle,
  offerTitle,
  packageSizeLabel,
  payerLabel,
  paymentMethodLabel,
} from '../duty/offerPresentation';
import { useCountdown } from '../duty/useCountdown';
import { Button } from '../ui/components';
import { DetailRow, GLYPH, RouteRail, Stat, StatRow } from '../ui/facts';
import {
  BagIcon,
  BanknoteIcon,
  CarIcon,
  CheckIcon,
  ChevronLeftIcon,
  CreditCardIcon,
  NavigationIcon,
  PackageIcon,
  RouteIcon,
  SmartphoneIcon,
  WalletIcon,
  XIcon,
} from '../ui/icons';
import { colors, motion, radius, spacing, typography } from '../ui/theme';

/**
 * One job, one decision, fifteen seconds (ADR-0024 §3).
 *
 * The most time-pressured surface in the platform, and the only one that
 * appears without being asked for. Everything below is in service of a driver
 * who is holding a steering wheel, glancing at a cradle, in Kampala sun.
 *
 * ## The shape: dark chrome, light content
 *
 * DESIGN.md §2's enterprise pattern, and here it does a second job. The navy
 * band holds the three things that are *about the offer* — what kind of work,
 * how long is left, a way out — and the white sheet holds the facts the
 * decision is made on. A driver's eye lands on the sheet because it is the
 * bright thing, which is where it should land.
 *
 * The band costs some daylight legibility, which the theme's own docblock
 * argues against; it is affordable because the only text on it is white at
 * heading size, and the surface a driver actually *reads* stayed white.
 *
 * ## What is on it, and why nothing else is
 *
 * The facts, in the order somebody decides in: *what kind of job*, *where it
 * starts and ends*, *how far both of those are*, *what it pays*, *how it
 * settles*, *what is being sent*. Anything more is a fact a driver would have
 * to skip past, and every skipped line costs a share of fifteen seconds.
 *
 * **There is no ETA, and there must not be one.** ADR-0020 §3 refused to
 * derive minutes from a straight-line distance by name — real roads are
 * longer than the crow's flight, so any figure here would run short, and it
 * would run short in front of a passenger. The middle stat shows the journey
 * distance instead: measured, honest, and the thing a driver is actually
 * weighing when they ask "how long will this tie me up".
 *
 * **The money says "estimated fare", not "earnings".** See
 * `estimatedFareLabel`. Where there is no honest figure — no tariff, no
 * coordinates, a category nobody priced — this renders an em dash, the same
 * rule `HomeScreen` holds for wallet and earnings. A driver who reads a
 * number they cannot collect has been lied to about money.
 *
 * **There is no passenger on this screen.** No name, no photograph, no
 * rating, no trip count. ADR-0024 §7 releases the passenger's identity only
 * after the accept, and this payload is what a push notification is built
 * from — so it reaches a lock screen. The platform has no rating system at
 * all (`DriverStatsService`: nobody has ever been asked for one), so the
 * other three would be invented outright. The chip over the sheet carries
 * what a driver actually needs instead: which service, in which vehicle.
 *
 * **There is no map.** `mobile/` has no map library, and a straight line
 * between two points is not the route — drawing one would suggest a road
 * that may not exist. The rail says where; the two distances say how far.
 *
 * ## Accept is not the mirror of Decline
 *
 * Accept is wider, filled, and on the right where a right thumb rests.
 * Declining is cheap to undo — the job goes to somebody else and another
 * arrives — while a mis-tapped decline costs this driver a fare and costs a
 * passenger another wait. The two are not equal choices and the layout should
 * not pretend they are.
 */
export function OfferScreen({
  offer,
  onAccept,
  onDecline,
  onDismiss,
  pending,
  error,
}: {
  offer: DispatchOffer;
  onAccept: () => void;
  onDecline: () => void;
  /** Leaves the offer running and gets out of the driver's way. */
  onDismiss: () => void;
  /**
   * Which answer is in flight, if either.
   *
   * A single `busy` boolean was wrong in a way that matters here: shared
   * between both buttons, declining a job spun the *Accept* spinner, which
   * tells a driver under a clock that the app is doing the opposite of what
   * they asked. Naming the act keeps each button honest about itself.
   */
  pending: 'accept' | 'decline' | null;
  /** The server's own sentence when an answer failed. */
  error: string | null;
}) {
  const insets = useSafeAreaInsets();
  const remaining = useCountdown(offer);
  const entrance = useEntrance();

  const away = formatKilometres(offer.pickup_distance_km);
  const journey = formatKilometres(offer.trip_distance_km);
  const size = packageSizeLabel(offer.package?.package_size ?? null);
  const item = itemTypeLabel(offer.package?.item_type ?? null);
  const method = paymentMethodLabel(offer.payment.payment_method);
  const payer = payerLabel(offer.payment.payer);
  const estimate = offer.estimated_fare;

  return (
    <Animated.View
      style={[
        styles.screen,
        {
          opacity: entrance.opacity,
          transform: [{ translateY: entrance.translateY }],
        },
      ]}
      accessibilityViewIsModal
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close, and leave the job running"
            onPress={onDismiss}
            hitSlop={10}
            style={styles.back}
          >
            <ChevronLeftIcon color={colors.onNavy} size={26} strokeWidth={2.2} />
          </Pressable>

          {/*
            One announcement for the whole screen rather than a dozen labelled
            views, because linearising this layout reads as a list of
            disconnected numbers. `assertive` because the offer arrived
            unbidden and there is a clock on it — this is the one interruption
            in the app that has earned the right to cut in.
          */}
          <View
            style={styles.headerText}
            accessible
            accessibilityLiveRegion="assertive"
            accessibilityLabel={offerAnnouncement(offer, remaining)}
          >
            <Text style={styles.title} numberOfLines={1}>
              {offerTitle(offer.service_type)}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {offerSubtitle(offer.service_type)}
            </Text>
          </View>

          <CountdownRing
            seconds={remaining}
            totalSeconds={offer.expires_in_seconds}
            offerId={offer.id}
            surface="navy"
          />
        </View>

        {/*
          The chip sits in flow at the foot of the band rather than straddling
          the seam as a mockup would have it. An element overflowing its
          parent's bounds is the classic iOS/Android divergence — Android
          clips where iOS does not — and this is not a screen to discover that
          on. In flow it reads the same and cannot render differently.
        */}
        <View style={styles.chipRow}>
          <View style={styles.chip}>
            {offer.package === null ? (
              <CarIcon color={colors.onNavy} size={16} strokeWidth={2} />
            ) : (
              <PackageIcon color={colors.onNavy} size={16} strokeWidth={2} />
            )}
            <Text style={styles.chipLabel}>{offerChipLabel(offer)}</Text>
          </View>

          {offer.reference !== null && <Text style={styles.reference}>{offer.reference}</Text>}
        </View>
      </View>

      <View style={styles.sheet}>
        <ScrollView
          // `flex: 1` on the scroller itself, not only padding on its
          // contents. Without it the ScrollView takes its content's height,
          // and a job with two long Kampala addresses pushes the answer
          // buttons off the bottom of the screen — on the one surface in the
          // app where being unable to reach a button costs a fare.
          style={styles.scroll}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          // The two buttons are pinned below, so this only ever scrolls when
          // a long address wraps. A driver must never have to scroll to
          // answer.
          bounces={false}
        >
          <RouteRail pickup={offer.pickup.label} dropoff={offer.dropoff.label} />

          {/*
            Three facts, one row. `Stat` renders an em dash for anything the
            platform does not know, so the row keeps its shape on an order
            taken over the phone rather than collapsing into a different
            layout for the same screen.
          */}
          <StatRow>
            {[
              <Stat key="away" icon={<NavigationIcon {...GLYPH} />} label="To pickup" value={away} />,
              <Stat key="journey" icon={<RouteIcon {...GLYPH} />} label="Journey" value={journey} />,
              <Stat
                key="fare"
                icon={<WalletIcon {...GLYPH} />}
                label={estimatedFareLabel}
                value={
                  estimate === null ? null : formatMoney(estimate.total_minor, estimate.currency)
                }
                // The one figure the decision turns on, so it is the one the
                // eye is sent to. Colour is redundant emphasis here rather
                // than the carrier of any meaning — the label says what it is.
                emphasis
              />,
            ]}
          </StatRow>

          {/*
            The basis, from the server rather than written here (`fareBasis`),
            so the day straight-line distance becomes road distance every
            installed handset tells the truth without a release. It sits under
            the whole row because all three figures are great-circle.
          */}
          <Text style={styles.basis}>
            {estimate === null
              ? // Said plainly rather than hidden. A missing fare is a gap in
                // the platform — nobody has published a tariff for this
                // vehicle — and a driver deciding without it should know that
                // is what happened, not wonder whether the job pays nothing.
                'No published price for this vehicle yet.'
              : fareBasis(estimate)}
          </Text>

          {/*
            A desk-assigned job, not a walk-in (ADR-0068). `client` is null on
            a walk-in, so its presence is what separates the two — no second
            flag, and nothing to keep in step.

            First of the rows, because on a corporate job it outranks
            everything below it: who the work is for, and whether it is now.
            A driver saying yes to next Tuesday is answering a different
            question from one saying yes to a passenger at a kerb.
          */}
          {offer.client !== null && (
            <DetailRow
              icon={<BagIcon {...GLYPH} />}
              label="Client"
              value={offer.client}
              caption={offer.scheduled_for_label ?? 'For now'}
            />
          )}

          <DetailRow
            icon={<PaymentGlyph method={offer.payment.payment_method} />}
            label="Payment"
            value={method}
            // Which end settles is a delivery fact and absent on a ride; the
            // fallback says nobody told us rather than leaving a driver to
            // read the em dash above as a fault in the app.
            caption={method === null ? 'Not stated on the order' : payer}
          />

          {/* A ride carries no parcel, and an empty row would be a hole
              rather than an absence of information. */}
          {offer.package !== null && (
            <DetailRow
              icon={<PackageIcon {...GLYPH} />}
              label="Package"
              value={size}
              caption={item}
            />
          )}

          {error !== null && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
        </ScrollView>

        <View style={[styles.actions, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.declineSlot}>
            <Button
              label="Decline"
              tone="neutral"
              icon={<XIcon />}
              onPress={onDecline}
              busy={pending === 'decline'}
              // Both are locked while either is in flight. An offer can be
              // answered exactly once, and a second tap during the round trip
              // would earn a 409 the driver did not deserve to see.
              disabled={pending === 'accept'}
            />
          </View>
          <View style={styles.acceptSlot}>
            <Button
              label="Accept"
              icon={<CheckIcon size={18} />}
              onPress={onAccept}
              busy={pending === 'accept'}
              disabled={pending === 'decline'}
            />
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

/**
 * The rail the money runs on, as a glyph.
 *
 * **A wallet, not a banknote, when nobody said.** The banknote is cash, and a
 * driver skimming glyphs under a clock would read it as cash — which is the
 * one wrong guess this row can make. The wallet says "money" without naming a
 * rail, and the em dash beside it says the rest.
 */
function PaymentGlyph({ method }: { method: OfferPaymentMethod | null }) {
  switch (method) {
    case 'cash':
      return <BanknoteIcon {...GLYPH} />;
    case 'mobile_money':
      return <SmartphoneIcon {...GLYPH} />;
    case 'card':
      return <CreditCardIcon {...GLYPH} />;
    default:
      return <WalletIcon {...GLYPH} color={colors.placeholder} />;
  }
}

/**
 * The screen's arrival: 220ms, ease-out, opacity and a short rise together.
 *
 * This is the one animation in the app that has to justify itself twice —
 * a driver sees it tens of times a day, and Emil's own rule is that anything
 * at that frequency should be reduced or removed. It stays for the reason
 * that rule exempts: **the screen appears unbidden, over whatever they were
 * doing.** A full-screen takeover with no transition does not read as fast,
 * it reads as a crash, and the driver's first act is to work out what
 * happened rather than to read the address.
 *
 * So it is kept short and flat — 220ms, ease-out, sixteen points of travel.
 * From 16 and from 0.0 opacity, never from a scale: a screen that grows from
 * a point is a gimmick, and this is a job arriving.
 *
 * Under `prefers-reduced-motion` the travel is dropped and the fade is kept.
 * Reduced motion means gentler, not none — a screen that simply blinks into
 * existence is exactly the jarring change the fade is there to prevent, and
 * removing it would punish the setting.
 */
function useEntrance(): { opacity: Animated.Value; translateY: Animated.AnimatedInterpolation<number> } {
  const [value] = useState(() => new Animated.Value(0));
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Read rather than assumed, and read before animating. The check is
    // asynchronous on both platforms, so the flag arrives a frame or two
    // late — which is why the animation below waits for it rather than
    // starting on mount and correcting itself mid-flight.
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

    // Stopped on unmount, which is not merely tidy: this screen is torn down
    // the instant an offer is answered, and an accept is exactly when the JS
    // thread is busiest. A timing left running past its component keeps
    // scheduling frames against a tree that no longer exists.
    return () => animation.stop();
  }, [value]);

  return {
    opacity: value,
    translateY: value.interpolate({
      inputRange: [0, 1],
      outputRange: [reduceMotion ? 0 : 16, 0],
    }),
  };
}

const styles = StyleSheet.create({
  screen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Navy rather than white, so the band bleeds into the status-bar inset
    // instead of leaving a white strip above a dark header.
    backgroundColor: colors.navy,
  },
  header: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    ...typography.heading,
    color: colors.onNavy,
  },
  subtitle: {
    ...typography.caption,
    color: colors.onNavyMuted,
    marginTop: 2,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingLeft: spacing.sm,
    paddingRight: spacing.sm,
    marginTop: spacing.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.navySoft,
    borderWidth: 1,
    borderColor: colors.borderOnNavy,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
  },
  chipLabel: {
    ...typography.captionStrong,
    color: colors.onNavy,
  },
  reference: {
    ...typography.caption,
    fontSize: 12,
    color: colors.onNavyMuted,
    // Letter-spaced rather than set in a mono face: DESIGN.md §6 wants
    // JetBrains Mono for identifiers and this app loads no mono family. The
    // tracking is what a reference actually needs here — it is read aloud
    // down a phone line, not aligned in a column.
    letterSpacing: 0.6,
  },
  sheet: {
    flex: 1,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  scroll: {
    flex: 1,
  },
  body: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm + 4,
  },
  basis: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
    // Pulled up under the row it annotates, so it reads as a footnote to the
    // three figures rather than as a card of its own.
    marginTop: -spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  error: {
    ...typography.caption,
    color: colors.danger,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 4,
    // Sits on its own surface with a hairline above it, so the two buttons
    // read as the screen's floor rather than as the last row of the content
    // that happens to scroll under them.
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  declineSlot: { flex: 2 },
  acceptSlot: { flex: 3 },
});
