import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { TripStatus } from '../api/types';
import { OdometerScreen } from './OdometerScreen';

/**
 * Where the odometer sends the driver when the reading is queued.
 *
 * A new suite, and narrow on purpose: it covers the navigation branch only,
 * because that branch is the seam between the live-leg screens and the
 * completion screen and it had nothing holding it in place.
 *
 * **The closing reading must not `goBack()`.** Behind this modal is the
 * live-leg screen for a trip that has just ended; landing there offers an End
 * trip button whose only outcome is a 422 out of the outbox, minutes later,
 * after the driver has put the phone down. The opening reading still goes
 * back, because there the trip carries on and the screen behind it is right.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

// `mock` prefix required: Jest hoists the factories above these declarations.
const mockQueueTransition = jest.fn(async () => undefined);
const mockUseTrip = jest.fn();

jest.mock('../offline/SyncProvider', () => ({
  useSync: () => ({ queueTransition: mockQueueTransition, sync: jest.fn() }),
}));

jest.mock('../trips/queries', () => ({
  useTrip: (id: number) => mockUseTrip(id),
}));

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: false })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
}));

const replace = jest.fn();
const goBack = jest.fn();

async function renderOdometer(
  to: Extract<TripStatus, 'trip_started' | 'trip_completed'>,
  from: TripStatus,
  // `null` means the key is absent altogether — a trip cached before the field
  // existed. Passing `undefined` cannot express that: a default parameter
  // treats an explicit `undefined` as "not supplied" and substitutes 2,000,
  // which quietly made the first version of that test assert the opposite of
  // its own name.
  ceiling: number | null = 2_000,
): Promise<ReturnType<typeof render>> {
  mockUseTrip.mockReturnValue({
    data: {
      id: 42,
      odometer_start: 104_320,
      // Served on the trip, never hardcoded here (ADR-0035).
      ...(ceiling === null ? {} : { odometer_max_km_per_trip: ceiling }),
    },
  });

  const node: ReactElement = (
    <OdometerScreen
      route={{ key: 'o', name: 'Odometer', params: { tripId: 42, to, from } }}
      navigation={{ replace, goBack, navigate: jest.fn() } as never}
    />
  );

  return render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);
}

beforeEach(() => {
  replace.mockClear();
  goBack.mockClear();
  mockQueueTransition.mockClear();
});

it('sends the driver to the completion screen once the closing reading is queued', async () => {
  const { getByPlaceholderText, getByText } = await renderOdometer('trip_completed', 'trip_started');

  // Awaited, not `void`ed. `fireEvent` is asynchronous in this setup, and an
  // unawaited `changeText` leaves the button still disabled — so the press
  // below silently does nothing and the test fails on an empty mock rather
  // than on the behaviour it is about.
  await fireEvent.changeText(getByPlaceholderText('104320'),'104332');
  void fireEvent.press(getByText('Complete trip'));

  // The queue accepts it first; only then does the screen move — so the
  // assertion has to wait for the write, not just for the press.
  await waitFor(() => expect(replace).toHaveBeenCalled());

  expect(mockQueueTransition).toHaveBeenCalledWith(
    expect.objectContaining({ tripId: 42, to: 'trip_completed', odometerEnd: 104_332 }),
  );

  // `replace`, not `navigate`: the odometer form must not sit in the stack
  // behind the completion screen, or the back gesture reopens a reading that
  // has already been queued.
  expect(replace).toHaveBeenCalledWith('RideComplete', { tripId: 42 });
  expect(goBack).not.toHaveBeenCalled();
});

it('refuses an impossible reading before it ever reaches the queue', async () => {
  // The reading that shipped: 100005 against an opening of 10001, which
  // recorded a 90,004 km journey and priced it at UGX 198,013,800.
  //
  // The server refuses it too, and authoritatively — but this screen *queues*
  // transitions rather than sending them (ADR-0023), so the server's 422
  // arrives as a parked outbox item hours later. Catching it here is the
  // difference between correcting a digit and filing a support question.
  const { getByPlaceholderText, getByText, queryByText } = await renderOdometer(
    'trip_completed',
    'trip_started',
  );

  await fireEvent.changeText(getByPlaceholderText('104320'), '1043200');

  expect(getByText(/over the 2,000 km limit/i)).toBeTruthy();

  // Named, not "invalid": a driver has to know which digit to change.
  expect(queryByText(/938,880 km/i)).toBeTruthy();

  void fireEvent.press(getByText('Complete trip'));

  await waitFor(() => expect(mockQueueTransition).not.toHaveBeenCalled());
});

it('takes the limit from the trip rather than a number of its own', async () => {
  // The office can change the ceiling in the console. A copy compiled into the
  // app would go on enforcing the old one on handsets nobody can reach — the
  // defect this codebase already records once.
  const { getByPlaceholderText, getByText } = await renderOdometer(
    'trip_completed',
    'trip_started',
    50,
  );

  // 60 km clears the shipped default of 2,000 comfortably and is still
  // refused, because this trip says 50.
  await fireEvent.changeText(getByPlaceholderText('104320'), '104380');

  expect(getByText(/over the 50 km limit/i)).toBeTruthy();
});

it('does not invent a limit for a trip cached before the field existed', async () => {
  // No local opinion, rather than a limit of zero. The server still enforces
  // it; refusing a legitimate reading because the payload is old would be
  // worse than letting the 422 arrive late.
  const { getByPlaceholderText, getByText, queryByText } = await renderOdometer(
    'trip_completed',
    'trip_started',
    null,
  );

  await fireEvent.changeText(getByPlaceholderText('104320'), '1043200');

  expect(queryByText(/km limit/i)).toBeNull();

  void fireEvent.press(getByText('Complete trip'));

  await waitFor(() => expect(mockQueueTransition).toHaveBeenCalled());
});

it('goes back on the opening reading, because the trip carries on', async () => {
  const { getByPlaceholderText, getByText } = await renderOdometer('trip_started', 'passenger_onboard');

  // Awaited, not `void`ed. `fireEvent` is asynchronous in this setup, and an
  // unawaited `changeText` leaves the button still disabled — so the press
  // below silently does nothing and the test fails on an empty mock rather
  // than on the behaviour it is about.
  await fireEvent.changeText(getByPlaceholderText('104320'),'104320');
  void fireEvent.press(getByText('Start trip'));

  await waitFor(() => expect(goBack).toHaveBeenCalled());

  expect(goBack).toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
});
