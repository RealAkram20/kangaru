import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { DispatchOffer } from '../api/types';
import { OfferScreen } from './OfferScreen';

/**
 * The screen reads `useSafeAreaInsets`, which throws outside a provider
 * rather than defaulting to zero. Supplying metrics by hand is what the
 * library asks of tests — the alternative is mocking the hook, which would
 * also mock away the notch padding this screen depends on to keep its header
 * out from under a status bar.
 *
 * Queries come off `render`'s return value rather than the library's global
 * `screen`. That global is not wired up in this project — it has had no
 * component tests until now — and a suite is not the place to configure it.
 */
const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

/**
 * The screen owns three long-running clocks — a one-second countdown tick, an
 * eighteen-second ring drain, and a 220ms entrance — and every one of them
 * schedules frames a test finishes long before. Left on real timers they go
 * on firing into an environment Jest has already dismantled, which floods the
 * output with teardown errors that look like failures and hide real ones.
 *
 * Fake timers keep the clocks under the test's control; the pending queue is
 * flushed on the way out so nothing survives into the next case.
 */
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

async function withSafeArea(node: ReactElement) {
  return render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);
}

async function renderOffer(value: DispatchOffer = offer()) {
  return withSafeArea(
    <OfferScreen
      offer={value}
      onAccept={jest.fn()}
      onDecline={jest.fn()}
      onDismiss={jest.fn()}
      pending={null}
      error={null}
    />,
  );
}

/**
 * That the offer screen renders, and renders the right things.
 *
 * Deliberately narrow. `offerPresentation.test.ts` owns the arithmetic and
 * the wording; this suite exists because none of that proves the screen
 * *mounts* — an SVG ring, a safe-area hook and an accessibility query are
 * three ways for a screen to be perfectly correct and blank. It also pins
 * the two rules that would otherwise only live in a comment:
 *
 * - no minutes anywhere (ADR-0020 §3 refused to derive an ETA from a
 *   straight line, and this screen is where one would be added);
 * - an em dash rather than a figure wherever the platform does not know;
 * - nothing identifying the passenger, which ADR-0024 §7 withholds until
 *   after the accept — and no rating or trip count, which the platform has
 *   never collected from anybody.
 */
function offer(overrides: Partial<DispatchOffer> = {}): DispatchOffer {
  return {
    id: 42,
    status: 'offered',
    expires_at: '2026-08-14T10:00:15+03:00',
    expires_in_seconds: 18,
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

it('shows the job: what, where, how far, how big, what it pays', async () => {
  const { getByText } = await renderOffer();

  expect(getByText('New delivery request')).toBeTruthy();
  expect(getByText('You have a new delivery request')).toBeTruthy();

  expect(getByText('Geoprix Engineering Limited, Seeta')).toBeTruthy();
  expect(getByText('Acacia Mall, 14-18 Cooper Rd')).toBeTruthy();

  // Two distances, not one. The pickup leg and the journey answer different
  // questions and the screen is only useful if both are on it.
  expect(getByText('4.6 km')).toBeTruthy();
  expect(getByText('8.2 km')).toBeTruthy();

  expect(getByText('Medium')).toBeTruthy();
  expect(getByText('UGX 9,000')).toBeTruthy();

  // How it settles, and which end settles it — the fact that decides whether
  // a driver needs a float on them before they set off.
  expect(getByText('Cash')).toBeTruthy();
  expect(getByText('Receiver pays')).toBeTruthy();

  // Which service, in which vehicle, over the seam between band and sheet.
  expect(getByText('Delivery · Sedan')).toBeTruthy();
  expect(getByText('KR-ABC234')).toBeTruthy();

  expect(getByText('Accept')).toBeTruthy();
  expect(getByText('Decline')).toBeTruthy();
});

it('puts nothing about the passenger on a screen shown before the accept', async () => {
  // ADR-0024 §7 by name, and the reason it is asserted rather than trusted:
  // this payload is also what a push notification is built from, so anything
  // added here lands on a lock screen. The mockup this screen was built from
  // carried a photograph, a name, a star rating, a trip count and a loyalty
  // badge — the first is withheld and the other three have never existed on
  // this platform at all.
  const { queryByText } = await renderOffer();

  expect(queryByText(/rider/i)).toBeNull();
  expect(queryByText(/passenger/i)).toBeNull();
  expect(queryByText(/\btrips?\b/i)).toBeNull();
  expect(queryByText(/★|4\.8|rating/i)).toBeNull();
});

it('never guesses cash for an order that did not say how it pays', async () => {
  // The one wrong default this row can hold. It renders the gap and says so
  // in words, rather than filling it with the plausible answer.
  const { getByText, queryByText } = await renderOffer(
    offer({ payment: { payment_method: null, payer: null } }),
  );

  expect(queryByText('Cash')).toBeNull();
  expect(getByText('Payment')).toBeTruthy();
  expect(getByText('Not stated on the order')).toBeTruthy();
});

it('calls the money a fare and never earnings', async () => {
  const { getByText, queryByText } = await renderOffer();

  expect(getByText('Estimated fare')).toBeTruthy();
  expect(queryByText(/earnings/i)).toBeNull();
});

it('shows no ETA, because the platform cannot honestly derive one', async () => {
  // ADR-0020 §3 by name. This screen is exactly where a "15 min" would be
  // added by somebody working from a mockup, and it would run short in front
  // of a passenger every time — real roads are longer than the crow's flight.
  const { queryByText } = await renderOffer();

  expect(queryByText(/\bmin(ute)?s?\b/i)).toBeNull();
  expect(queryByText(/\bETA\b/i)).toBeNull();
});

it('renders an em dash rather than a figure for an order taken over the phone', async () => {
  // No coordinates at either end, so no distances and nothing to price. The
  // row keeps its shape; it just stops claiming to know things.
  const { getAllByText, getByText, queryByText } = await renderOffer(
    offer({
      pickup_distance_km: null,
      trip_distance_km: null,
      estimated_fare: null,
    }),
  );

  expect(getAllByText('—').length).toBeGreaterThanOrEqual(3);
  expect(queryByText(/UGX/)).toBeNull();

  // And it says why the price is missing, rather than leaving a driver to
  // wonder whether the job pays nothing.
  expect(getByText(/No published price for this vehicle yet/)).toBeTruthy();
});

it('names the client and the time on a desk-assigned job, and neither on a walk-in', async () => {
  // ADR-0068: the desk's assignment now rings on this same screen. `client`
  // is what separates the two channels — a walk-in belongs to no client — so
  // one screen serves both without a second flag to keep in step.
  const { getByText } = await renderOffer(
    offer({ client: 'Stanbic Bank', scheduled_for_label: 'Tue 2 Sep, 04:00 PM' }),
  );

  expect(getByText('Stanbic Bank')).toBeTruthy();

  // The time is rendered from the *server's* string. A driver saying yes to
  // Tuesday is answering a different question from one saying yes to a
  // passenger at a kerb, and an hour computed on the handset would be the
  // wrong hour — `trips/history.ts` records why.
  expect(getByText('Tue 2 Sep, 04:00 PM')).toBeTruthy();
});

it('shows no client row on a walk-in, which belongs to nobody', async () => {
  const { queryByText } = await renderOffer(offer({ client: null }));

  expect(queryByText('Client')).toBeNull();
});

it('drops the package cell on a ride instead of leaving a hole in the row', async () => {
  const { getByText, queryByText } = await renderOffer(offer({ service_type: 'ride', package: null }));

  expect(getByText('New ride request')).toBeTruthy();
  expect(queryByText('Package')).toBeNull();
  expect(getByText('To pickup')).toBeTruthy();
  expect(getByText('Journey')).toBeTruthy();
});

it('announces the whole offer as one sentence for a screen reader', async () => {
  // The grid linearises into disconnected numbers otherwise. Under a
  // fifteen-second clock a driver needs "what, where, how much, how long" as
  // one utterance.
  const { getByLabelText } = await renderOffer();

  const announced = getByLabelText(/You have a new delivery request/);

  expect(announced.props.accessibilityLabel).toContain('Geoprix Engineering Limited');
  expect(announced.props.accessibilityLabel).toContain('UGX 9,000');
  expect(announced.props.accessibilityLabel).toMatch(/seconds to answer\.$/);
});

it('leaves the driver a way out that is not a decline', async () => {
  // Dismissing is "not now", and the clock keeps running. Turning it into a
  // decline would cost a driver a fare they never refused.
  const onDismiss = jest.fn();
  const onDecline = jest.fn();

  const { getByLabelText } = await withSafeArea(
    <OfferScreen
      offer={offer()}
      onAccept={jest.fn()}
      onDecline={onDecline}
      onDismiss={onDismiss}
      pending={null}
      error={null}
    />,
  );

  expect(getByLabelText('Close, and leave the job running')).toBeTruthy();
  expect(onDecline).not.toHaveBeenCalled();
});

it('shows the server\'s own sentence when an answer failed', async () => {
  const { getByText } = await withSafeArea(
    <OfferScreen
      offer={offer()}
      onAccept={jest.fn()}
      onDecline={jest.fn()}
      onDismiss={jest.fn()}
      pending={null}
      error="That job has already gone to another driver."
    />,
  );

  expect(getByText('That job has already gone to another driver.')).toBeTruthy();
});
