import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { Trip, TripEvent } from '../api/types';
import { WaitingForPassengerScreen } from './WaitingForPassengerScreen';

/**
 * That the waiting screen mounts, and shows only what the platform has.
 *
 * `waiting.test.ts` owns the arithmetic. This suite exists because arithmetic
 * does not prove a screen renders — a WebView, a ticking interval and a
 * navigation prop are three ways for a screen to be perfectly correct and
 * blank — and because four of the rules below would otherwise live only in a
 * comment, where nothing enforces them:
 *
 * - **No Cancel Trip button.** `TripPolicy` withholds `cancelled` and
 *   `no_show` from a driver, so the mockup's red button was a 403 on every
 *   press. `TripPolicyTest` proves the server's half; this proves the app
 *   never offers it.
 * - **No rating and no avatar.** ADR-0030's ratings run the other way and
 *   customers have no photograph.
 * - **No claim that the passenger was notified.** Nothing notifies them.
 * - **An em dash, never a zero, when the arrival is not known.** `00:00` on a
 *   screen whose job is saying how long you have waited is the worst possible
 *   wrong answer.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

const ARRIVED_AT = '2026-08-14T09:15:00.000Z';

// `mock` prefix required: Jest hoists the factory below above this declaration.
const mockQueueTransition = jest.fn(async () => undefined);

jest.mock('../offline/SyncProvider', () => ({
  useSync: () => ({ queueTransition: mockQueueTransition, sync: jest.fn() }),
}));

jest.mock('../ui/SyncBanner', () => ({ SyncBanner: () => null }));

// `mock` prefix required: Jest hoists the factory below above these
// declarations, and only names matching /^mock/ may be referenced inside one.
const mockUseTrip = jest.fn();
const mockUseTripEvents = jest.fn();
const mockNavigate = jest.fn();

jest.mock('../trips/queries', () => ({
  useTrip: (id: number) => mockUseTrip(id),
  useTripEvents: (id: number) => mockUseTripEvents(id),
}));

function arrivalEvent(createdAt: string | null = ARRIVED_AT): TripEvent {
  return {
    id: 4,
    trip_id: 42,
    from_status: 'driver_en_route',
    to_status: 'driver_arrived',
    user_id: 3,
    notes: null,
    created_at: createdAt,
    local_day: null,
    local_time: null,
  };
}

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 42,
    tenant_id: null,
    customer_id: 9,
    booking_id: null,
    vehicle_id: 7,
    driver_id: 3,
    origin: 'Acacia Mall, 14-18 Cooper Rd',
    destination: 'Kololo Airstrip',
    pickup: { label: 'Acacia Mall, 14-18 Cooper Rd', latitude: 0.3676, longitude: 32.5825 },
    dropoff: { label: 'Kololo Airstrip', latitude: 0.3376, longitude: 32.5925 },
    service_type: 'ride',
    reference: null,
    package: null,
    status: 'driver_arrived',
    // Exactly what the server allows from here. The screen must offer one of
    // the three, and the test below names the two it must not.
    allowed_transitions: ['passenger_onboard', 'no_show', 'cancelled'],
    pickup_wait_target_seconds: 300,
    odometer_max_km_per_trip: 2000,
    payment: null,
    odometer_start: null,
    odometer_end: null,
    odometer_start_photo_url: null,
    odometer_end_photo_url: null,
    distance_km: null,
    gps_distance_km: null,
    distance_variance_flagged: null,
    started_at: null,
    completed_at: null,
    duration_minutes: null,
    fare: null,
    estimated_fare: null,
    earnings: null,
    passenger_contact: { name: 'Sarah N.', phone: '+256700123456', label: 'Passenger' },
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

async function renderWaiting(
  value: Trip = trip(),
  events: TripEvent[] | undefined = [arrivalEvent()],
): Promise<ReturnType<typeof render>> {
  mockUseTrip.mockReturnValue({ data: value, isLoading: false });
  mockUseTripEvents.mockReturnValue({ data: events });

  const node: ReactElement = (
    <WaitingForPassengerScreen
      route={{ key: 'w', name: 'WaitingForPassenger', params: { tripId: value.id } }}
      navigation={{ navigate: mockNavigate, goBack: jest.fn() } as never}
    />
  );

  return render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);
}

beforeEach(() => {
  mockNavigate.mockClear();
  mockQueueTransition.mockClear();
  jest.useFakeTimers();
  // 105 seconds after the arrival — the mockup's own 01:45, so the figure on
  // screen can be compared against the picture this was built from.
  jest.setSystemTime(new Date(Date.parse(ARRIVED_AT) + 105_000));
});

afterEach(() => {
  jest.useRealTimers();
});

/**
 * The ring's contents are *deliberately* outside the accessibility tree —
 * `WaitingRing` sets `accessibilityElementsHidden` so a screen reader is not
 * interrupted by a bare number every second, and the screen announces the whole
 * waiting state as one sentence instead (asserted at the bottom of this file).
 *
 * Testing Library honours that and excludes hidden elements from queries by
 * default, so reading the *visual* figure has to opt in. Written out rather
 * than tucked into a helper, because the flag is the point: if it ever stops
 * being needed here, the ring has stopped being hidden and the announcement
 * has quietly gained a competitor.
 */
const VISUAL = { includeHiddenElements: true } as const;

it('counts the wait from the arrival recorded on the timeline', async () => {
  const { getByText } = await renderWaiting();

  expect(getByText('01:45', VISUAL)).toBeTruthy();
  expect(getByText('waiting time', VISUAL)).toBeTruthy();
});

it('renders an em dash, not a zero, when the arrival is not on the timeline yet', async () => {
  // Offline with a cache taken before the arrival posted, or the second
  // request still in flight. `00:00` here would tell a driver who has been
  // standing there for eight minutes that they have just pulled up.
  const { getByText, queryByText } = await renderWaiting(trip(), []);

  expect(getByText('—', VISUAL)).toBeTruthy();
  expect(queryByText('00:00', VISUAL)).toBeNull();
  expect(getByText('Waiting time shows once your arrival reaches the office.')).toBeTruthy();
});

it('opens the opening reading without committing anything', async () => {
  // This press used to queue `passenger_onboard` before the reading existed.
  // A driver who then backed out of the form left the trip committed to a
  // state whose only screen is that same form — no way back to here, and the
  // server requires the reading before `trip_started` will move. Both
  // transitions are now queued by the odometer's single submit.
  const { getByText } = await renderWaiting();

  void fireEvent.press(getByText('Start Trip'));

  await waitFor(() => expect(mockNavigate).toHaveBeenCalled());

  expect(mockQueueTransition).not.toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  // `from` is the trip's real status, not the one that used to be queued ahead
  // of it: the odometer reads it to decide whether boarding still needs posting.
  expect(mockNavigate).toHaveBeenCalledWith('Odometer', {
    tripId: 42,
    to: 'trip_started',
    from: 'driver_arrived',
  });
});

it('offers Start Trip and nothing that would be refused', async () => {
  const { getByText, queryByText } = await renderWaiting();

  expect(getByText('Start Trip')).toBeTruthy();

  // The mockup's red button. `TripPolicy::DRIVER_JOURNEY_STATES` withholds
  // both of these from a driver, so either would 403 on every press — even
  // though `allowed_transitions` above lists them as legal from this state.
  expect(queryByText('Cancel Trip')).toBeNull();
  expect(queryByText(/cancel/i)).toBeNull();
  expect(queryByText(/no show/i)).toBeNull();
});

it('shows the passenger and a way to ring them, and no score for them', async () => {
  const { getByText, getByLabelText, queryByText } = await renderWaiting();

  expect(getByText('Sarah N.')).toBeTruthy();
  expect(getByLabelText('Call Sarah N.')).toBeTruthy();

  // ADR-0030: the customer rates the driver, not the reverse. A star beside a
  // passenger's name would invert the glyph's meaning platform-wide.
  expect(queryByText('4.8')).toBeNull();
  expect(queryByText(/^[0-5]\.[0-9]$/)).toBeNull();
});

it('does not claim the passenger was notified, because nothing notifies them', async () => {
  const { queryByText, getByText } = await renderWaiting();

  expect(queryByText(/notified/i)).toBeNull();
  // The "if" is the guard: nothing notifies the passenger, and their screen
  // shows this only while it is open.
  expect(getByText("Shown on the passenger's screen, if it is open.")).toBeTruthy();
});

it('offers no chat, because this platform has no messaging', async () => {
  const { queryByText, queryByLabelText } = await renderWaiting();

  expect(queryByText(/chat/i)).toBeNull();
  expect(queryByLabelText(/chat/i)).toBeNull();
});

it('offers Navigate only when the pickup has coordinates', async () => {
  const { getByLabelText } = await renderWaiting();

  expect(getByLabelText('Navigate to Acacia Mall, 14-18 Cooper Rd')).toBeTruthy();

  // A trip keyed in at the desk has no coordinates, and every corporate trip
  // has none. Handing a maps app a half-resolved position is what `located()`
  // exists to prevent.
  const { queryByLabelText } = await renderWaiting(
    trip({ pickup: { label: 'Acacia Mall', latitude: null, longitude: null } }),
  );

  expect(queryByLabelText(/^Navigate to/)).toBeNull();
});

it('announces the wait as one sentence rather than leaving digits to linearise', async () => {
  const { getByLabelText } = await renderWaiting();

  expect(getByLabelText('Waiting 1 minute 45 seconds.')).toBeTruthy();
});
