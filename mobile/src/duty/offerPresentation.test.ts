import type { DispatchOffer } from '../api/types';
import {
  compactMoney,
  estimatedFareLabel,
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
} from './offerPresentation';

/**
 * The offer screen's words.
 *
 * Pure TypeScript over a fixture, which is what `jest.setup.ts` says the
 * trustworthy suites in this app look like. What is asserted here is not
 * layout — it is the two things on that screen a driver can be *misled* by:
 * a money figure off by a factor of a hundred, and a fact the platform does
 * not actually know rendered as though it did.
 */
function offer(overrides: Partial<DispatchOffer> = {}): DispatchOffer {
  return {
    id: 1,
    status: 'offered',
    expires_at: '2026-08-14T10:00:15+03:00',
    expires_in_seconds: 15,
    pickup: { label: 'Geoprix Engineering Limited, Seeta', latitude: 0.3476, longitude: 32.5825 },
    dropoff: { label: 'Acacia Mall, 14-18 Cooper Rd', latitude: 0.3676, longitude: 32.5825 },
    service_type: 'delivery',
    // Null on a walk-in, which is what these fixtures are — a
    // corporate offer is the other channel (ADR-0068).
    client: null,
    scheduled_for: null,
    scheduled_for_label: null,
    reference: 'KR-ABC234',
    pickup_distance_km: 4.6,
    trip_distance_km: 8.24,
    reasons: [],
    package: { item_type: 'parcel', package_size: 'medium' },
    payment: { payment_method: 'cash', payer: 'receiver' },
    estimated_fare: {
      vehicle_category: 'sedan',
      distance_km: 8.24,
      total_minor: 9000,
      currency: 'UGX',
      is_estimate: true,
      basis: 'Straight-line distance. The final fare follows the distance actually travelled.',
    },
    vehicle_id: 7,
    ...overrides,
  };
}

/** The same offer, dispatched in a different vehicle. */
function withCategory(vehicle_category: string): string {
  const base = offer().estimated_fare;

  return offerChipLabel(offer({ estimated_fare: { ...base!, vehicle_category } }));
}

describe('formatMoney', () => {
  it('treats UGX as a whole-shilling currency', () => {
    // The failure this exists to catch is silent and still looks plausible:
    // dividing by 100 renders a 9,000-shilling job as "UGX 90.00", and a
    // driver declines work that pays fine.
    expect(formatMoney(9000, 'UGX')).toBe('UGX 9,000');
  });

  it('groups thousands so a large fare can be read at arm\'s length', () => {
    expect(formatMoney(1250000, 'UGX')).toBe('UGX 1,250,000');
    expect(formatMoney(999, 'UGX')).toBe('UGX 999');
    expect(formatMoney(1000, 'UGX')).toBe('UGX 1,000');
  });

  it('keeps the minor unit for a currency that has one', () => {
    expect(formatMoney(9000, 'USD')).toBe('USD 90.00');
  });

  it('renders zero as zero rather than as nothing', () => {
    // A zero fare is wrong, but it is the server's wrongness to report — the
    // screen must not quietly turn it into an em dash and hide a bad tariff.
    expect(formatMoney(0, 'UGX')).toBe('UGX 0');
  });

  it('does not group a minus sign in with the digits', () => {
    expect(formatMoney(-9000, 'UGX')).toBe('UGX -9,000');
  });
});

describe('compactMoney', () => {
  it('writes anything under a hundred thousand out in full', () => {
    // Five digits and under have nothing to gain from shortening, and this is
    // the range almost every fare sits in.
    expect(compactMoney(9_000, 'UGX')).toBe('UGX 9,000');
    expect(compactMoney(99_999, 'UGX')).toBe('UGX 99,999');
  });

  it('shortens from a hundred thousand', () => {
    expect(compactMoney(100_000, 'UGX')).toBe('UGX 100K');
    expect(compactMoney(145_600, 'UGX')).toBe('UGX 145.6K');
  });

  it('shortens millions with two places, not one', () => {
    // One place on a million hides up to 50,000 shillings. Two hides 10,000 —
    // still a lot, which is why this form never carries a fare.
    expect(compactMoney(1_000_000, 'UGX')).toBe('UGX 1M');
    expect(compactMoney(1_250_000, 'UGX')).toBe('UGX 1.25M');
  });

  it('promotes to millions when rounding takes it there', () => {
    // 999,950 rounds to "1000.0K", a unit that does not exist. Rounding
    // decides the unit, not the raw value.
    expect(compactMoney(999_950, 'UGX')).toBe('UGX 1M');
  });

  it('drops trailing zeros rather than implying precision it does not have', () => {
    expect(compactMoney(1_500_000, 'UGX')).toBe('UGX 1.5M');
    expect(compactMoney(200_000, 'UGX')).toBe('UGX 200K');
  });

  it('keeps the sign, because the caller decides whether to show one', () => {
    // `walletValue` strips it deliberately; a ledger listing would not.
    expect(compactMoney(-145_600, 'UGX')).toBe('UGX -145.6K');
  });

  it('still treats a two-decimal currency as a two-decimal currency', () => {
    // 15,000,000 cents is 150,000 dollars — the shortening happens on the
    // major unit, not on the minor one.
    expect(compactMoney(15_000_000, 'USD')).toBe('USD 150K');
  });
});

describe('formatKilometres', () => {
  it('rounds to one place, because nobody acts on the second', () => {
    expect(formatKilometres(4.62)).toBe('4.6 km');
    expect(formatKilometres(8.24)).toBe('8.2 km');
  });

  it('says "under 100 m" rather than "0.0 km"', () => {
    // Common at a stage, where the matcher ranks a driver standing on the
    // pickup. "0.0 km" reads as a broken field, not as "you are here".
    expect(formatKilometres(0.04)).toBe('Under 100 m');
  });

  it('gives nothing back when there is nothing to measure', () => {
    expect(formatKilometres(null)).toBeNull();
    expect(formatKilometres(Number.NaN)).toBeNull();
  });
});

describe('labels', () => {
  it('names the service in the title and the subtitle', () => {
    expect(offerTitle('delivery')).toBe('New delivery request');
    expect(offerSubtitle('delivery')).toBe('You have a new delivery request');
    expect(offerTitle('ride')).toBe('New ride request');
  });

  it('falls back to a neutral title for a service it does not know', () => {
    // Better than a confident wrong one. `self_drive` is a rental the desk
    // handles and should never reach a driver's phone at all.
    expect(offerTitle('self_drive')).toBe('New request');
    expect(offerTitle(null)).toBe('New request');
  });

  it('renders a package size as a word', () => {
    expect(packageSizeLabel('medium')).toBe('Medium');
    expect(itemTypeLabel('documents')).toBe('Documents');
  });

  it('gives nothing back for a size nobody supplied', () => {
    expect(packageSizeLabel(null)).toBeNull();
    expect(itemTypeLabel(null)).toBeNull();
  });

  it('gives nothing back rather than leaking a raw enum the server added later', () => {
    // A driver reading "cold_chain" learns the app is broken. A driver
    // reading an em dash learns nobody said, which is true.
    expect(packageSizeLabel('cold_chain' as never)).toBeNull();
  });

  it('names the payment rail in the words used in Kampala', () => {
    expect(paymentMethodLabel('mobile_money')).toBe('Mobile money');
    expect(paymentMethodLabel('cash')).toBe('Cash');
    expect(paymentMethodLabel('card')).toBe('Card');
  });

  it('never guesses cash for a method nobody supplied', () => {
    // The single most expensive default on this screen. A driver who reads
    // "Cash", turns up with no float and is offered a mobile-money transfer
    // to a wallet they do not have has been told something the platform
    // never knew — and the job stalls in front of the customer.
    expect(paymentMethodLabel(null)).toBeNull();
    expect(paymentMethodLabel('crypto' as never)).toBeNull();
  });

  it('says which end of a delivery pays, as a sentence', () => {
    expect(payerLabel('sender')).toBe('Sender pays');
    expect(payerLabel('receiver')).toBe('Receiver pays');
    expect(payerLabel(null)).toBeNull();
  });

  it('names the service and the vehicle on the chip', () => {
    expect(offerChipLabel(offer())).toBe('Delivery · Sedan');
    expect(offerChipLabel(offer({ service_type: 'ride' }))).toBe('Ride · Sedan');
  });

  it('drops the vehicle from the chip rather than showing a raw enum', () => {
    // The category rides in on `estimated_fare`, so it vanishes exactly when
    // the fare does — on an unpriced category or an order with no
    // coordinates. "Delivery" alone is true; "Delivery · undefined" is not.
    expect(offerChipLabel(offer({ estimated_fare: null }))).toBe('Delivery');

    // The case that matters, and the one a title-casing fallback would let
    // through: a category the fleet adds later. "Delivery · Minibus_14" is
    // the kind of small wrongness that makes a driver distrust everything
    // else on the screen, so the chip says only what it is sure of.
    expect(withCategory('minibus_14')).toBe('Delivery');
  });

  it('spells a known category the way it is said, not the way it is stored', () => {
    // Title-casing `suv` reads "Suv". The lookup exists for this.
    expect(withCategory('suv')).toBe('Delivery · SUV');
    expect(withCategory('electric_boda')).toBe('Delivery · Electric boda');
    expect(withCategory('xl')).toBe('Delivery · XL');
  });

  it('never calls the fare "earnings"', () => {
    // The platform has no commission model and settlement is deferred
    // (ADR-0026 §3). "Earnings" would assert a split that does not exist,
    // and would keep asserting it from every installed handset the day one
    // is introduced.
    expect(estimatedFareLabel).toBe('Estimated fare');
    expect(estimatedFareLabel.toLowerCase()).not.toContain('earning');
  });
});

describe('offerAnnouncement', () => {
  it('reads the whole offer as one sentence, ending with the clock', () => {
    const spoken = offerAnnouncement(offer(), 12);

    expect(spoken).toContain('You have a new delivery request');
    expect(spoken).toContain('Geoprix Engineering Limited, Seeta');
    expect(spoken).toContain('Acacia Mall');
    expect(spoken).toContain('4.6 km away');
    expect(spoken).toContain('8.2 km journey');
    expect(spoken).toContain('Medium package');
    expect(spoken).toContain('UGX 9,000');
    // A screen-reader user gets no glance at the payment row, and whether
    // they need a float on them is a decision input like any other.
    expect(spoken).toContain('Paid by cash, receiver pays');
    expect(spoken).toMatch(/12 seconds to answer\.$/);
  });

  it('omits what the platform does not know instead of announcing gaps', () => {
    // An order taken over the phone has no coordinates, so no distances and
    // no fare. A screen reader should hear a shorter sentence, not "null km
    // away, unknown journey".
    const spoken = offerAnnouncement(
      offer({
        pickup_distance_km: null,
        trip_distance_km: null,
        estimated_fare: null,
        package: { item_type: null, package_size: null },
        payment: { payment_method: null, payer: null },
      }),
      15,
    );

    expect(spoken).not.toContain('km');
    expect(spoken).not.toContain('package');
    expect(spoken).not.toContain('UGX');
    expect(spoken).not.toContain('Paid by');
    expect(spoken.toLowerCase()).not.toContain('cash');
    expect(spoken).not.toContain('null');
    expect(spoken).not.toContain('undefined');
    expect(spoken).toContain('You have a new delivery request');
    expect(spoken).toMatch(/15 seconds to answer\.$/);
  });

  it('never speaks a number of minutes', () => {
    // ADR-0020 §3 refused to derive an ETA from a straight line. The spoken
    // version is the easiest place for one to creep back in, because nobody
    // reviews it by looking at the screen.
    expect(offerAnnouncement(offer(), 9)).not.toMatch(/\bmin(ute)?s?\b/);
  });
});
