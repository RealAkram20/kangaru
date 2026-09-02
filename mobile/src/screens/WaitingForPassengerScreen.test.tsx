import { act, fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { Trip, TripEvent, TripStatus } from '../api/types';
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
let mockQueued = new Map<number, TripStatus>();

// `mock` prefix required: Jest hoists mock factories above this line.
const mockOdometerEnabled = jest.fn(() => true);

/*
  ADR-0047's odometer switch. Mocked at the hook rather than left real because
  it reaches `AuthProvider` and the network, which this suite has neither of —
  the same reason `../trips/queries` is mocked above.

  **Defaults to on**, so every existing test in this file keeps asserting the
  behaviour it was written for: the odometer is the platform's default and the
  screens that ask for a reading should go on asking for one here.
*/
jest.mock('../trips/odometerSetting', () => ({
  useOdometerEnabled: () => mockOdometerEnabled(),
}));

jest.mock('../offline/SyncProvider', () => ({
  // `queued` is the outbox's pending transitions, keyed by trip — the header
  // reads it so a queued arrival is not contradicted by the status the office
  // last confirmed. Empty unless a test is about a move that has not gone out.
  useSync: () => ({ queueTransition: mockQueueTransition, sync: jest.fn(), queued: mockQueued }),
}));

jest.mock('../ui/SyncBanner', () => ({ SyncBanner: () => null }));

// `mock` prefix required: Jest hoists the factory below above these
// declarations, and only names matching /^mock/ may be referenced inside one.
const mockUseTrip = jest.fn();
const mockUseTripEvents = jest.fn();
const mockNavigate = jest.fn();
const mockReplace = jest.fn();

jest.mock('../trips/queries', () => ({
  useTrip: (id: number) => mockUseTrip(id),
  // The road route is decoration over a map that already works; these
  // suites are about the screen, so it is simply absent here.
  useTripRoute: () => ({ data: null }),
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
  variance_threshold_percent: 10,
  provisional_fare: null,
  distance: null,
    payment: null,
    odometer_start: null,
    odometer_end: null,
    odometer_start_photo_url: null,
    odometer_end_photo_url: null,
    distance_km: null,
    gps_distance_km: null,
    distance_variance_flagged: null,
    unplanned_stop_count: 0,
    dropoff_reached_at: null,
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
      navigation={{ navigate: mockNavigate, replace: mockReplace, goBack: jest.fn() } as never}
    />
  );

  return render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);
}

beforeEach(() => {
  // On by default in every test. A suite that wants the switch off says so,
  // and must not leak that into the next one (ADR-0047).
  mockOdometerEnabled.mockReturnValue(true);
  mockNavigate.mockClear();
  mockReplace.mockClear();
  mockQueueTransition.mockClear();
  // Nothing in flight is the ordinary case; the header test below sets it.
  mockQueued = new Map();
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

/** Enough turns of the microtask queue for a press that awaits two queue writes. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
}

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

it('takes the opening reading at the kerb, and one press boards and starts', async () => {
  // The owner's ruling: fewer clicks — "when we onboard the client it
  // automatically starts the trip". Before this the press opened a second
  // screen with its own button. Now the reading is typed here and the one
  // press queues boarding and the start together, in order, from one act.
  const { getByLabelText, getByText } = await renderWaiting();

  await fireEvent.changeText(getByLabelText('Kilometres'), '104320');
  // Flushed inside `act` rather than polled with `waitFor`: this file runs on
  // fake timers, and a polling `waitFor` here leaves every later render in
  // the file empty. The press resolves in a handful of microtasks.
  await act(async () => {
    void fireEvent.press(getByText('Passenger on board'));
    await flushMicrotasks();
  });

  expect(mockQueueTransition).toHaveBeenCalledTimes(2);
  expect(mockQueueTransition).toHaveBeenNthCalledWith(1, {
    tripId: 42,
    from: 'driver_arrived',
    to: 'passenger_onboard',
  });
  expect(mockQueueTransition).toHaveBeenNthCalledWith(2, {
    tripId: 42,
    from: 'passenger_onboard',
    to: 'trip_started',
    odometerStart: 104320,
    photoUri: null,
  });

  // Straight to the trip in progress, and not left in the stack behind it.
  expect(mockReplace).toHaveBeenCalledWith('TripInProgress', { tripId: 42 });
  expect(mockNavigate).not.toHaveBeenCalledWith('Odometer', expect.anything());
});

it('commits nothing until the reading is there', async () => {
  // The server requires `odometer_start` for `trip_started`, so a press
  // without one would queue a boarding whose start could never follow — the
  // stranded-at-passenger_onboard trip this screen was rewritten to prevent.
  const { getByText } = await renderWaiting();

  void fireEvent.press(getByText('Passenger on board'));

  expect(mockQueueTransition).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

it('keeps the reading on screen when the queue refuses it', async () => {
  mockQueueTransition.mockRejectedValueOnce(new Error('database not open'));

  const { getByLabelText, getByText } = await renderWaiting();

  await fireEvent.changeText(getByLabelText('Kilometres'), '104320');
  await act(async () => {
    void fireEvent.press(getByText('Passenger on board'));
    await flushMicrotasks();
  });

  expect(getByText(/Could not save/)).toBeTruthy();

  expect(mockReplace).not.toHaveBeenCalled();
});

it('offers Passenger on board and nothing that would be refused', async () => {
  const { getByText, queryByText } = await renderWaiting();

  expect(getByText('Passenger on board')).toBeTruthy();
  expect(queryByText('Start Trip')).toBeNull();

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

it('says what the driver asked for, not what the office last confirmed', async () => {
  // The owner's handset, in a dead zone: **"Waiting for Passenger" over "On
  // the way"**, with "Sending 1 update…" between them. The screen is reached
  // by queueing `driver_arrived` and replacing the pickup screen, so the
  // subtitle was reporting a status the driver had already moved past — a
  // title and a subtitle contradicting each other on the same header.
  mockQueued = new Map([[42, 'driver_arrived']]);

  const { getByText, queryByText } = await renderWaiting(
    // What the office still believes, because the transition has not gone out.
    trip({ status: 'driver_en_route' }),
  );

  expect(getByText('Arrived at pickup')).toBeTruthy();
  expect(queryByText('On the way')).toBeNull();
});

it('falls back to the office when nothing is queued', async () => {
  // The ordinary case, and the reason this reads the outbox rather than
  // inventing a status: an item that drains — or one the server refuses —
  // leaves `queued`, and the screen returns to the server's truth.
  const { getByText } = await renderWaiting(trip({ status: 'driver_arrived' }));

  expect(getByText('Arrived at pickup')).toBeTruthy();
});

// -- With the odometer switched off (ADR-0047) -----------------------------

it('drops the opening reading entirely when the office has switched it off', async () => {
  mockOdometerEnabled.mockReturnValue(false);

  const { queryByText, queryByLabelText } = await renderWaiting();

  // Gone, heading included. A disabled or optional field would be worse than
  // either state: a driver reads a labelled input as something the office
  // wants, and an empty one they were allowed to skip looks like it failed to
  // save.
  expect(queryByText('Opening odometer')).toBeNull();
  expect(queryByLabelText('Kilometres')).toBeNull();
});

it('boards and starts in one press, sending no reading at all', async () => {
  // **The failure this pins is `NaN`.** `Number.parseInt('', 10)` is `NaN`,
  // which serialises to `null` and would reach a server willing to record it
  // as a real opening of nothing — so the key must be absent, not empty.
  mockOdometerEnabled.mockReturnValue(false);

  const { getByText } = await renderWaiting();

  await act(async () => {
    void fireEvent.press(getByText('Passenger on board'));
    await flushMicrotasks();
  });

  expect(mockQueueTransition).toHaveBeenCalledWith(
    expect.objectContaining({ to: 'passenger_onboard' }),
  );

  expect(mockQueueTransition).toHaveBeenCalledWith(
    expect.objectContaining({ to: 'trip_started' }),
  );

  // The key is absent, not present-and-empty. `expect.anything()` matches
  // neither `undefined` nor `null`, so this fails the moment a reading of any
  // kind is attached.
  expect(mockQueueTransition).not.toHaveBeenCalledWith(
    expect.objectContaining({ odometerStart: expect.anything() }),
  );

  expect(mockReplace).toHaveBeenCalled();
});

it('still refuses to commit without a reading while the odometer is on', async () => {
  // The default path, pinned beside its opposite so a change to one cannot
  // quietly alter the other.
  mockOdometerEnabled.mockReturnValue(true);

  const { getByText } = await renderWaiting();

  void fireEvent.press(getByText('Passenger on board'));

  expect(mockQueueTransition).not.toHaveBeenCalled();
});
