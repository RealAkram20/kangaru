import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { NetworkError } from '../api/errors';
import type { Trip, TripEvent, TripStatus, TripStop } from '../api/types';
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

jest.mock('../ui/SyncBanner', () => ({ SyncBanner: () => null }));

/*
  The extension surface (2026-08-28), added by the extension agent. Three
  mocks, all of them things this screen gained rather than things it changed:
  it now answers a passenger's request and marks the agreed drop-off, and both
  post directly rather than through the outbox.

  `useAuth` and `useQueryClient` are the two the screen would otherwise throw
  on before rendering a single row — which is what 42 of these tests did the
  moment the screen learned to post.
*/
const mockAcceptExtension = jest.fn(async () => ({}));
const mockDeclineExtension = jest.fn(async () => ({}));
const mockMarkDropoffReached = jest.fn(async () => ({}));
const mockInvalidate = jest.fn(async () => undefined);

jest.mock('../api/endpoints', () => ({
  acceptTripExtension: (...args: unknown[]) => mockAcceptExtension(...(args as [])),
  declineTripExtension: (...args: unknown[]) => mockDeclineExtension(...(args as [])),
  markDropoffReached: (...args: unknown[]) => mockMarkDropoffReached(...(args as [])),
}));

jest.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ api: {} }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));

// `mock` prefix required: Jest hoists the factory below above this line.
const mockQueueTransition = jest.fn(async () => undefined);
let mockQueued = new Map<number, TripStatus>();

jest.mock('../offline/SyncProvider', () => ({
  useSync: () => ({
    queueTransition: mockQueueTransition,
    sync: jest.fn(),
    // The outbox's pending transitions, keyed by trip — what the driver has
    // asked for and the office has not confirmed.
    queued: mockQueued,
  }),
}));

// `mock` prefix required: Jest hoists the factories above these declarations.
const mockUseTrip = jest.fn();
const mockUseTripEvents = jest.fn();
const mockPosition = jest.fn();
const mockUseTripRoute = jest.fn();

jest.mock('../trips/queries', () => ({
  useTrip: (id: number) => mockUseTrip(id),
  useTripEvents: (id: number) => mockUseTripEvents(id),
  // Arguments forwarded rather than swallowed, for the reason
  // `TripMapScreen.test.tsx` records: which leg this screen asks for, and
  // from where, is the assertion at the bottom of this file — and a mock that
  // drops its arguments is how the wrong leg shipped once already.
  useTripRoute: (...args: unknown[]) => mockUseTripRoute(...args),
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
  variance_threshold_percent: 10,
  provisional_fare: null,
  distance: null,
    payment: { payment_method: 'cash', payer: null },
    odometer_start: 15_000,
    odometer_end: null,
    odometer_start_photo_url: null,
    odometer_end_photo_url: null,
    distance_km: null,
    gps_distance_km: null,
    distance_variance_flagged: null,
    unplanned_stop_count: 0,
    dropoff_reached_at: null,
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
const replace = jest.fn();

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
      navigation={{ navigate, replace, goBack: jest.fn() } as never}
    />
  );

  return render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);
}

beforeEach(() => {
  // On by default in every test. A suite that wants the switch off says so,
  // and must not leak that into the next one (ADR-0047).
  mockOdometerEnabled.mockReturnValue(true);
  navigate.mockClear();
  replace.mockClear();
  mockQueueTransition.mockClear();
  // Nothing in flight is the ordinary case; the tests about an unconfirmed
  // pause set it themselves.
  mockQueued = new Map();
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

it('leaves for the completion screen when the odometer is off, rather than sitting on a finished trip', async () => {
  // Found on a handset on go-live day: the owner's fleet runs with the
  // odometer off (ADR-0047), End trip queued the completion and stayed put —
  // the subtitle flipped to "Completed" over a screen still offering Pause
  // and End. The odometer-on path always left via `OdometerScreen`;
  // this branch never left at all.
  //
  // Flushed inside `act` rather than `waitFor`: this file runs fake timers,
  // and `waitFor` under them is the trap `jest.setup.ts` documents.
  mockOdometerEnabled.mockReturnValue(false);

  const { getByLabelText } = await renderProgress();

  await act(async () => {
    void fireEvent.press(getByLabelText('End trip'));
  });

  expect(mockQueueTransition).toHaveBeenCalledWith(
    expect.objectContaining({ tripId: 42, from: 'trip_started', to: 'trip_completed' }),
  );
  expect(replace).toHaveBeenCalledWith('RideComplete', { tripId: 42 });
  // `replace`, not `navigate`: the back gesture must not reopen an ended trip.
  expect(navigate).not.toHaveBeenCalled();
});

it('stays put, button usable again, when the completion could not even be queued', async () => {
  mockOdometerEnabled.mockReturnValue(false);
  mockQueueTransition.mockRejectedValueOnce(new Error('outbox closed'));

  const { getByLabelText } = await renderProgress();

  await act(async () => {
    void fireEvent.press(getByLabelText('End trip'));
  });

  expect(mockQueueTransition).toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
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
    getByText('On hold for 05:00. Waiting time is recorded and priced.'),
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

it('shows the trip as held the moment the pause is queued, not when it lands', async () => {
  // The owner's "hard to start the trip", on the pause control. Nothing writes
  // the new status to the cache and only a *completed* drain invalidates it, so
  // this screen used to go on offering "Pause trip" after it had been pressed —
  // a flicker on a good connection, and the whole dead zone otherwise. Pressed
  // twice, the second item posts from a status the server has left and parks.
  mockQueued = new Map([[42, 'waiting' as TripStatus]]);

  const { getByText, queryByText } = await renderProgress();

  expect(getByText('Resume trip')).toBeTruthy();
  expect(queryByText('Pause trip')).toBeNull();
  // End trip goes too: `TripStatus::WAITING` allows only `TRIP_RESUMED`, so
  // offering it on a trip about to be held is offering a 422.
  expect(queryByText('End trip')).toBeNull();
});

it('does not date an unconfirmed hold from the last time the driver stopped', async () => {
  // The duration is summed from `trip_events`, and a pause still in the outbox
  // has no row there. Printing the events' total on an unconfirmed hold would
  // time *this* pause from a previous one. The durationless sentence is the
  // true one until the row exists.
  mockQueued = new Map([[42, 'waiting' as TripStatus]]);

  const { getByText, queryByText } = await renderProgress();

  expect(getByText('On hold. Waiting time is recorded and priced.')).toBeTruthy();
  expect(queryByText(/On hold for /)).toBeNull();
});

// ── The itinerary, and adding a drop-off (ADR-0045) ──────────────────────

function itineraryStop(overrides: Partial<TripStop> = {}): TripStop {
  return {
    id: 5,
    sequence: 1,
    label: 'Ntinda ATM',
    latitude: 0.382,
    longitude: 32.5825,
    source: 'added_by_driver',
    status: 'pending',
    arrived_at: null,
    departed_at: null,
    skip_reason: null,
    client_place_id: 11,
    kind: 'stop' as const,
    accepted_at: null,
    ...overrides,
  };
}

/*
  **The label changed on 2026-08-28 and the behaviour behind it did too.**
  These fixtures are walk-ins (`tenant_id: null`), and on a walk-in this
  button now records an *extension* — the passenger going further than the
  drop-off they agreed to, which is billed — where it used to append an
  unbilled stop. That was a live defect: the extra kilometres were driven,
  capped by `ROUTE_CAPPED`, and not paid for. The owner was shown the
  collision and chose this. A corporate circuit still reads 'Add a drop-off'
  and still appends a stop; both labels are covered in `extensions.test.ts`.
*/
it('offers the extend control on a running trip', async () => {
  const { getByLabelText } = await renderProgress();

  void fireEvent.press(getByLabelText('Extend the trip'));

  expect(navigate).toHaveBeenCalledWith('AddDropoff', { tripId: 42 });
});

it('offers it while paused too — the bank flow adds the next site at this one', async () => {
  // Hiding the button behind a resume would make the driver lie about where
  // they are to extend their own run (ADR-0045 §4).
  const { getByLabelText } = await renderProgress(pausedTrip(), heldEvents());

  void fireEvent.press(getByLabelText('Extend the trip'));

  expect(navigate).toHaveBeenCalledWith('AddDropoff', { tripId: 42 });
});

it('renders the itinerary as a worklist, ending at the trip\'s own drop-off', async () => {
  const { getByText } = await renderProgress(
    trip({
      stops: [
        itineraryStop({ id: 4, sequence: 1, label: 'Bugolobi branch', status: 'done' }),
        itineraryStop({ id: 5, sequence: 2 }),
      ],
    }),
  );

  expect(getByText('1. Bugolobi branch')).toBeTruthy();
  expect(getByText('Visited')).toBeTruthy();
  expect(getByText('2. Ntinda ATM')).toBeTruthy();
  expect(getByText('Next')).toBeTruthy();
  expect(getByText('Final drop-off')).toBeTruthy();
});

it('makes the next pending stop the drop-off row, numbered so the driver knows where they are in the run', async () => {
  const { getByText, queryByText } = await renderProgress(
    trip({
      stops: [
        itineraryStop({ id: 4, sequence: 1, label: 'Bugolobi branch', status: 'done' }),
        itineraryStop({ id: 5, sequence: 2 }),
      ],
    }),
  );

  expect(getByText('Next drop-off')).toBeTruthy();
  expect(getByText('Stop 2 of 2')).toBeTruthy();
  // The row's value is the stop, not the terminus — that ends the worklist.
  expect(queryByText('Drop-off')).toBeNull();
});

it('withholds the Journey figure on a circuit rather than calling a morning\'s driving 100 m', async () => {
  // A bank run starts and ends at head office, so the straight line between
  // the trip's two ends is ~0 — this read "Under 100 m" for a three-stop
  // circuit. Found by rendering the screen, not by any assertion here.
  const { queryByText } = await renderProgress(
    trip({
      pickup: { label: 'Head Office', latitude: 0.3136, longitude: 32.5811 },
      dropoff: { label: 'Head Office', latitude: 0.3136, longitude: 32.5811 },
      stops: [itineraryStop()],
    }),
  );

  expect(queryByText('Under 100 m')).toBeNull();
});

it('still shows the Journey figure on an ordinary point-to-point trip', async () => {
  // The guard above must not cost the figure on the job it is right for.
  const { getByText } = await renderProgress();

  expect(getByText('2.2 km')).toBeTruthy();
});

it('measures the badge to the next stop, not the journey\'s end', async () => {
  // `here` is 0.3532; the trip drop-off is 0.3676 (1.6 km); the stop is
  // 0.3820 — 3.2 km away. The badge, the row and the route endpoint must all
  // mean the same place by "the drop-off", and this is the badge's half.
  const { getByText, queryByText } = await renderProgress(
    trip({ stops: [itineraryStop()] }),
  );

  expect(getByText('3.2 km')).toBeTruthy();
  expect(queryByText('1.6 km')).toBeNull();
});

it('queues the arrival with the stop\'s id — the pause that names a stop is an arrival at it', async () => {
  const { getByLabelText } = await renderProgress(trip({ stops: [itineraryStop()] }));

  void fireEvent.press(getByLabelText('Arrived at Ntinda ATM'));

  expect(mockQueueTransition).toHaveBeenCalledWith({
    tripId: 42,
    from: 'trip_started',
    to: 'waiting',
    stopId: 5,
  });
});

it('withdraws Arrived while the trip is held — arriving is the pause, and the trip is already paused', async () => {
  const { queryByLabelText } = await renderProgress(
    trip({ status: 'waiting', stops: [itineraryStop()] }),
    heldEvents(),
  );

  expect(queryByLabelText('Arrived at Ntinda ATM')).toBeNull();
});

it('leaves a plain pause plain — the Pause button queues no stop id', async () => {
  const { getByLabelText } = await renderProgress(trip({ stops: [itineraryStop()] }));

  void fireEvent.press(getByLabelText('Pause trip'));

  expect(mockQueueTransition).toHaveBeenCalledWith({
    tripId: 42,
    from: 'trip_started',
    to: 'waiting',
  });
});

it('queues the hold from the status it will actually depart from', async () => {
  // A pause and a resume in one dead zone: the resume departs from the pause
  // still sitting in the outbox, not from the status the office last confirmed.
  // `expectedFrom` is only read when an item fails, to tell "my write is
  // missing" from "the trip moved on without me" — a stale value misreports
  // exactly the case the reconciliation exists to distinguish.
  mockQueued = new Map([[42, 'waiting' as TripStatus]]);

  const { getByText } = await renderProgress();

  void fireEvent.press(getByText('Resume trip'));

  await waitFor(() => expect(mockQueueTransition).toHaveBeenCalled());

  expect(mockQueueTransition).toHaveBeenCalledTimes(1);
  expect(mockQueueTransition).toHaveBeenCalledWith({
    tripId: 42,
    from: 'waiting',
    to: 'trip_resumed',
  });
});

it('asks for the whole leg as well as the road ahead, so the map can show progress', async () => {
  // The screen a driver actually sits on for the length of a job. It draws the
  // same two roads the full-screen map does — the muted whole leg underneath,
  // the green road still to drive on top, the vehicle at the seam — because
  // the complaint that produced this was about not being able to read progress
  // at a glance, and a glance is what this 220pt panel is for.
  //
  // No origin in the second request: that is what keeps the query key constant
  // and the answer usually a cache read rather than a billed one, which is
  // ADR-0031 §5's whole argument.
  mockUseTripRoute.mockClear();

  await renderProgress();

  expect(mockUseTripRoute).toHaveBeenCalledWith(
    42,
    expect.objectContaining({ lat: expect.any(Number), lng: expect.any(Number) }),
  );
  expect(mockUseTripRoute).toHaveBeenCalledWith(42, null, 'dropoff', true);
});

it('stops asking for a whole leg once the circuit has worked a stop', async () => {
  // Mid-circuit the leg runs stop to stop and no longer starts at the pickup,
  // so the road this would return is a different journey from the one being
  // driven. Withheld rather than drawn wrong — and withheld costs nothing,
  // which is the easy half of the decision.
  mockUseTripRoute.mockClear();

  await renderProgress(
    trip({
      stops: [
        {
          id: 1,
          sequence: 1,
          label: 'Centenary Bank, Kabalagala',
          latitude: 0.3,
          longitude: 32.6,
          source: 'planned',
          status: 'done',
          arrived_at: null,
          departed_at: null,
          skip_reason: null,
          client_place_id: null,
          kind: 'stop' as const,
          accepted_at: null,
        },
      ],
    }),
  );

  expect(mockUseTripRoute).toHaveBeenCalledWith(42, null, 'dropoff', false);
});

/** The HTML handed to the WebView, dug out of the rendered tree. */
function tripMapHtml(tree: unknown): string {
  let found = '';

  const walk = (node: unknown): void => {
    const n = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown[] };

    if (typeof n !== 'object' || n === null) {
      return;
    }

    if (n.type === 'WebView') {
      const source = n.props?.source as { html?: string } | undefined;
      found = source?.html ?? '';
    }

    for (const child of n.children ?? []) {
      walk(child);
    }
  };

  walk(tree);

  return found;
}

const ROAD_AHEAD = 'a~l~Fjk~uOwHJy@P';
const WHOLE_LEG_POLYLINE = 'wzl~F|k~uOaBcAoC_BsDkB';

/**
 * Two answers for two questions, and the cache answers **even when the query
 * is disabled** — which is what a warm key does and what the bug below turned
 * on.
 *
 * Not routed through `renderProgress`: that helper stubs the route to null as
 * its last act, so an implementation set before it would be thrown away.
 */
async function renderWithWarmCache(value: Trip = trip()) {
  mockUseTrip.mockReturnValue({ data: value, isLoading: false });
  mockUseTripEvents.mockReturnValue({ data: [startEvent()] });
  mockPosition.mockReturnValue({ lat: 0.3532, lng: 32.5825 });
  mockUseTripRoute.mockImplementation((_id: number, from: unknown) => ({
    data:
      from === null
        ? {
            polyline: WHOLE_LEG_POLYLINE,
            distance_km: 12.2,
            duration_seconds: 1500,
            provider: 'osrm',
            is_estimate: true,
          }
        : {
            polyline: ROAD_AHEAD,
            distance_km: 6.1,
            duration_seconds: 780,
            provider: 'osrm',
            is_estimate: true,
          },
  }));

  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <TripInProgressScreen
        route={{ key: 't', name: 'TripInProgress', params: { tripId: value.id } }}
        navigation={{ navigate, replace, goBack: jest.fn() } as never}
      />
    </SafeAreaProvider>,
  );
}

it('draws the whole leg under the road ahead when the pickup is still the origin', async () => {
  const view = await renderWithWarmCache();

  expect(tripMapHtml(view.toJSON())).toContain(WHOLE_LEG_POLYLINE);
});

it('draws no whole leg mid-circuit even when the cache still holds one', async () => {
  /*
    The outcome rather than the mechanism, and the distinction is a bug that
    shipped once: `enabled: false` withholds the *request*, not the *answer*.
    A disabled `useQuery` still serves whatever its key already holds, and
    `WaitingForPassengerScreen` warms this exact key on every job — so the
    road from the pickup went on being drawn on a circuit that had left it.

    The mock answers regardless of the enabled flag, which is what a warm
    cache does.
  */
  const view = await renderWithWarmCache(
    trip({
      stops: [
        {
          id: 1,
          sequence: 1,
          label: 'Jinja Main Market',
          latitude: 0.44,
          longitude: 33.2,
          source: 'planned',
          status: 'done',
          arrived_at: null,
          departed_at: null,
          skip_reason: null,
          client_place_id: null,
          kind: 'stop' as const,
          accepted_at: null,
        },
      ],
    }),
  );

  const html = tripMapHtml(view.toJSON());

  // The road ahead is still drawn — it is measured from where the driver
  // actually is, and is true whatever the circuit has done.
  expect(html).toContain(ROAD_AHEAD);
  expect(html).not.toContain(WHOLE_LEG_POLYLINE);
});

/*
  The extension surface (ADR-0045 §4 amendment, 2026-08-28).

  Three things are worth protecting, and each fails in its own way: the
  request has to reach the driver at all, an answer has to be sent once and
  once only, and the drop-off boundary has to stop being offered after it is
  marked — the server ignores a second one, so a button that stayed would be
  a control that visibly does nothing.
*/

function extensionRequest(over: Partial<TripStop> = {}): TripStop {
  return {
    id: 88,
    sequence: 1,
    label: 'Kabalagala',
    latitude: null,
    longitude: null,
    kind: 'extension',
    source: 'added_by_client',
    status: 'proposed',
    arrived_at: null,
    departed_at: null,
    accepted_at: null,
    skip_reason: null,
    client_place_id: null,
    ...over,
  };
}

it('puts a passenger request in front of the driver, naming the place', async () => {
  const { getByText } = await renderProgress(trip({ stops: [extensionRequest()] }));

  // The place is the only thing the decision turns on. No fare: nothing can
  // price an extension before it is driven, and a figure invented here is one
  // the driver repeats to a passenger and cannot honour.
  expect(getByText('Kabalagala')).toBeTruthy();
  expect(getByText('Passenger wants to go further')).toBeTruthy();
});

it('shows no request card for a stop, or for one already answered', async () => {
  const answered = await renderProgress(
    trip({ stops: [extensionRequest({ status: 'pending', accepted_at: '2026-08-28T09:00:00+00:00' })] }),
  );

  expect(answered.queryByText('Passenger wants to go further')).toBeNull();

  const plainStop = await renderProgress(trip({ stops: [extensionRequest({ kind: 'stop' })] }));

  expect(plainStop.queryByText('Passenger wants to go further')).toBeNull();
});

it("sends the driver's answer to the office", async () => {
  const { getByLabelText } = await renderProgress(trip({ stops: [extensionRequest()] }));

  await act(async () => {
    void fireEvent.press(getByLabelText('Accept'));
  });

  expect(mockAcceptExtension).toHaveBeenCalledWith({}, 42, 88);
  expect(mockDeclineExtension).not.toHaveBeenCalled();
});

it('records a refusal without deleting the request', async () => {
  const { getByLabelText } = await renderProgress(trip({ stops: [extensionRequest()] }));

  await act(async () => {
    void fireEvent.press(getByLabelText('Decline'));
  });

  expect(mockDeclineExtension).toHaveBeenCalledWith({}, 42, 88);
});

it('marks the agreed drop-off, then stops offering to', async () => {
  const before = await renderProgress(trip());

  await act(async () => {
    void fireEvent.press(before.getByLabelText('Arrived at drop-off'));
  });

  expect(mockMarkDropoffReached).toHaveBeenCalledWith({}, 42);

  const after = await renderProgress(trip({ dropoff_reached_at: '2026-08-28T09:00:00+00:00' }));

  expect(after.queryByLabelText('Arrived at drop-off')).toBeNull();
  // Extending survives it: the owner's ruling is that extensions matter more
  // than the mark, and nothing about extending is gated behind it.
  expect(after.getByLabelText('Extend the trip')).toBeTruthy();
});

it('says so when an answer does not reach the office', async () => {
  // A dead zone, which is the case that actually happens: a drop-off is
  // wherever the passenger asked for, routinely somewhere with no signal.
  mockAcceptExtension.mockRejectedValueOnce(new NetworkError('offline'));

  const { getByLabelText, findByText } = await renderProgress(
    trip({ stops: [extensionRequest()] }),
  );

  await act(async () => {
    void fireEvent.press(getByLabelText('Accept'));
  });

  // Swallowed, this is a driver tapping Accept, seeing nothing change, and
  // concluding the screen is broken while a passenger waits beside them.
  expect(await findByText(/did not reach the office/)).toBeTruthy();
});

it('will not report a trip complete while an agreed extension is still to run', async () => {
  /*
    **The worst bug this screen has had, and it shipped past every test.**

    The office refuses the completion — `TransitionTripRequest` does — but
    this screen queues through the outbox and navigates on the *queue*
    succeeding. So the driver was shown "Great job! Ride completed" with
    their passenger still in the car waiting to be taken on, and the 422
    turned up minutes later as a line in Updates & sync.

    Found by pressing End trip on a handset. No test saw it because none had
    an accepted extension on a trip the driver then tried to finish.
  */
  const { getByLabelText, findByText } = await renderProgress(
    trip({
      dropoff_reached_at: '2026-08-28T09:00:00+00:00',
      stops: [extensionRequest({ status: 'pending', accepted_at: '2026-08-28T09:00:00+00:00' })],
    }),
  );

  await act(async () => {
    void fireEvent.press(getByLabelText('End trip'));
  });

  expect(await findByText(/Kabalagala is still to run/)).toBeTruthy();
  // Neither queued nor navigated: the office is never offered a write it
  // would refuse, and the driver is never told they have finished.
  expect(mockQueueTransition).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
});

it('ends the trip once the extension has been run', async () => {
  const { getByLabelText } = await renderProgress(
    trip({
      dropoff_reached_at: '2026-08-28T09:00:00+00:00',
      stops: [extensionRequest({ status: 'done', accepted_at: '2026-08-28T09:00:00+00:00' })],
    }),
  );

  await act(async () => {
    void fireEvent.press(getByLabelText('End trip'));
  });

  // Proceeds — which with the odometer on means the closing-reading screen,
  // exactly as it does on a trip that was never extended.
  expect(navigate).toHaveBeenCalledWith(
    'Odometer',
    expect.objectContaining({ to: 'trip_completed' }),
  );
});

it('gives an accepted extension a way to be finished, so the trip is never trapped', async () => {
  /*
    **The trap, reported by the owner: "i can not end the trip".**

    `End trip` refuses while an agreed extension is outstanding — correctly —
    and the extension rows were drawn by a second, simpler loop with no
    Arrived control on them. So the one leg blocking the trip was the one leg
    that could not be worked, and the screen offered no way forward at all.

    Both halves of the journey now go through one row, which is what makes
    that combination impossible to build again.
  */
  const { getByLabelText } = await renderProgress(
    trip({
      dropoff_reached_at: '2026-08-28T09:00:00+00:00',
      stops: [extensionRequest({ status: 'pending', accepted_at: '2026-08-28T09:00:00+00:00' })],
    }),
  );

  await act(async () => {
    void fireEvent.press(getByLabelText('Arrived at Kabalagala'));
  });

  // The same queued pause a stop uses, carrying the leg it is about — which
  // is what moves it off `pending` and eventually lets the trip end.
  expect(mockQueueTransition).toHaveBeenCalledWith(
    expect.objectContaining({ to: 'waiting', stopId: 88 }),
  );
});

it('offers no Arrived on an extension the driver has not reached yet', async () => {
  // Before the agreed drop-off is marked, the extension is not where the
  // driver is going — offering Arrived on it would record a leg they have
  // not driven, and the fare follows those legs.
  const { queryByLabelText } = await renderProgress(
    trip({
      stops: [extensionRequest({ status: 'pending', accepted_at: '2026-08-28T09:00:00+00:00' })],
    }),
  );

  expect(queryByLabelText('Arrived at Kabalagala')).toBeNull();
});
