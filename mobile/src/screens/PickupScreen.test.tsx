import { render } from '@testing-library/react-native';
import * as Location from 'expo-location';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { Trip } from '../api/types';
import { PickupScreen } from './PickupScreen';

/**
 * That the pickup screen renders, and renders only what the platform has.
 *
 * Deliberately narrow. `places.test.ts` owns the arithmetic and
 * `offerPresentation.test.ts` owns the wording; this suite exists because
 * neither proves the screen *mounts* — a WebView, a location hook and a
 * navigation prop are three ways for a screen to be perfectly correct and
 * blank. It also pins the rules that would otherwise live only in a comment:
 *
 * - the passenger's name and number appear here and only here, because
 *   ADR-0024 §7 releases them on the accept;
 * - **no rating, no photograph, no loyalty badge** — the mockup carried all
 *   three and the platform has none of them, and ADR-0030's ratings run the
 *   other way (the customer rates the driver);
 * - no minutes anywhere, ADR-0020 §3;
 * - an em dash rather than a figure wherever the platform does not know.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

jest.mock('../offline/SyncProvider', () => ({
  useSync: () => ({ queueTransition: jest.fn(async () => undefined), sync: jest.fn() }),
}));

jest.mock('../ui/SyncBanner', () => ({ SyncBanner: () => null }));

// `mock` prefix required: Jest hoists the factory below above this
// declaration, and only names matching /^mock/ are allowed to be referenced
// from inside one.
const mockUseTrip = jest.fn();

jest.mock('../trips/queries', () => ({
  useTrip: (id: number) => mockUseTrip(id),
}));

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
    status: 'driver_en_route',
    allowed_transitions: ['driver_arrived'],
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
    estimated_fare: {
      vehicle_category: 'sedan',
      distance_km: 4.6,
      total_minor: 12500,
      currency: 'UGX',
      is_estimate: true,
      basis: 'Straight-line distance. The final fare follows the distance actually travelled.',
    },
    earnings: null,
    passenger_contact: { name: 'Sarah N.', phone: '+256700123456', label: 'Passenger' },
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

async function renderPickup(value: Trip = trip()): Promise<ReturnType<typeof render>> {
  mockUseTrip.mockReturnValue({ data: value, isLoading: false });

  const node: ReactElement = (
    <PickupScreen
      route={{ key: 'p', name: 'Pickup', params: { tripId: value.id } }}
      // Only `navigate` and `goBack` are reached; the rest of the navigation
      // prop is not this screen's business and stubbing it whole would assert
      // nothing.
      navigation={{ navigate: jest.fn(), goBack: jest.fn() } as never}
    />
  );

  return render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);
}

it('shows the passenger the accept released, and how to ring them', async () => {
  const { getByText, getAllByText, getByLabelText } = await renderPickup();

  expect(getByText('Pickup passenger')).toBeTruthy();
  expect(getByText('Sarah N.')).toBeTruthy();
  // Said once, not twice: the channel caption is suppressed while it matches
  // the row label, and appears the day a masking provider changes it.
  expect(getAllByText('Passenger')).toHaveLength(1);
  expect(getByLabelText('Call Sarah N.')).toBeTruthy();

  expect(getByText('Acacia Mall, 14-18 Cooper Rd')).toBeTruthy();
  expect(getByText('Kololo Airstrip')).toBeTruthy();

  expect(getByText("I've arrived")).toBeTruthy();
});

it('puts no rating, photograph or loyalty badge on the passenger', async () => {
  // The mockup carried a photo, "4.8" with a star, and a "Regular" tier. None
  // exists on this platform, and ADR-0030's ratings run the other way — the
  // customer rates the driver, after the trip, withheld below five ratings.
  const { queryByText } = await renderPickup();

  expect(queryByText(/4\.8|★|rating/i)).toBeNull();
  expect(queryByText(/regular/i)).toBeNull();
  expect(queryByText(/\btrips?\b/i)).toBeNull();
});

it('shows no ETA, because the platform cannot honestly derive one', async () => {
  // ADR-0020 §3 by name. This is the screen where a "12 min" is most tempting
  // — the mockup had one twice, on the map badge and in the facts row — and
  // it would run short in front of a waiting passenger every time.
  const { queryByText } = await renderPickup();

  expect(queryByText(/\bmin(ute)?s?\b/i)).toBeNull();
  expect(queryByText(/\bETA\b/i)).toBeNull();
});

it('measures the journey from the two ends, with or without a GPS fix', async () => {
  const { getByText } = await renderPickup();

  expect(getByText('Journey')).toBeTruthy();
  expect(getByText('To pickup')).toBeTruthy();

  // 0.03 of latitude plus 0.01 of longitude from Acacia Mall to Kololo is
  // ~3.5 km. Needs no permission — both ends came from the server.
  expect(getByText('3.5 km')).toBeTruthy();
});

it('measures the pickup leg from where the driver actually is', async () => {
  // The distance the badge and the first cell both show. It is the one figure
  // on this screen computed on the handset rather than served, because it is
  // measured from a position that changes while the driver drives.
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValueOnce({
    status: 'granted',
    granted: true,
  } as never);

  const { getAllByText, getByText } = await renderPickup();

  // Kampala centre to Acacia Mall is ~2.2 km. Rendered twice on purpose —
  // once on the map badge, once in the facts row.
  expect(getAllByText('2.2 km')).toHaveLength(2);

  // And said to be a straight line, so nobody plans a road journey on it.
  expect(getByText('straight line')).toBeTruthy();
});

it('shows no pickup distance when the handset has no fix to measure from', async () => {
  // The default in `jest.setup.ts`: permission denied, which is what a driver
  // who declined the prompt has. An em dash, never a guess — and the screen
  // never prompts from here, because a dialog out of a screen transition is
  // one nobody can connect to anything they did.
  const { getByText, queryByText } = await renderPickup();

  expect(getByText('To pickup')).toBeTruthy();
  expect(queryByText('straight line')).toBeNull();
});

it('calls an unsettled figure an estimate, and a settled one a fare', async () => {
  const estimated = await renderPickup();

  expect(estimated.getByText('Estimated fare')).toBeTruthy();
  expect(estimated.getByText('UGX 12,500')).toBeTruthy();

  const settled = await renderPickup(
    trip({
      fare: {
        total_minor: 13000,
        currency: 'UGX',
        rate_card_version_id: 4,
        computed_at: '2026-08-14T10:00:00+03:00',
        is_estimate: false,
      },
    }),
  );

  // A quote and a bill are different claims (ADR-0026 §2), so they are not
  // allowed to wear the same label.
  expect(settled.getByText('Fare')).toBeTruthy();
  expect(settled.getByText('UGX 13,000')).toBeTruthy();
});

it('renders an em dash rather than a figure for a trip taken over the phone', async () => {
  // No coordinates at either end and nothing priced — the ordinary shape of an
  // order a dispatcher keyed in. The row keeps its shape; it just stops
  // claiming to know things.
  const { getAllByText, getByText } = await renderPickup(
    trip({
      pickup: { label: 'Acacia Mall, 14-18 Cooper Rd', latitude: null, longitude: null },
      dropoff: { label: 'Kololo Airstrip', latitude: null, longitude: null },
      estimated_fare: null,
    }),
  );

  expect(getAllByText('—').length).toBeGreaterThanOrEqual(3);

  // And it says why there is no map, rather than drawing one of nowhere.
  expect(getByText(/No map for this trip/)).toBeTruthy();
});

it('shows nothing about the passenger when the server withheld them', async () => {
  // A corporate trip, where ADR-0024 §7 releases nothing at all. The block is
  // absent rather than rendering an empty card — there is no rule duplicated
  // in the client, only the presence of the field.
  const { queryByText, queryByLabelText } = await renderPickup(
    trip({ passenger_contact: null }),
  );

  expect(queryByText('Sarah N.')).toBeNull();
  expect(queryByLabelText(/^Call /)).toBeNull();
});
