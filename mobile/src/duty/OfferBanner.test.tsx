import { fireEvent, render } from '@testing-library/react-native';

import type { DispatchOffer } from '../api/types';
import { OfferBanner } from './OfferBanner';

/**
 * The offer banner (ADR-0049 §5) — the owner's mockup, at phone proportions.
 *
 * What is worth asserting here is not the layout, which a test cannot see. It
 * is the four facts the card exists to carry, the two answers it offers, and
 * the several ways each of those facts can be absent from a real payload.
 */

function offer(over: Partial<DispatchOffer> = {}): DispatchOffer {
  return {
    id: 41,
    status: 'offered',
    expires_at: '2026-08-21T09:00:45Z',
    expires_in_seconds: 45,
    pickup: { label: 'Kampala Road', latitude: 0.3136, longitude: 32.5811 },
    dropoff: { label: 'Ntinda', latitude: 0.3536, longitude: 32.6111 },
    service_type: 'ride',
    reference: 'TRP-0001',
    pickup_distance_km: 2.4,
    trip_distance_km: 6,
    reasons: [],
    package: null,
    payment: { payment_method: 'cash', payer: 'passenger' },
    estimated_fare: {
      vehicle_category: 'sedan',
      distance_km: 6,
      total_minor: 12500,
      currency: 'UGX',
      is_estimate: true,
      basis: 'Straight-line distance.',
    },
    vehicle_id: null,
    ...over,
  } as DispatchOffer;
}

/**
 * **`await render`, not `render`.** Testing Library v14's render is
 * asynchronous; spreading it without awaiting leaves `screen` unpopulated and
 * every query fails with *"`render` function has not been called"* — which
 * reads exactly like a component that threw, and sent me looking at the
 * component first.
 *
 * **And `findBy*` rather than `getBy*` for anything this suite renders after
 * the first test.** Awaiting `render` is not enough on its own: the opening
 * mount commits synchronously, later ones commit on a concurrent lane, and a
 * `getBy*` immediately after reads the tree before that commit lands. The
 * symptom is the cruellest available — the three tests that expect *different*
 * content from the first fail, while the component renders all of them
 * correctly, and each one passes when run alone.
 *
 * **And `await fireEvent.press`.** In this version the press is asynchronous
 * too. An un-awaited one leaves work pending past the end of the test, and the
 * damage lands on the *next* test rather than its own: the render after it
 * commits nothing at all, `toJSON()` comes back null, and the failure is
 * attributed to a component three tests away. Bisecting the suite is what
 * found it — "refuses a second answer", which presses twice, was poisoning
 * everything after it.
 */
async function draw(
  over: Partial<DispatchOffer> = {},
  props: Partial<Parameters<typeof OfferBanner>[0]> = {},
) {
  const onAccept = jest.fn();
  const onDecline = jest.fn();
  const onOpen = jest.fn();

  const rendered = await render(
    <OfferBanner
      offer={offer(over)}
      onAccept={onAccept}
      onDecline={onDecline}
      onOpen={onOpen}
      pending={null}
      {...props}
    />,
  );

  return { onAccept, onDecline, onOpen, ...rendered };
}

describe('OfferBanner', () => {
  it('carries the four facts the mockup carries', async () => {
    const view = await draw();

    expect(view.getByText('New ride request')).toBeTruthy();
    expect(view.getByText('Pickup: Kampala Road')).toBeTruthy();
    expect(view.getByText('2.4 km away')).toBeTruthy();
    expect(view.getByText('UGX 12,500')).toBeTruthy();
  });

  /**
   * **The mockup says "15 min trip" and this says kilometres.** ADR-0020 §3
   * refused to derive minutes from a straight-line distance by name, because
   * the figure would run short and would run short in front of a passenger.
   * If a duration ever appears here it must have come from the server.
   */
  it('shows the journey distance and never invents a duration', async () => {
    const view = await draw();

    expect(view.getByText('6.0 km trip')).toBeTruthy();
    expect(view.queryByText(/min trip/)).toBeNull();
  });

  it('answers with accept', async () => {
    const { onAccept, onDecline, ...view } = await draw();
    await view.findByText('Pickup: Kampala Road');

    await fireEvent.press(view.getByLabelText('Accept'));

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDecline).not.toHaveBeenCalled();
  });

  it('answers with decline', async () => {
    const { onAccept, onDecline, ...view } = await draw();
    await view.findByText('Pickup: Kampala Road');

    await fireEvent.press(view.getByLabelText('Decline'));

    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  /**
   * The banner carries four facts; the full screen carries the drop-off, the
   * payment method and the countdown ring. Tapping the card is the way from
   * one to the other, and without it the compact surface would be a
   * downgrade rather than a first step.
   */
  it('opens the whole offer when the card itself is tapped', async () => {
    const { onOpen, ...view } = await draw();
    const card = await view.findByLabelText(/Open the full offer/);

    await fireEvent.press(card);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  /**
   * A single `busy` flag was wrong on `OfferScreen` for the same reason: it
   * tells a driver under a clock that the app is doing the opposite of what
   * they asked. Both buttons stop taking presses; only the other one dims.
   */
  it('refuses a second answer while one is in flight', async () => {
    const { onAccept, onDecline, ...view } = await draw({}, { pending: 'accept' });
    await view.findByText('Pickup: Kampala Road');

    await fireEvent.press(view.getByLabelText('Accept'));
    await fireEvent.press(view.getByLabelText('Decline'));

    expect(onAccept).not.toHaveBeenCalled();
    expect(onDecline).not.toHaveBeenCalled();
  });

  /**
   * An order taken over the phone has no coordinates, and a category nobody
   * priced has no fare. An em dash says "nobody said", which is true; a zero
   * would be a number the driver could not collect.
   */
  it('renders an em dash rather than a number it does not have', async () => {
    const view = await draw({ pickup_distance_km: null, trip_distance_km: null, estimated_fare: null });

    expect(await view.findAllByText('—')).toHaveLength(3);
    expect(view.queryByText(/UGX 0/)).toBeNull();
  });

  it('says something honest when the pickup has no address', async () => {
    const view = await draw({ pickup: { label: null, latitude: null, longitude: null } });

    expect(await view.findByText('Pickup nearby')).toBeTruthy();
    expect(view.queryByText(/null/)).toBeNull();
  });

  it('names a delivery as a delivery', async () => {
    const view = await draw({ service_type: 'delivery' });

    expect(await view.findByText('New delivery request')).toBeTruthy();
  });

  /**
   * A lock screen is readable by whoever is holding the phone, and this card
   * is painted over one. ADR-0024 §7 releases the passenger's identity only
   * after the accept.
   */
  it('names no passenger', async () => {
    const view = await draw();

    expect(view.queryByText(/passenger/i)).toBeNull();
  });
});
