import type {
  DispatchOffer,
  FareEstimate,
  OfferItemType,
  OfferPackageSize,
  OfferPayer,
  OfferPaymentMethod,
} from '../api/types';

/**
 * Turning an offer into the words on the offer screen.
 *
 * A module rather than helpers inside the component, for the reason
 * `./countdown.ts` gives: these are the parts that can be *wrong* rather than
 * merely ugly, and `jest.setup.ts` records that the suites worth trusting in
 * this app are pure TypeScript over injected values. A component test would
 * have to render concurrently and flush, which can fail for reasons having
 * nothing to do with whether 9000 shillings formats as "UGX 9,000".
 *
 * Every function here has the same shape of contract: **null in, null out**,
 * and the screen renders an em dash. Nothing invents a figure. That is the
 * rule `HomeScreen` already holds for earnings and wallet, and the reason it
 * holds is that a driver who reads a number they cannot collect has been lied
 * to about money.
 */

/**
 * Zero-decimal currencies, where the minor unit *is* the major unit.
 *
 * UGX is the one that matters — AGENTS.md's money rules name it — and
 * treating it like a two-decimal currency would divide every fare on this
 * screen by a hundred. The list is small and explicit rather than inferred,
 * because the failure is silent and the number still looks plausible: a
 * 9,000-shilling job renders as "UGX 90.00" and a driver declines it.
 */
const ZERO_DECIMAL_CURRENCIES = new Set(['UGX', 'RWF', 'BIF', 'DJF', 'JPY', 'KRW', 'VND', 'XAF', 'XOF']);

/**
 * "UGX 9,000".
 *
 * Grouped by hand rather than through `Intl.NumberFormat`. Hermes ships Intl,
 * but its locale data varies by platform and build, and this figure is the
 * one a driver decides on — it should read identically on every handset in
 * the fleet, and identically in a test.
 */
export function formatMoney(amountMinor: number, currency: string): string {
  const zeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase());
  const value = zeroDecimal ? amountMinor : amountMinor / 100;

  const rendered = zeroDecimal ? String(Math.round(value)) : value.toFixed(2);
  const dot = rendered.indexOf('.');

  const whole = dot === -1 ? rendered : rendered.slice(0, dot);
  const fraction = dot === -1 ? '' : rendered.slice(dot);

  // Negative amounts are not a thing an offer can carry, but the sign is
  // handled rather than assumed away: grouping a leading "-" in with the
  // digits would render -9000 as "-,900" and change the number.
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;

  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return `${currency.toUpperCase()} ${negative ? '-' : ''}${grouped}${fraction}`;
}

/**
 * Where a figure stops being written out in full: a hundred thousand.
 *
 * UGX is a low-denomination currency — a modest day's earnings runs to six
 * digits — so "UGX 145,600" is a wide, hard-to-skim number on a tile a driver
 * glances at. Below this it is written in full, because at five digits and
 * under there is nothing to gain.
 */
const COMPACT_FROM = 100_000;

/**
 * "UGX 145.6K", "UGX 1.25M" — the glanceable form.
 *
 * **Deliberately not used for a fare.** `formatMoney` above stays the exact
 * one, and every screen where a driver *decides* on money or is *owed* money
 * to the shilling keeps using it: the offer card, the pickup and in-progress
 * fares. This form is for summary tiles, where the question is "roughly how
 * has today gone" rather than "what exactly am I owed".
 *
 * That split is the whole point, because **this rounds**. A "K" figure hides
 * under 100 shillings and an "M" figure hides under 10,000, which is
 * unnoticeable on a glanceable total and unacceptable on a number somebody is
 * about to be paid. If a screen needs both, it should show this and offer the
 * exact figure — not compromise between them.
 */
export function compactMoney(amountMinor: number, currency: string): string {
  const code = currency.toUpperCase();
  const zeroDecimal = ZERO_DECIMAL_CURRENCIES.has(code);
  const major = zeroDecimal ? amountMinor : amountMinor / 100;

  if (!Number.isFinite(major) || Math.abs(major) < COMPACT_FROM) {
    return formatMoney(amountMinor, currency);
  }

  const negative = major < 0;
  const magnitude = Math.abs(major);

  // Two decimals on millions, one on thousands, so each hides a similar
  // *proportion* rather than a similar number of shillings.
  const millions = magnitude >= 1_000_000;
  const scaled = magnitude / (millions ? 1_000_000 : 1_000);
  const rounded = scaled.toFixed(millions ? 2 : 1);

  // 999,950 rounds to "1000.0K", which is a unit that does not exist. Rounding
  // decides the unit, not the raw value — checked after, because checking
  // before gets this exact case wrong.
  if (!millions && Number(rounded) >= 1_000) {
    return `${code} ${negative ? '-' : ''}1M`;
  }

  // "1.50M" reads as false precision and "145.0K" as clutter; both mean the
  // trailing zeros carry no information a reader can use.
  const trimmed = rounded.replace(/\.?0+$/, '');

  return `${code} ${negative ? '-' : ''}${trimmed}${millions ? 'M' : 'K'}`;
}

/**
 * "4.6 km", or null when there is nothing to measure.
 *
 * One decimal place. The server sends two because distance is a billing
 * input; a second decimal on a dispatch screen is precision nobody acts on,
 * and it costs width in a three-column row that has to hold "Medium".
 */
export function formatKilometres(km: number | null): string | null {
  if (km === null || !Number.isFinite(km)) {
    return null;
  }

  // Below 100 m, "0.0 km" is worse than useless — it reads as a bug. The
  // matcher ranks by this, so a driver standing on top of the pickup is a
  // real and common case at a stage.
  if (km < 0.1) {
    return 'Under 100 m';
  }

  return `${km.toFixed(1)} km`;
}

const PACKAGE_SIZE_LABELS: Record<OfferPackageSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  heavy: 'Heavy',
};

const ITEM_TYPE_LABELS: Record<OfferItemType, string> = {
  documents: 'Documents',
  food: 'Food',
  parcel: 'Parcel',
  electronics: 'Electronics',
  furniture: 'Furniture',
  appliances: 'Appliances',
  other: 'Item',
};

/**
 * The size, in a word — or null when the sender did not say.
 *
 * Looked up rather than capitalised, so a value the server adds later shows
 * as nothing rather than as a raw enum. A driver reading "self_drive" learns
 * that the app is broken; a driver reading "—" learns that nobody said, which
 * is true.
 */
export function packageSizeLabel(size: OfferPackageSize | null): string | null {
  return size === null ? null : (PACKAGE_SIZE_LABELS[size] ?? null);
}

export function itemTypeLabel(item: OfferItemType | null): string | null {
  return item === null ? null : (ITEM_TYPE_LABELS[item] ?? null);
}

/**
 * "Mobile money", not "MOBILE_MONEY".
 *
 * Looked up rather than de-underscored, for the reason `packageSizeLabel`
 * gives: a value the server adds later must render as nothing rather than as
 * a raw enum. It also puts the *rail* in the driver's own words — "mobile
 * money" is what the money is called in Kampala, and "MTN MoMo" would name
 * one provider out of two.
 */
const PAYMENT_METHOD_LABELS: Record<OfferPaymentMethod, string> = {
  cash: 'Cash',
  mobile_money: 'Mobile money',
  card: 'Card',
};

/**
 * How the job settles — or null when the person ordering did not say.
 *
 * **Null must never become "Cash".** It is the plausible default and the one
 * that costs a driver real money: they arrive with no float, are offered a
 * mobile-money transfer to a wallet they do not have, and the job stalls in
 * front of the customer. `—` says "nobody told us", which a driver can act on
 * by asking.
 */
export function paymentMethodLabel(method: OfferPaymentMethod | null): string | null {
  return method === null ? null : (PAYMENT_METHOD_LABELS[method] ?? null);
}

/**
 * Which end of a delivery settles the bill, as a sentence rather than a word.
 *
 * "Sender pays" reads at a glance; "Sender" beside a payment method reads as
 * the name of the method. On a ride this is null — there is one end — and the
 * line is simply absent rather than saying something vacuous.
 */
const PAYER_LABELS: Record<OfferPayer, string> = {
  sender: 'Sender pays',
  receiver: 'Receiver pays',
};

export function payerLabel(payer: OfferPayer | null): string | null {
  return payer === null ? null : (PAYER_LABELS[payer] ?? null);
}

/**
 * The chip over the seam between the header and the sheet: what kind of work
 * this is, and in what.
 *
 * The vehicle category comes from `estimated_fare`, which is the only place
 * the payload carries it — so it disappears exactly when the fare does, and
 * the chip degrades to the service alone rather than to "Ride · undefined".
 * Deliberately *not* filled in from `package.item_type`: the category names
 * the vehicle the office assigned, and guessing "boda" from a small parcel
 * would be the app inventing a dispatch decision.
 */
export function offerChipLabel(offer: DispatchOffer): string {
  const service =
    offer.service_type === 'delivery' ? 'Delivery' : offer.service_type === 'ride' ? 'Ride' : 'Job';

  const category = VEHICLE_CATEGORY_LABELS[offer.estimated_fare?.vehicle_category ?? ''] ?? null;

  // The service alone when the category is unknown, rather than the service
  // plus a raw enum. Title-casing the value would have read "Suv", and
  // "Ride · Suv" is the kind of small wrongness that makes a driver trust
  // nothing else on the screen.
  return category === null ? service : `${service} · ${category}`;
}

/**
 * Vehicle categories as a driver would say them.
 *
 * Both vocabularies the platform has: `vehicles.category` (what the fleet
 * runs) and the public order form's `vehicle_class` (what a customer picks),
 * because `estimated_fare.vehicle_category` is fed from the assigned
 * vehicle and either set could reach it as the fleet grows.
 */
const VEHICLE_CATEGORY_LABELS: Record<string, string> = {
  sedan: 'Sedan',
  suv: 'SUV',
  van: 'Van',
  pickup: 'Pickup',
  boda: 'Boda',
  electric_boda: 'Electric boda',
  economy: 'Economy',
  standard: 'Standard',
  xl: 'XL',
};

/**
 * The screen's title, which names the service rather than the word "job".
 *
 * A delivery and a ride are different work — different vehicle, different
 * time, different reason to decline — and the driver should know which they
 * are being asked about before reading anything else.
 */
export function offerTitle(serviceType: string | null): string {
  switch (serviceType) {
    case 'delivery':
      return 'New delivery request';
    case 'ride':
      return 'New ride request';
    default:
      // Including `self_drive`, which is a rental the desk handles and should
      // never reach a driver's phone. If one ever does, a neutral title is
      // better than a confident wrong one.
      return 'New request';
  }
}

/** The one-line restatement under the title. */
export function offerSubtitle(serviceType: string | null): string {
  switch (serviceType) {
    case 'delivery':
      return 'You have a new delivery request';
    case 'ride':
      return 'You have a new ride request';
    default:
      return 'You have a new request';
  }
}

/**
 * How the money is labelled: **"Estimated fare", never "earnings"**.
 *
 * The figure is what the passenger is quoted (ADR-0026 §2). There is no
 * commission model on this platform and settlement is deferred (ADR-0026 §3),
 * so today the driver collects all of it — but a screen that said "earnings"
 * would be asserting that split, and would go on asserting it from every
 * already-installed handset on the day a platform cut is introduced.
 *
 * Naming it a fare costs a driver nothing they cannot work out, and it stays
 * true whatever settlement turns out to be.
 */
export const estimatedFareLabel = 'Estimated fare';

/**
 * The sentence under the figure, taken from the server rather than written
 * here.
 *
 * `basis` travels in the payload precisely so this wording lives in one
 * place: the day straight-line distance becomes road distance, the sentence
 * changes on the server and every installed handset tells the truth without
 * a release. A local copy would drift and would be the version a driver
 * quoted back in a dispute.
 */
export function fareBasis(estimate: FareEstimate): string {
  return estimate.basis;
}

/**
 * Everything a screen reader should hear when this screen appears, in the
 * order it matters.
 *
 * Composed here rather than left to the reading order of the views, because
 * the visual order is a grid — the ring sits beside the subtitle, the two
 * distances sit beside each other — and a linearised grid reads as a list of
 * disconnected numbers. Under a fifteen-second clock, "what, where, how much,
 * how long left" has to arrive as one sentence.
 */
export function offerAnnouncement(offer: DispatchOffer, secondsLeft: number): string {
  const parts: string[] = [offerSubtitle(offer.service_type) + '.'];

  if (offer.pickup.label !== null) {
    parts.push(`Pick up at ${offer.pickup.label}.`);
  }

  if (offer.dropoff.label !== null) {
    parts.push(`Deliver to ${offer.dropoff.label}.`);
  }

  const away = formatKilometres(offer.pickup_distance_km);

  if (away !== null) {
    parts.push(`${away} away.`);
  }

  const trip = formatKilometres(offer.trip_distance_km);

  if (trip !== null) {
    parts.push(`${trip} journey.`);
  }

  const size = packageSizeLabel(offer.package?.package_size ?? null);

  if (size !== null) {
    parts.push(`${size} package.`);
  }

  if (offer.estimated_fare !== null) {
    parts.push(
      `${estimatedFareLabel} ${formatMoney(offer.estimated_fare.total_minor, offer.estimated_fare.currency)}.`,
    );
  }

  // How it settles, spoken as part of the same sentence. A driver using a
  // screen reader gets no glance at the payment row, and "paid in cash" is
  // the fact that decides whether they need a float on them.
  const method = paymentMethodLabel(offer.payment.payment_method);

  if (method !== null) {
    const payer = payerLabel(offer.payment.payer);

    parts.push(payer === null ? `Paid by ${method.toLowerCase()}.` : `Paid by ${method.toLowerCase()}, ${payer.toLowerCase()}.`);
  }

  parts.push(`${secondsLeft} seconds to answer.`);

  return parts.join(' ');
}
