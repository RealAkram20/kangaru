import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { Trip, TripStatus } from '../api/types';
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

// `mock` prefix required: Jest hoists the factory below above these
// declarations, and only names matching /^mock/ may be referenced inside one.
const mockQueueTransition = jest.fn(async () => undefined);
let mockQueued = new Map<number, TripStatus>();

jest.mock('../offline/SyncProvider', () => ({
  useSync: () => ({
    queueTransition: mockQueueTransition,
    sync: jest.fn(),
    // The outbox's pending transitions, keyed by trip. Empty unless a test is
    // about a move the driver has made and the office has not confirmed.
    queued: mockQueued,
  }),
}));

jest.mock('../ui/SyncBanner', () => ({ SyncBanner: () => null }));

// `mock` prefix required: Jest hoists the factory below above this
// declaration, and only names matching /^mock/ are allowed to be referenced
// from inside one.
const mockUseTrip = jest.fn();
const mockUseTripRoute = jest.fn();

jest.mock('../trips/queries', () => ({
  useTrip: (id: number) => mockUseTrip(id),
  // The road route itself is decoration over a map that already works, and
  // stays absent through most of this suite. **Which leg it asks for is not
  // decoration**, so the arguments are forwarded rather than swallowed — see
  // the two tests at the foot of this file.
  useTripRoute: (...args: unknown[]) => mockUseTripRoute(...args) ?? { data: null },
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
    service_type: 'ride',
    reference: null,
    package: null,
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

beforeEach(() => {
  mockQueueTransition.mockClear();
  mockNavigate.mockClear();
  mockReplace.mockClear();
  // Nothing in flight is the ordinary case; the two tests about a queued
  // transition set it themselves.
  mockQueued = new Map();
  // Cleared as well as re-stubbed: `mockReturnValue` leaves the call log
  // alone, and the leg assertions read that log.
  mockUseTripRoute.mockClear();
  mockUseTripRoute.mockReturnValue({ data: null });
});

const mockNavigate = jest.fn();
const mockReplace = jest.fn();

async function renderPickup(value: Trip = trip()): Promise<ReturnType<typeof render>> {
  mockUseTrip.mockReturnValue({ data: value, isLoading: false });

  const node: ReactElement = (
    <PickupScreen
      route={{ key: 'p', name: 'Pickup', params: { tripId: value.id } }}
      // Only `navigate`, `replace` and `goBack` are reached; the rest of the
      // navigation prop is not this screen's business and stubbing it whole
      // would assert nothing.
      navigation={{ navigate: mockNavigate, goBack: jest.fn(), replace: mockReplace } as never}
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

it('does not offer a leg transition that is already queued', async () => {
  // The owner's report, generalised: `allowed_transitions` is computed for the
  // status the server last confirmed, so between the press and the drain this
  // screen went on offering the move the driver had already made. In the
  // stairwell this screen is written for, that is the rest of the leg. A second
  // press queues a second item, which posts from a status the server has left,
  // and parks — a queue item needing a human, earned by pressing the only
  // button on screen.
  mockQueued = new Map([[42, 'driver_arrived' as TripStatus]]);

  const { queryByText, getByText } = await renderPickup();

  expect(queryByText("I've arrived")).toBeNull();
  expect(getByText(/^Arrived at pickup\./)).toBeTruthy();
  // Same sentence as the odometer's footnote: a driver meets it on both
  // screens and it means one thing.
  expect(getByText(/Saved on this phone, sent when you have signal\./)).toBeTruthy();
});

it('offers the leg transitions again once nothing is queued', async () => {
  // The other half, and the reason this reads the outbox rather than inventing
  // an optimistic status: a refused item leaves `queued` and the buttons come
  // back, rather than the driver being stranded with no control at all.
  mockQueued = new Map();

  const { getByText } = await renderPickup();

  expect(getByText("I've arrived")).toBeTruthy();
});

it('queues a leg transition once per press', async () => {
  mockQueued = new Map();

  const { getByText } = await renderPickup();

  void fireEvent.press(getByText("I've arrived"));

  await waitFor(() => expect(mockQueueTransition).toHaveBeenCalled());

  // A count. This log records three surviving mutations that were existence
  // assertions passing against the wrong number of calls.
  expect(mockQueueTransition).toHaveBeenCalledTimes(1);
  expect(mockQueueTransition).toHaveBeenCalledWith(
    expect.objectContaining({ tripId: 42, to: 'driver_arrived' }),
  );
});

it("hands the drive off to the waiting screen on I've arrived", async () => {
  const { getByText } = await renderPickup();

  void fireEvent.press(getByText("I've arrived"));

  // The transition is queued first — the handoff must not outrun the record
  // of the arrival it announces.
  await waitFor(() => expect(mockQueueTransition).toHaveBeenCalled());
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('WaitingForPassenger', { tripId: 42 }));

  // `replace`, not `navigate` — the drive must not sit behind the wait.
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('stays put after a transition that is not the arrival', async () => {
  const { getByText } = await renderPickup(
    trip({ status: 'accepted', allowed_transitions: ['driver_en_route'] }),
  );

  void fireEvent.press(getByText('On my way'));

  await waitFor(() => expect(mockQueueTransition).toHaveBeenCalled());

  // "On my way" begins the drive this screen exists for; leaving it would
  // hand the driver to a kerb they have not reached.
  expect(mockReplace).not.toHaveBeenCalled();
});

it('sends the opening reading to the odometer, not the record view', async () => {
  const { getByText } = await renderPickup(
    // A trip resumed at `passenger_onboard` — the app was killed mid-capture,
    // or the boarding was queued from this screen. The only legal move is
    // `trip_started`, and it needs the reading.
    trip({ status: 'passenger_onboard', allowed_transitions: ['trip_started'] }),
  );

  void fireEvent.press(getByText('Start trip'));

  await waitFor(() =>
    expect(mockNavigate).toHaveBeenCalledWith('Odometer', {
      tripId: 42,
      to: 'trip_started',
      from: 'passenger_onboard',
    }),
  );

  // The detour this replaces: a record view of em dashes whose one live
  // button asked for the same press again.
  expect(mockNavigate).not.toHaveBeenCalledWith('TripDetail', expect.anything());
  // Nothing was queued — the reading has not been taken yet.
  expect(mockQueueTransition).not.toHaveBeenCalled();
});

// ── The road to the passenger, and only that road ─────────────────────────

/** The HTML handed to the WebView, dug out of the rendered tree. */
function mapHtml(tree: unknown): string {
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

it('asks for the road to the passenger, never the passenger journey', async () => {
  // This screen is the drive *to* somebody. The drop-off is on its map as a
  // pin and nothing else, and the leg named here is what keeps it that way.
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValueOnce({
    status: 'granted',
    granted: true,
  } as never);

  await renderPickup();

  // Both halves matter. `'pickup'` is the leg; the driver's own position is
  // the origin, and the approach has no other honest one — routing from the
  // pickup to the pickup is a zero-length line.
  await waitFor(() =>
    expect(mockUseTripRoute).toHaveBeenCalledWith(
      42,
      { lat: expect.any(Number), lng: expect.any(Number) },
      'pickup',
    ),
  );
});

it('follows the driver instead of freezing at the kerb they set off from', async () => {
  // A single fix was right while `here` fed only the "to pickup" figure. It
  // became wrong when ADR-0031 made the same reading the *origin of the drawn
  // route*: `useTripRoute` refetches on a changed position, so a frozen fix
  // drew the road from wherever the screen opened and never redrew it.
  jest.mocked(Location.watchPositionAsync).mockClear();
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValueOnce({
    status: 'granted',
    granted: true,
  } as never);

  await renderPickup();

  await waitFor(() => expect(Location.watchPositionAsync).toHaveBeenCalled());
});

it('draws nothing rather than the wrong leg when there is no fix', async () => {
  // Permission is denied by default in `jest.setup.ts`, so there is no
  // position and — the ordinary case — no route. The map used to fall back to
  // the one line it still had, the pickup-to-drop-off leg, and drew the
  // passenger's journey on the screen for driving to the passenger. The
  // owner, from a handset: "i should be seeing where the client is and where
  // i am going".
  const view = await renderPickup();
  const html = mapHtml(view.toJSON());

  expect(html).toContain('"leg":"approach"');
  expect(html).toContain("if (state.leg === 'approach')");
  // And the branch that leaves it empty without a fix.
  expect(html).toContain('if (state.here !== null)');
});
