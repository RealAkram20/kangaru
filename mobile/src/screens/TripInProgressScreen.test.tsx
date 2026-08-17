import { fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { Trip, TripEvent } from '../api/types';
import { TripInProgressScreen } from './TripInProgressScreen';

/**
 * That the trip-in-progress screen mounts, and shows only what the platform
 * has.
 *
 * `progress.test.ts` owns the arithmetic and the wording. This suite exists
 * because neither proves the screen renders, and because five of the rules
 * below would otherwise live only in a docblock, where nothing enforces them:
 *
 * - **No minutes and no clock time.** ADR-0020 §3. The mockup carried "12 min"
 *   *and* "ETA 10:05 AM"; the second is a promise made to somebody sitting in
 *   the car.
 * - **No rating and no avatar** for the passenger — ADR-0030 runs the other
 *   way, and customers have no photograph.
 * - **No "Applepay"**, and no raw payment token either.
 * - **An em dash, never a zero**, wherever the platform cannot answer.
 * - **End trip goes to the odometer**, because `trip_completed` requires the
 *   closing reading and posting it bare would 422.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

const STARTED_AT = '2026-08-14T09:18:00.000Z';

jest.mock('../ui/SyncBanner', () => ({ SyncBanner: () => null }));

// `mock` prefix required: Jest hoists the factory below above this line.
const mockQueueTransition = jest.fn(async () => undefined);

jest.mock('../offline/SyncProvider', () => ({
  useSync: () => ({ queueTransition: mockQueueTransition, sync: jest.fn() }),
}));

// `mock` prefix required: Jest hoists the factories above these declarations.
const mockUseTrip = jest.fn();
const mockUseTripEvents = jest.fn();
const mockPosition = jest.fn();
const mockUseTripRoute = jest.fn();

jest.mock('../trips/queries', () => ({
  useTrip: (id: number) => mockUseTrip(id),
  useTripEvents: (id: number) => mockUseTripEvents(id),
  useTripRoute: () => mockUseTripRoute(),
}));

jest.mock('../location/usePosition', () => ({
  usePosition: (options?: unknown) => mockPosition(options),
}));

function startEvent(createdAt: string | null = STARTED_AT): TripEvent {
  return {
    id: 6,
    trip_id: 42,
    from_status: 'passenger_onboard',
    to_status: 'trip_started',
    user_id: 3,
    notes: null,
    created_at: createdAt,
    // The server's fleet-zone rendering of the same instant. This screen does
    // arithmetic on `created_at` and never reads these; the trip record draws
    // its rail from them.
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
    pickup: { label: 'Acacia Mall, 14-18 Cooper Rd', latitude: 0.3476, longitude: 32.5825 },
    dropoff: { label: 'Kololo Airstrip', latitude: 0.3676, longitude: 32.5825 },
    service_type: 'ride',
    reference: null,
    package: null,
    status: 'trip_started',
    allowed_transitions: ['waiting', 'trip_completed'],
    pickup_wait_target_seconds: 300,
    odometer_max_km_per_trip: 2000,
    payment: { payment_method: 'cash', payer: null },
    odometer_start: 15_000,
    odometer_end: null,
    odometer_start_photo_url: null,
    odometer_end_photo_url: null,
    distance_km: null,
    gps_distance_km: null,
    distance_variance_flagged: null,
    started_at: STARTED_AT,
    completed_at: null,
    duration_minutes: null,
    fare: null,
    estimated_fare: {
      vehicle_category: 'sedan',
      distance_km: 4.6,
      total_minor: 18_450,
      currency: 'UGX',
      is_estimate: true,
      basis: 'Straight-line distance. The final fare follows the distance actually travelled.',
    },
    earnings: null,
    passenger_contact: { name: 'John Smith Doe', phone: '+256700123456', label: 'Passenger' },
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

const navigate = jest.fn();

async function renderProgress(
  value: Trip = trip(),
  events: TripEvent[] | undefined = [startEvent()],
  // Roughly 1.6 km south of the drop-off, so the badge has a figure to show.
  here: { lat: number; lng: number } | null = { lat: 0.3532, lng: 32.5825 },
): Promise<ReturnType<typeof render>> {
  mockUseTrip.mockReturnValue({ data: value, isLoading: false });
  mockUseTripEvents.mockReturnValue({ data: events });
  mockPosition.mockReturnValue(here);
  mockUseTripRoute.mockReturnValue({ data: null });

  const node: ReactElement = (
    <TripInProgressScreen
      route={{ key: 't', name: 'TripInProgress', params: { tripId: value.id } }}
      navigation={{ navigate, goBack: jest.fn() } as never}
    />
  );

  return render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);
}

beforeEach(() => {
  navigate.mockClear();
  mockQueueTransition.mockClear();
  jest.useFakeTimers();
  // 14 minutes 2 seconds into the journey.
  jest.setSystemTime(new Date(Date.parse(STARTED_AT) + 842_000));
});

afterEach(() => {
  jest.useRealTimers();
});

it('shows how long the driver has been driving, counted from the timeline', async () => {
  const { getByText } = await renderProgress();

  expect(getByText('14:02')).toBeTruthy();
  expect(getByText('elapsed')).toBeTruthy();
});

it('shows distance to the drop-off and says it is a straight line', async () => {
  const { getByText } = await renderProgress();

  // A bare figure beside a map reads as road distance, and a driver who plans
  // on it arrives late — the crow's flight under-reads every time.
  expect(getByText('straight line')).toBeTruthy();

  // 0.0144° of latitude from the drop-off — the mockup's own 1.6 km.
  expect(getByText('1.6 km')).toBeTruthy();

  // And the whole job, pickup to drop-off, which is a different fact and must
  // not be the same number: 0.02° is roughly 2.2 km. This is the assertion
  // that would have caught the badge and the Journey stat being wired to the
  // same figure, which is what the mockup's two kilometre readings looked
  // like at first glance.
  expect(getByText('2.2 km')).toBeTruthy();
});

it('promises no arrival time, in minutes or on a clock', async () => {
  // ADR-0020 §3, and the single most important assertion in this file. The
  // mockup carried both forms.
  const { queryByText } = await renderProgress();

  expect(queryByText(/\bmin\b/i)).toBeNull();
  expect(queryByText(/\bETA\b/i)).toBeNull();
  expect(queryByText(/\d{1,2}:\d{2}\s?(AM|PM)/i)).toBeNull();
});

it('renders em dashes rather than zeros when the platform cannot answer', async () => {
  // Neither source can answer: no GPS fix (offline, or permission refused),
  // no timeline, and no `started_at` either. Both halves are named because
  // the clock has two sources now — the timeline first, then the column — and
  // a fixture that left `started_at` set was asserting an em dash the screen
  // no longer has any reason to draw.
  const { getAllByText, queryByText } = await renderProgress(
    trip({ started_at: null }),
    [],
    null,
  );

  expect(getAllByText('—').length).toBeGreaterThanOrEqual(2);
  expect(queryByText('00:00')).toBeNull();
});

it('still shows the clock when only the column can answer', async () => {
  // The bug this pair guards: the timeline arrives a request later than the
  // trip, so a screen opened straight after the odometer had no `trip_started`
  // row to count from and drew a dash on a moving trip.
  const { getByText } = await renderProgress(trip(), []);

  expect(getByText('14:02')).toBeTruthy();
});

it('names the real payment method and never invents one', async () => {
  const { getByText, queryByText } = await renderProgress();

  expect(getByText('Cash')).toBeTruthy();
  // The mockup's "Applepay" is not a method this platform has.
  expect(queryByText(/apple/i)).toBeNull();
});

it('shows nothing rather than a raw token for a method this build predates', async () => {
  const { queryByText } = await renderProgress(
    trip({ payment: { payment_method: 'applepay', payer: null } }),
  );

  expect(queryByText(/applepay/i)).toBeNull();
});

it('labels the fare as an estimate while the trip is still running', async () => {
  // `fare` stays null until settlement at completion; a quote and a bill are
  // different claims (ADR-0026 §2) and must not wear the same label.
  const { getByText, queryByText } = await renderProgress();

  expect(getByText('UGX 18,450')).toBeTruthy();
  expect(queryByText('Fare')).toBeNull();
});

it('shows the passenger and a way to ring them, and no score or photo', async () => {
  const { getByText, getByLabelText, queryByText } = await renderProgress();

  expect(getByText('John Smith Doe')).toBeTruthy();
  expect(getByLabelText('Call John Smith Doe')).toBeTruthy();

  expect(queryByText('4.8')).toBeNull();
  expect(queryByText(/^[0-5]\.[0-9]$/)).toBeNull();
});

it('sends End trip to the odometer, because completing needs the closing reading', async () => {
  const { getByLabelText } = await renderProgress();

  void fireEvent.press(getByLabelText('End trip'));

  expect(navigate).toHaveBeenCalledWith('Odometer', {
    tripId: 42,
    to: 'trip_completed',
    from: 'trip_started',
  });
});

it('completes from whichever of the three statuses the trip is actually in', async () => {
  // A trip paused at a shop completes from `trip_resumed`, not `trip_started`;
  // sending a constant would 422 on the state machine.
  const { getByLabelText } = await renderProgress(trip({ status: 'trip_resumed' }));

  void fireEvent.press(getByLabelText('End trip'));

  expect(navigate).toHaveBeenCalledWith('Odometer', {
    tripId: 42,
    to: 'trip_completed',
    from: 'trip_resumed',
  });
});

it('does not print its own heading twice as a subtitle', async () => {
  // `statusLabel` renders trip_started and trip_resumed as "Trip in progress",
  // which is the title verbatim. Found by rendering the screen and reading the
  // outline, not by any assertion that existed at the time.
  const { getAllByText } = await renderProgress();

  expect(getAllByText('Trip in progress')).toHaveLength(1);
});

it('still says so when the trip is paused, because that is worth telling', async () => {
  const { getByText } = await renderProgress(trip({ status: 'waiting' }));

  expect(getByText('Waiting')).toBeTruthy();
});

// ── Pause and resume ──────────────────────────────────────────────────────

function pausedTrip() {
  return trip({ status: 'waiting' });
}

/** A trip started, then held five minutes ago and still held. */
function heldEvents(): TripEvent[] {
  return [
    startEvent(),
    {
      id: 7,
      trip_id: 42,
      from_status: 'trip_started',
      to_status: 'waiting',
      user_id: 3,
      notes: null,
      created_at: new Date(Date.parse(STARTED_AT) + 542_000).toISOString(),
      local_day: null,
      local_time: null,
    },
  ];
}

it('offers Pause on a running trip, beside End trip', async () => {
  const { getByLabelText } = await renderProgress();

  expect(getByLabelText('Pause trip')).toBeTruthy();
  expect(getByLabelText('End trip')).toBeTruthy();
});

it('queues the hold rather than posting it, because a trip pauses in a dead zone', async () => {
  const { getByLabelText } = await renderProgress();

  void fireEvent.press(getByLabelText('Pause trip'));

  expect(mockQueueTransition).toHaveBeenCalledWith({ tripId: 42, from: 'trip_started', to: 'waiting' });
});

it('withdraws End trip while the trip is held, because the graph forbids it', async () => {
  // `TripStatus::WAITING` allows exactly one exit — TRIP_RESUMED. Offering
  // End trip here would 422 through the outbox minutes later, after the driver
  // had walked away from a journey they believed was finished. This is the
  // load-bearing assertion of the pause feature.
  const { getByLabelText, queryByLabelText } = await renderProgress(pausedTrip(), heldEvents());

  expect(getByLabelText('Resume trip')).toBeTruthy();
  expect(queryByLabelText('End trip')).toBeNull();
  expect(queryByLabelText('Pause trip')).toBeNull();
});

it('resumes from the held state', async () => {
  const { getByLabelText } = await renderProgress(pausedTrip(), heldEvents());

  void fireEvent.press(getByLabelText('Resume trip'));

  expect(mockQueueTransition).toHaveBeenCalledWith({ tripId: 42, from: 'waiting', to: 'trip_resumed' });
});

it('says how long the trip has been held, and that the time is priced', async () => {
  // A driver who pauses without knowing it is billable cannot answer the
  // passenger who asks why the fare moved.
  const { getByText } = await renderProgress(pausedTrip(), heldEvents());

  expect(
    getByText(
      'On hold for 05:00. Waiting time is recorded on the trip and priced by the tariff.',
    ),
  ).toBeTruthy();
});

it('states no free allowance, which is a server threshold this build cannot know', async () => {
  // `free_waiting_minutes` lives on the rate card version and is in no
  // payload. Printing a number here would be wrong the day the office
  // changes it, on every handset already in the field.
  const { queryByText } = await renderProgress(pausedTrip(), heldEvents());

  expect(queryByText(/free/i)).toBeNull();
  expect(queryByText(/\d+\s*minutes?\s*(free|included)/i)).toBeNull();
});

it('calls the badge figure elapsed, not driving, because it includes the pauses', async () => {
  // Found by rendering the held state: the badge said "driving" beside a
  // notice saying the trip was on hold, and the figure includes every pause.
  const { getByText, queryByText } = await renderProgress(pausedTrip(), heldEvents());

  expect(getByText('elapsed')).toBeTruthy();
  expect(queryByText('driving')).toBeNull();
});

it('does not float the badge over the panel that replaces a missing map', async () => {
  // On a real handset the absolutely-positioned badge landed on top of the
  // "no map for this trip" sentence and cut it in half. A trip taken over the
  // phone has no pins, and every corporate trip has none — so this is the
  // common case, not the edge one.
  const { getByText } = await renderProgress(
    trip({
      pickup: { label: 'Acacia Mall', latitude: null, longitude: null },
      dropoff: { label: 'Kololo Airstrip', latitude: null, longitude: null },
    }),
  );

  // Both still render, and the badge is no longer absolute.
  expect(getByText(/No map for this trip/)).toBeTruthy();
  expect(getByText('straight line')).toBeTruthy();
});

it('opens the map inside the app rather than ejecting the driver to Google Maps', async () => {
  // The complaint that produced `TripMapScreen`: tapping Navigate threw the
  // driver out of the app mid-job, and getting back meant finding it again
  // with a passenger in the car. The hand-off still exists — it is a button on
  // that screen — but it is now a choice rather than the only option.
  const { getByLabelText } = await renderProgress();

  void fireEvent.press(getByLabelText('Navigate to Kololo Airstrip'));

  expect(navigate).toHaveBeenCalledWith('TripMap', { tripId: 42 });
});

it('keeps the inline map non-interactive, so it does not eat the page scroll', async () => {
  // The counterpart to the full-screen map being pannable. This one sits in a
  // ScrollView: a map that captures the drag is a page that will not scroll.
  const view = await renderProgress();

  let html = '';
  const walk = (node: unknown): void => {
    const n = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown[] };
    if (typeof n !== 'object' || n === null) return;
    if (n.type === 'WebView') {
      html = ((n.props?.source as { html?: string } | undefined)?.html) ?? '';
    }
    for (const child of n.children ?? []) walk(child);
  };
  walk(view.toJSON());

  expect(html).toContain('interactive: false');
});
