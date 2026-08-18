import { fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { DriverStats } from '../api/endpoints';
import type { Trip, TripEarnings } from '../api/types';
import { RideCompleteScreen } from './RideCompleteScreen';

/**
 * That the completion screen mounts, and states only what the platform has.
 *
 * `completion.test.ts` owns the arithmetic and the wording. This suite exists
 * because that one does not prove the screen renders, and because the rules
 * below would otherwise live only in a docblock, where nothing enforces them:
 *
 * - **No tip row**, in either state. The concept does not exist.
 * - **The gross fare is never labelled as the driver's earnings.**
 * - **No commission percentage** — it is a runtime setting, not a payload.
 * - **An unconfirmed trip says so** rather than showing zeroes.
 * - **Every exit goes Home**, never back to a live-leg screen for a trip that
 *   has just ended.
 * - **The wallet figure and its sentence are rendered together**, because the
 *   figure has no sign and the sentence is the only thing carrying direction.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

jest.mock('../ui/SyncBanner', () => ({ SyncBanner: () => null }));

// The tip declaration sheet (ADR-0034) reaches the wallet's query layer, which
// reaches `useAuth` and AsyncStorage — a native module this suite has no
// business booting. Mocked here rather than in `jest.setup.ts` because it is
// this screen's dependency, not the app's.
jest.mock('../wallet/queries', () => ({
  useCreateSettlementRequest: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
}));

// `mock` prefix required: Jest hoists the factories above these declarations.
const mockUseTrip = jest.fn();
const mockUseDriverStats = jest.fn();
const mockUseDuty = jest.fn();
const mockSetDuty = jest.fn();

jest.mock('../trips/queries', () => ({
  useTrip: (id: number) => mockUseTrip(id),
  useDriverStats: () => mockUseDriverStats(),
}));

jest.mock('../duty/queries', () => ({
  useDuty: () => mockUseDuty(),
  useSetDuty: () => ({ mutate: mockSetDuty }),
}));

const SETTLED: TripEarnings = {
  // The completion screen states the three figures; the row-by-row breakdown
  // belongs to `TripDetailScreen`, the record.
  lines: [],
  earned_minor: 10_000,
  commission_minor: 2_500,
  total_minor: 12_500,
  currency: 'UGX',
  recorded_at: '2026-08-15T08:40:12+03:00',
};

function trip(earnings: TripEarnings | null = SETTLED): Trip {
  return {
    id: 42,
    tenant_id: null,
    customer_id: 9,
    booking_id: null,
    vehicle_id: 7,
    driver_id: 3,
    origin: 'Acacia Mall, 14-18 Cooper Rd',
    destination: 'Kololo Airstrip',
    pickup: { label: 'Acacia Mall, 14-18 Cooper Rd', latitude: null, longitude: null },
    dropoff: { label: 'Kololo Airstrip', latitude: null, longitude: null },
    service_type: 'ride',
    reference: null,
    package: null,
    status: 'trip_completed',
    allowed_transitions: [],
    pickup_wait_target_seconds: 300,
    odometer_max_km_per_trip: 2000,
  variance_threshold_percent: 10,
  provisional_fare: null,
  distance: null,
    payment: { payment_method: 'cash', payer: null },
    odometer_start: 104_320,
    odometer_end: 104_332,
    odometer_start_photo_url: null,
    odometer_end_photo_url: null,
    distance_km: '12.00',
    gps_distance_km: null,
    distance_variance_flagged: false,
    started_at: '2026-08-15T08:00:00+03:00',
    completed_at: '2026-08-15T08:40:00+03:00',
    duration_minutes: 40,
    fare: {
      total_minor: 12_500,
      currency: 'UGX',
      rate_card_version_id: 4,
      computed_at: '2026-08-15T08:40:10+03:00',
      is_estimate: false,
    },
    estimated_fare: null,
    earnings,
    passenger_contact: null,
    created_at: null,
    updated_at: null,
  };
}

function stats(overrides: Partial<DriverStats> = {}): DriverStats {
  return {
    trips_today: 3,
    earnings_today_minor: 16_400,
    // Negative is the ordinary state for cash work (ADR-0029 §5).
    wallet_balance_minor: -4_500,
    currency: 'UGX',
    acceptance_rate: 0.92,
    completion_rate: 1,
    rating: 4.7,
    rating_count: 6,
    window_days: 30,
    ...overrides,
  };
}

const navigate = jest.fn();

/**
 * `null` means "the stats have not loaded", and it is spelled `null` rather
 * than `undefined` deliberately: passing `undefined` to a parameter with a
 * default value re-triggers the default, so the not-loaded case silently
 * rendered a fully-loaded wallet. That mistake is what this comment is for.
 */
async function renderComplete(
  value: Trip = trip(),
  driverStats: DriverStats | null = stats(),
  onDuty = true,
): Promise<ReturnType<typeof render>> {
  mockUseTrip.mockReturnValue({ data: value, isLoading: false });
  mockUseDriverStats.mockReturnValue({ data: driverStats ?? undefined });
  mockUseDuty.mockReturnValue({ data: { on_duty: onDuty } });

  const node: ReactElement = (
    <RideCompleteScreen
      route={{ key: 'r', name: 'RideComplete', params: { tripId: value.id } }}
      navigation={{ navigate, goBack: jest.fn() } as never}
    />
  );

  return render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);
}

beforeEach(() => {
  navigate.mockClear();
  mockSetDuty.mockClear();
});

// -- The confirmed trip ---------------------------------------------------

it('states the fare, the platform fee and what the driver earned', async () => {
  const { getByText } = await renderComplete();

  expect(getByText('Fare')).toBeTruthy();
  expect(getByText('UGX 12,500')).toBeTruthy();

  expect(getByText('Platform fee')).toBeTruthy();
  expect(getByText('- UGX 2,500')).toBeTruthy();

  expect(getByText('You earned')).toBeTruthy();
  expect(getByText('UGX 10,000')).toBeTruthy();
});

it('never labels the gross fare as the driver’s earnings', async () => {
  // The mockup did exactly this — "Your earnings UGX 14,500" over a 12,500
  // fare plus a tip — which overstates take-home by the whole commission.
  const { queryByText, getByText } = await renderComplete();

  expect(queryByText('Your earnings')).toBeNull();

  // The figure beside "You earned" is the net one, not the gross.
  expect(getByText('You earned')).toBeTruthy();
  expect(queryByText('UGX 14,500')).toBeNull();
});

it('shows no tip row, because the platform has no concept of one', async () => {
  const { queryByText } = await renderComplete();

  expect(queryByText('Tip')).toBeNull();
  expect(queryByText('+ UGX 2,000')).toBeNull();
});

it('does not state the commission percentage', async () => {
  // A runtime setting the office can change, and not in the payload. A
  // handset that printed "20%" would go on printing it after they changed it.
  const { queryByText } = await renderComplete();

  expect(queryByText('Platform fee (20%)')).toBeNull();
  expect(queryByText('20%')).toBeNull();
});

it('reads the whole card as one sentence for a screen reader', async () => {
  // A grid read cell by cell says "Fare, 12,500, Platform fee, 2,500" with no
  // indication that the middle one was subtracted.
  const { getByLabelText } = await renderComplete();

  expect(
    getByLabelText(
      'Fare UGX 12,500, less a platform fee of UGX 2,500. You earned UGX 10,000.',
    ),
  ).toBeTruthy();
});

// -- The trip the office has not confirmed --------------------------------

it('says the trip is saved and waiting to be sent, rather than showing zeroes', async () => {
  // The state a driver actually sees most: completion is queued through the
  // outbox, so the phone arrives here before the server has the transition.
  const { getByText, queryByText } = await renderComplete(trip(null));

  expect(getByText(/saved on this phone/)).toBeTruthy();

  // Not a figure in sight — and above all not a zero, which reads as an
  // unpaid morning.
  expect(queryByText('UGX 0')).toBeNull();
  expect(queryByText('You earned')).toBeNull();
  expect(queryByText('Platform fee')).toBeNull();
});

it('still congratulates the driver on a trip that has not been confirmed', async () => {
  // The ride *is* finished — that is a fact about the driver's work, not
  // about the server. Withholding it until a sync landed would make the
  // screen feel broken in a dead zone.
  const { getByText } = await renderComplete(trip(null));

  expect(getByText('Great job!')).toBeTruthy();
});

// -- The wallet -----------------------------------------------------------

it('renders the wallet magnitude with the direction in words, never a minus', async () => {
  const { getByText, queryByText } = await renderComplete();

  expect(getByText('UGX 4,500')).toBeTruthy();
  expect(getByText('You owe the office')).toBeTruthy();

  // The first person to read "UGX -4,500" asked whether the sign was a bug.
  expect(queryByText('UGX -4,500')).toBeNull();
});

it('warns that the balance does not yet count the trip just finished', async () => {
  // Found by rendering both states side by side, not by a test: the balance
  // is a sum over the ledger, and a trip the office has not received is not
  // in it. Finish a 12,500 cash ride with 4,500 already owed and the card
  // says 4,500 when the driver is in fact holding 17,000 of the office's
  // money.
  const { getByText } = await renderComplete(trip(null));

  expect(getByText('Not counting this trip yet')).toBeTruthy();
});

it('drops the warning once the office has confirmed the trip', async () => {
  const { queryByText } = await renderComplete(trip());

  expect(queryByText('Not counting this trip yet')).toBeNull();
});

it('says the wallet has not loaded rather than showing a zero balance', async () => {
  const { getByText } = await renderComplete(trip(), null);

  expect(getByText('—')).toBeTruthy();
  expect(getByText('Not loaded yet')).toBeTruthy();
});

// -- Where the buttons go -------------------------------------------------

it('returns a driver who is already on duty straight to work, changing nothing', async () => {
  // "Back Online" was the mockup's label, and completing a trip does not take
  // a driver off duty — so there is nothing to restore.
  const { getByText } = await renderComplete(trip(), stats(), true);

  void fireEvent.press(getByText('Back to work'));

  expect(mockSetDuty).not.toHaveBeenCalled();
  expect(navigate).toHaveBeenCalledWith('TripsHome');
});

it('offers to go online, and actually does, when the driver is off duty', async () => {
  const { getByText } = await renderComplete(trip(), stats(), false);

  void fireEvent.press(getByText('Go online'));

  expect(mockSetDuty).toHaveBeenCalledWith({ onDuty: true });
  expect(navigate).toHaveBeenCalledWith('TripsHome');
});

it('sends the back arrow Home, never back to the finished trip’s live screen', async () => {
  // Behind this screen is the live-leg screen for a trip that has ended.
  // Landing there offers an End trip button that 422s out of the outbox.
  const { getByLabelText } = await renderComplete();

  void fireEvent.press(getByLabelText('Back'));

  expect(navigate).toHaveBeenCalledWith('TripsHome');
});

it('opens the trip record from the secondary button', async () => {
  // "View Earnings" on the mockup, which has nowhere to go: no earnings
  // screen exists. The record does, and it is a different destination from
  // the primary button's.
  const { getByText } = await renderComplete();

  void fireEvent.press(getByText('Trip details'));

  expect(navigate).toHaveBeenCalledWith('TripDetail', { tripId: 42 });
});
