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
): Promise<ReturnType<typeof render>> {
  mockUseTrip.mockReturnValue({ data: { id: 42, odometer_start: 104_320 } });

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
