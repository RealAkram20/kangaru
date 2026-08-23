import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { DispatchOffer } from '../api/types';
import { CarTaxiFrontIcon, CheckIcon, ClockIcon, XIcon } from '../ui/icons';
import { fonts } from '../ui/theme';
import { formatKilometres, formatMoney, offerTitle } from './offerPresentation';

/**
 * A job offer as a banner over whatever the driver is doing (ADR-0049 §5).
 *
 * This is the owner's mockup, built to it. Every colour, weight and proportion
 * below was measured out of that PNG rather than eyeballed — the card is
 * `#05373F`, the eyebrow `#00C0D5`, the badge `#01646E`, the tick `#59BD47`,
 * the cross `#DB2039`, the fare `#A2E7EB`. Those are not the app's palette and
 * the divergence is deliberate; see the note on `PALETTE`.
 *
 * ## Why it is two rows when the mockup is one
 *
 * The mockup's band is **5.96 : 1** — 1574 × 264 in its own pixels. Laid out
 * across a 390pt phone with the app's 12pt gutters, that band is 366 × 61pt,
 * and its type scales down with it: the eyebrow lands at 8pt, the pickup at
 * 10pt, the distance at 7pt. `theme.ts` puts the floor at 15pt and says why —
 * *"Small type is unreadable through glare"* — for a driver glancing at a
 * cradle in Kampala sun. A 7pt address is not a compromise, it is a blank.
 *
 * Holding the type legible and keeping one row was tried and it fails on
 * width: at 17pt the pickup alone needs ~205pt, and with a 52pt badge, two
 * 52pt buttons and their gaps there are ~150pt left for it. The address
 * truncates to *"Pickup: Kam…"* — which removes the single fact the driver is
 * deciding on, to preserve a silhouette.
 *
 * So the band folds at its own divider. The vertical rule between "how far"
 * and "how much" becomes a horizontal one, and **nothing else changes**: same
 * pill, same badge at the same size relative to its row, same three-line
 * stack, same fare and trip line, same two circles with their captions on the
 * right. It is the mockup at a proportion a phone can hold.
 *
 * ## Why the banner exists at all, next to `OfferScreen`
 *
 * `OfferScreen` takes the whole screen and is right when the offer is the only
 * thing happening — it arrives on a locked phone and it is what the
 * full-screen intent opens (ADR-0049 §3). But it is a takeover, and a driver
 * mid-way through an odometer reading or reading a trip's notes should not
 * have the app yanked out from under them for a job they may decline.
 *
 * The banner is the smaller answer for the app-is-open case: it says the same
 * four facts, it answers in one tap, and tapping the body opens the full
 * screen for a driver who wants the drop-off, the payment method and the
 * countdown ring before deciding.
 */

/**
 * The mockup's palette, kept here rather than in `theme.ts`, on purpose.
 *
 * **These colours are not DESIGN.md's.** The app is white surfaces, navy text
 * and `#01903D` green; this is dark teal and cyan, and it comes from the
 * owner's reference for this one surface. Putting it in the theme would
 * present it as a platform palette and invite a second screen to reach for it,
 * at which point the app has two identities and no rule about which to use.
 *
 * Scoped to this file, it reads as what it is: an interruption surface that
 * deliberately does not look like the app behind it — which is the same
 * argument `OfferScreen` makes for its navy band, and the reason an incoming
 * call does not look like the phone's home screen.
 */
const PALETTE = {
  /** The card. Measured from the reference at #05373F. */
  card: '#05373F',
  /** The badge behind the taxi. A step lighter than the card, not a tint of it. */
  badge: '#01646E',
  /** The eyebrow. Bright enough to be the first thing read on a dark card. */
  eyebrow: '#00C0D5',
  /** The pickup. Nothing else on the card is pure white. */
  primary: '#FFFFFF',
  /** The distance and the trip line. */
  muted: '#BCC3C9',
  /** The fare. Pale cyan rather than white, so money reads as its own class. */
  money: '#A2E7EB',
  /** The rule between the two halves — the mockup's vertical divider, turned. */
  rule: '#22505A',
  accept: '#59BD47',
  decline: '#DB2039',
} as const;

export function OfferBanner({
  offer,
  onAccept,
  onDecline,
  onOpen,
  pending,
}: {
  offer: DispatchOffer;
  onAccept: () => void;
  onDecline: () => void;
  /** Tapping the card itself — opens `OfferScreen` with the whole job on it. */
  onOpen: () => void;
  /**
   * Which answer is in flight, if either. Named rather than a `busy` boolean
   * for the reason `OfferScreen` gives: a shared flag dims the wrong button
   * and tells a driver under a clock that the app is doing the opposite of
   * what they asked.
   */
  pending: 'accept' | 'decline' | null;
}) {
  const away = formatKilometres(offer.pickup_distance_km);
  const journey = formatKilometres(offer.trip_distance_km);
  const busy = pending !== null;

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${offerTitle(offer.service_type)}. ${pickupLine(offer)}. Open the full offer.`}
      style={styles.card}
    >
      <View style={styles.head}>
        <View style={styles.badge}>
          <CarTaxiFrontIcon size={30} color={PALETTE.primary} strokeWidth={2} />
        </View>

        <View style={styles.headText}>
          <Text style={styles.eyebrow}>{offerTitle(offer.service_type)}</Text>

          {/* One line, always. A wrapped address pushes the fare and the
              buttons down by a row and the card changes height between one
              job and the next, which reads as the app glitching rather than
              as a longer street name. */}
          <Text style={styles.pickup} numberOfLines={1}>
            {pickupLine(offer)}
          </Text>

          {/* An em dash where there is no distance — an order taken over the
              phone has no coordinates. The same rule the rest of the app
              holds: never render a number that was not measured. */}
          <Text style={styles.away}>{away === null ? '—' : `${away} away`}</Text>
        </View>
      </View>

      <View style={styles.rule} />

      <View style={styles.foot}>
        <View style={styles.money}>
          <Text style={styles.fare}>
            {offer.estimated_fare === null
              ? '—'
              : formatMoney(offer.estimated_fare.total_minor, offer.estimated_fare.currency)}
          </Text>

          {/* **The mockup says "15 min trip" and this says kilometres, which
              is a deliberate refusal.**

              There is no journey duration anywhere in this payload, and the
              platform declines to invent one: ADR-0020 §3 refused to derive
              minutes from a straight-line distance by name, because real
              roads are longer than the crow's flight, so any figure would run
              short — and it would run short in front of a passenger.
              `OfferScreen`'s own docblock states the rule flatly: *"There is
              no ETA, and there must not be one."*

              The distance is the honest version of the same fact and it is
              what a driver is actually weighing: how long this ties them up.

              A real minutes figure is reachable — ADR-0031 put OSRM on this
              project's own network — but it has to come from the server on
              the offer payload, not from a division done here. That is a
              backend change and it is the right way to make the mockup's line
              literally true. */}
          <View style={styles.tripRow}>
            <ClockIcon size={15} color={PALETTE.muted} strokeWidth={2} />
            <Text style={styles.trip}>{journey === null ? '—' : `${journey} trip`}</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Answer
            label="Accept"
            colour={PALETTE.accept}
            onPress={onAccept}
            disabled={busy}
            dim={pending === 'decline'}
            glyph={<CheckIcon size={29} color={PALETTE.primary} strokeWidth={3.2} />}
          />
          <Answer
            label="Decline"
            colour={PALETTE.decline}
            onPress={onDecline}
            disabled={busy}
            dim={pending === 'accept'}
            glyph={<XIcon size={29} color={PALETTE.primary} strokeWidth={3.2} />}
          />
        </View>
      </View>
    </Pressable>
  );
}

/**
 * One of the two circles, with its caption.
 *
 * **The caption stays**, though a green tick and a red cross are close to
 * self-explanatory. Two reasons: the mockup has them, and colour alone is not
 * an affordance — a driver with a red-green deficiency sees two dark circles,
 * and this is the one control in the app where guessing wrong costs a fare.
 */
function Answer({
  label,
  colour,
  glyph,
  onPress,
  disabled,
  dim,
}: {
  label: string;
  colour: string;
  glyph: React.ReactNode;
  onPress: () => void;
  disabled: boolean;
  /** The *other* answer is in flight, so this one steps back rather than out. */
  dim: boolean;
}) {
  return (
    <View style={styles.answer}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        // `hitSlop` rather than a larger circle: the mockup's proportions are
        // what they are, and the tap area is allowed to be bigger than the
        // paint. 56pt already clears `MIN_TOUCH_HEIGHT`; this makes a glancing
        // thumb land anyway.
        hitSlop={8}
        style={({ pressed }) => [
          styles.circle,
          { backgroundColor: colour },
          dim && styles.dimmed,
          pressed && styles.pressed,
        ]}
      >
        {glyph}
      </Pressable>
      <Text style={styles.caption}>{label}</Text>
    </View>
  );
}

/**
 * "Pickup: Kampala Road", or the honest fallback.
 *
 * The label is genuinely optional — a job dispatched from coordinates alone
 * has none — and "Pickup: null" is the kind of small wrongness that makes a
 * driver stop believing the rest of the card.
 */
function pickupLine(offer: DispatchOffer): string {
  const label = offer.pickup.label?.trim();

  return label === undefined || label === '' ? 'Pickup nearby' : `Pickup: ${label}`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: PALETTE.card,
    borderRadius: 28,
    paddingTop: 15,
    paddingHorizontal: 16,
    paddingBottom: 16,
    // Lifted off whatever is behind it, because this paints over a live screen
    // and has to read as a layer rather than as part of it.
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },

  head: { flexDirection: 'row', alignItems: 'center', gap: 13 },

  badge: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: PALETTE.badge,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // `minWidth: 0` is what lets `numberOfLines` actually clip the pickup rather
  // than the row growing to fit it and pushing the badge off the card.
  headText: { flex: 1, minWidth: 0 },

  eyebrow: {
    fontFamily: fonts.displaySemi,
    fontSize: 15,
    lineHeight: 20,
    color: PALETTE.eyebrow,
    letterSpacing: 0.2,
  },
  pickup: {
    fontFamily: fonts.display,
    fontSize: 19,
    lineHeight: 25,
    color: PALETTE.primary,
    marginTop: 1,
  },
  away: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    lineHeight: 19,
    color: PALETTE.muted,
    marginTop: 2,
  },

  rule: { height: 1, backgroundColor: PALETTE.rule, marginTop: 14, marginBottom: 13 },

  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  money: { flex: 1, minWidth: 0 },
  fare: { fontFamily: fonts.display, fontSize: 21, lineHeight: 26, color: PALETTE.money },
  tripRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  trip: { fontFamily: fonts.bodyMedium, fontSize: 14, lineHeight: 19, color: PALETTE.muted },

  actions: { flexDirection: 'row', gap: 16 },
  answer: { alignItems: 'center' },
  circle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.82, transform: [{ scale: 0.96 }] },
  dimmed: { opacity: 0.4 },
  caption: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    lineHeight: 17,
    color: PALETTE.primary,
    marginTop: 5,
  },
});
