import { fireEvent, render } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { DriverLedgerEntry, Trip, TripEvent } from '../api/types';
import { TripDetailScreen } from './TripDetailScreen';

/**
 * The trip record — one page for every kind of job, and for every state a trip
 * can be read back in.
 *
 * This screen had **no test at all** before this pass, which is why it still
 * carried a `↓` character for an arrow and a `●` for a glyph. The cases here are
 * the five things it has to get right and the mockup did not cover:
 *
 * 1. **A delivery is not a ride**, and there is one screen for both.
 * 2. **A trip that never happened still renders** — `assigned`, `cancelled`,
 *    `no_show`, `rejected` all land here, with almost every figure absent.
 * 3. **The rail is the timeline**, so a trip with no events shows places with no
 *    times rather than invented ones.
 * 4. **Credits and cash held are never summed into one figure** — that reports a
 *    finished cash ride as roughly minus the commission.
 * 5. **The copy button copies the customer's reference**, not the database id.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

// `mock` prefix required: Jest hoists these factories above this line.
const mockUseTrip = jest.fn();
const mockUseTripEvents = jest.fn();
const mockQueueTransition = jest.fn(async () => undefined);

jest.mock('../trips/queries', () => ({
  useTrip: () => mockUseTrip(),
  useTripEvents: () => mockUseTripEvents(),
}));

jest.mock('../offline/SyncProvider', () => ({
  useSync: () => ({ queueTransition: mockQueueTransition }),
}));

jest.mock('../ui/SyncBanner', () => ({ SyncBanner: () => null }));

function event(partial: Partial<TripEvent> = {}): TripEvent {
  return {
    id: 1,
    trip_id: 7,
    from_status: null,
    to_status: 'assigned',
    user_id: 3,
    notes: null,
    created_at: '2026-08-15T05:20:00Z',
    local_day: '2026-08-15',
    local_time: '08:20',
    ...partial,
  };
}

const COMPLETED_TIMELINE: TripEvent[] = [
  event({ id: 1, to_status: 'accepted', local_time: '08:20' }),
  event({
    id: 2,
    to_status: 'driver_arrived',
    local_time: '08:30',
    created_at: '2026-08-15T05:30:00Z',
  }),
  event({
    id: 3,
    to_status: 'passenger_onboard',
    local_time: '08:33',
    created_at: '2026-08-15T05:33:00Z',
  }),
  event({
    id: 4,
    to_status: 'trip_started',
    local_time: '08:35',
    created_at: '2026-08-15T05:35:00Z',
  }),
  event({
    id: 5,
    to_status: 'waiting',
    local_time: '08:45',
    created_at: '2026-08-15T05:45:00Z',
  }),
  event({
    id: 6,
    to_status: 'trip_resumed',
    local_time: '08:52',
    created_at: '2026-08-15T05:52:00Z',
  }),
  event({
    id: 7,
    to_status: 'trip_completed',
    local_time: '09:22',
    created_at: '2026-08-15T06:22:00Z',
  }),
];

function entry(partial: Partial<DriverLedgerEntry> = {}): DriverLedgerEntry {
  return {
    id: 1,
    kind: 'fare_earned',
    kind_label: 'Fare earned',
    amount_minor: 10_000,
    currency: 'UGX',
    description: 'Ride earnings on trip #7 at 20% commission',
    trip_id: 7,
    service_type: 'ride',
    created_at: '2026-08-15T06:30:00Z',
    ...partial,
  };
}

function trip(partial: Partial<Trip> = {}): Trip {
  return {
    id: 7,
    tenant_id: null,
    customer_id: 4,
    booking_id: null,
    vehicle_id: 2,
    driver_id: 3,
    origin: 'Acacia Mall',
    destination: 'Kololo Hill Drive',
    pickup: { label: 'Acacia Mall', latitude: 0.3476, longitude: 32.5825 },
    dropoff: { label: 'Kololo Hill Drive', latitude: 0.3376, longitude: 32.5925 },
    service_type: 'ride',
    reference: 'KR-2026-0815',
    package: null,
    status: 'trip_completed',
    allowed_transitions: [],
    pickup_wait_target_seconds: 300,
    odometer_max_km_per_trip: 500,
    odometer_start: 10_000,
    odometer_end: 10_013,
    odometer_start_photo_url: null,
    odometer_end_photo_url: null,
    distance_km: '12.60',
    gps_distance_km: '12.40',
    distance_variance_flagged: false,
    started_at: '2026-08-15T05:35:00Z',
    completed_at: '2026-08-15T06:22:00Z',
    duration_minutes: 32,
    fare: null,
    estimated_fare: null,
    payment: { payment_method: 'cash', payer: null },
    earnings: {
      lines: [entry(), entry({ id: 2, kind: 'cash_collected', kind_label: 'Cash collected', amount_minor: -12_500 })],
      earned_minor: 10_000,
      commission_minor: 2_500,
      total_minor: 12_500,
      currency: 'UGX',
      recorded_at: '2026-08-15T06:30:00Z',
    },
    passenger_contact: { name: 'Sarah N.', phone: '+256700000001', label: 'Sarah N.' },
    created_at: '2026-08-15T05:20:00Z',
    updated_at: null,
    ...partial,
  };
}

const goBack = jest.fn();
const navigate = jest.fn();
const parentNavigate = jest.fn();

async function renderRecord(
  data: Trip | undefined = trip(),
  events: TripEvent[] | undefined = COMPLETED_TIMELINE,
): Promise<ReturnType<typeof render>> {
  mockUseTrip.mockReturnValue({ data, isLoading: false });
  mockUseTripEvents.mockReturnValue({ data: events });

  const node: ReactElement = (
    <TripDetailScreen
      route={{ key: 't', name: 'TripDetail', params: { tripId: 7 } }}
      navigation={
        {
          goBack,
          navigate,
          getParent: () => ({ navigate: parentNavigate }),
        } as never
      }
    />
  );

  return render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-08-15T09:30:00Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

// -- The facts --------------------------------------------------------------

it('states the four measured figures, each from the server', async () => {
  const screen = await renderRecord();

  // `decimal(8,2)` arrives as "12.60" and must not print as such.
  expect(screen.getByText('12.6 km')).toBeTruthy();
  expect(screen.getByText('32 min')).toBeTruthy();
  // Waiting is derived from the timeline — the same rows billing counts — and
  // appears twice on purpose: once as the trip's total in the stat row, once as
  // the period's own pill on the rail. One fact, stated where each is read.
  expect(screen.getAllByText('7 min')).toHaveLength(2);
  expect(screen.getByText('15 Aug 2026')).toBeTruthy();
});

it('renders an em dash for every figure the platform does not have', async () => {
  // `docs/screen-rules.md` §1. This is the ordinary state of a cancelled trip
  // and of a corporate assignment nobody has answered, not an edge case.
  const screen = await renderRecord(
    trip({
      status: 'cancelled',
      // `started_at` is null on a cancelled trip and the state machine enforces
      // it — `cancelled` is legal only *before* `trip_started`. The first draft
      // of this fixture left the timestamp set, which is data the platform
      // cannot produce, and it made the waiting dash impossible to assert.
      started_at: null,
      completed_at: null,
      distance_km: null,
      gps_distance_km: null,
      duration_minutes: null,
      earnings: null,
      passenger_contact: null,
      reference: null,
    }),
    [event({ to_status: 'cancelled', local_time: '08:28' })],
  );

  // Distance, duration and waiting all three, and never a zero. The waiting
  // dash is the one this test found: a cancelled trip showed "0 min", which is
  // a statement about time that never existed — waiting is unreachable before
  // `trip_started`.
  expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  expect(screen.queryByText('0.0 km')).toBeNull();
  expect(screen.queryByText('0 min')).toBeNull();
});

// -- One screen, two kinds of job ------------------------------------------

it('words the collection row for a delivery, and shows what was carried', async () => {
  const screen = await renderRecord(
    trip({
      service_type: 'delivery',
      package: { item_type: 'documents', package_size: 'small' },
    }),
  );

  expect(screen.getByText('Parcel collected')).toBeTruthy();
  expect(screen.getByText('Documents · Small')).toBeTruthy();
  // The person at the other end of a parcel is the sender, not a passenger.
  expect(screen.getByText('Sender')).toBeTruthy();
  expect(screen.queryByText('Passenger aboard')).toBeNull();
});

it('says nothing about a parcel on a ride', async () => {
  const screen = await renderRecord();

  expect(screen.getByText('Passenger aboard')).toBeTruthy();
  expect(screen.queryByText('Parcel')).toBeNull();
});

// -- The rail --------------------------------------------------------------

it('draws the rail from the timeline, with the times the server rendered', async () => {
  const screen = await renderRecord();

  expect(screen.getByText('Pickup')).toBeTruthy();
  expect(screen.getByText('Acacia Mall')).toBeTruthy();
  expect(screen.getByText('08:30 AM')).toBeTruthy();
  expect(screen.getByText('Drop-off')).toBeTruthy();
  expect(screen.getByText('09:22 AM')).toBeTruthy();
  // The waiting period, both ends of it.
  expect(screen.getByText('08:45 AM – 08:52 AM')).toBeTruthy();
});

it('says a place was not reached rather than inventing a time for it', async () => {
  // An unanswered corporate assignment: one event and nothing else has
  // happened. Two places, no times.
  const screen = await renderRecord(
    trip({ status: 'assigned', allowed_transitions: ['accepted', 'rejected'], earnings: null }),
    [event({ to_status: 'assigned' })],
  );

  expect(screen.getAllByText('Not reached')).toHaveLength(2);
  expect(screen.queryByText('08:30 AM')).toBeNull();
});

it('offers no map link for a trip with no coordinates', async () => {
  // An order taken over the phone has no pins, and a link that opened an empty
  // map is worse than no link. This is the common case, not the edge one.
  const screen = await renderRecord(
    trip({ pickup: { label: 'Acacia Mall', latitude: null, longitude: null } }),
  );

  expect(screen.queryByLabelText('View this trip on the map')).toBeNull();
});

// -- The money ------------------------------------------------------------

it('shows the ledger rows and totals the credits only', async () => {
  const screen = await renderRecord();

  // The server's own wording for the row, via the wallet's component.
  expect(screen.getByText('Ride earnings')).toBeTruthy();
  expect(screen.getByText('You earned')).toBeTruthy();
  // 10,000 earned; the 12,500 cash row is *not* subtracted into this figure.
  expect(screen.getAllByText('UGX 10,000').length).toBeGreaterThanOrEqual(1);
  expect(screen.queryByText('UGX -2,500')).toBeNull();
});

it('says when the money reached the wallet, which is not when the trip ended', async () => {
  // Completion travels through the outbox, so the credit is written when the
  // office receives it — sometimes hours later, upcountry. The mockup's line.
  const screen = await renderRecord();

  expect(screen.getByText(/Paid into your wallet ·/)).toBeTruthy();
});

it('says the cash is the office\'s, in words rather than as a minus sign', async () => {
  // The owner could not tell a minus sign from a bug on the wallet screen, so
  // direction is carried in words. Summing the pair would report this finished
  // ride as minus the commission.
  const screen = await renderRecord();

  expect(screen.getByText(/took UGX 12,500 in cash/)).toBeTruthy();
});

it('says the office has not confirmed the money yet, rather than showing zero', async () => {
  // The state a driver sees most often and the mockup does not draw: completion
  // travels through the outbox, so the phone is usually here before the server
  // has credited anything.
  const screen = await renderRecord(trip({ earnings: null }));

  expect(screen.getByText(/not confirmed the money for this trip yet/)).toBeTruthy();
  expect(screen.queryByText('UGX 0')).toBeNull();
});

it('never shows a rating or a photograph of the customer', async () => {
  // ADR-0030's ratings run customer-to-driver; customers have no photograph.
  // The fifth screen to refuse both, and this asserts the absence.
  const screen = await renderRecord();

  expect(screen.queryByText('4.8')).toBeNull();
  expect(screen.queryByText(/★/)).toBeNull();
});

// -- The reference -------------------------------------------------------

it('copies the customer\'s reference, not the trip\'s database id', async () => {
  const screen = await renderRecord();

  await fireEvent.press(screen.getByLabelText('Copy Booking reference, KR-2026-0815'));

  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('KR-2026-0815');
  expect(screen.getByText('Copied')).toBeTruthy();
});

it('falls back to the trip number and says which it is showing', async () => {
  // A corporate trip has a booking rather than an order request, so there is no
  // customer reference at all. Quoting a database id as though it were one has
  // the driver and the office looking for different things.
  const screen = await renderRecord(trip({ reference: null }));

  expect(screen.getByText('Trip number')).toBeTruthy();
  expect(screen.getByText('#7')).toBeTruthy();
});

// -- The controls -------------------------------------------------------

it('offers the actions the server says are legal, and Help reaches a person', async () => {
  const screen = await renderRecord(
    trip({ status: 'assigned', allowed_transitions: ['accepted', 'rejected'], earnings: null }),
    [event({ to_status: 'assigned' })],
  );

  await fireEvent.press(screen.getByLabelText('Help with this trip'));

  expect(parentNavigate).toHaveBeenCalledWith('Profile', { screen: 'Support' });

  // The unanswered assignment is why this screen still has controls at all.
  expect(screen.getByLabelText('Accept trip')).toBeTruthy();
});

it('draws no action buttons on a finished trip', async () => {
  // `TripPolicy` withholds every terminal transition from a driver, so a button
  // here would be a 403 waiting to happen.
  const screen = await renderRecord();

  expect(screen.queryByLabelText('Accept trip')).toBeNull();
  expect(screen.queryByLabelText('Start trip')).toBeNull();
});
