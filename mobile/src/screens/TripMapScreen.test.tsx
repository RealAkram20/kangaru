import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { Trip } from '../api/types';
import { TripMapScreen } from './TripMapScreen';

/**
 * That the full-screen map mounts, and points at the right end of the job.
 *
 * The one rule with teeth here is which place it sends the driver to: before
 * the passenger is aboard that is the pickup, and after it is the drop-off.
 * Getting it backwards sends a driver to a kerb they already left.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

const mockUseTrip = jest.fn();
const mockPosition = jest.fn();
const mockOpenDirections = jest.fn();

jest.mock('../trips/queries', () => ({ useTrip: (id: number) => mockUseTrip(id) }));
jest.mock('../location/usePosition', () => ({ usePosition: () => mockPosition() }));
jest.mock('../trips/directions', () => ({
  openDirections: (...args: unknown[]) => mockOpenDirections(...args),
}));

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 42,
    tenant_id: null,
    customer_id: 9,
    booking_id: null,
    vehicle_id: 7,
    driver_id: 3,
    origin: 'Acacia Mall',
    destination: 'Kololo Airstrip',
    pickup: { label: 'Acacia Mall', latitude: 0.3346, longitude: 32.5906 },
    dropoff: { label: 'Kololo Airstrip', latitude: 0.3268, longitude: 32.6011 },
    status: 'trip_started',
    allowed_transitions: ['waiting', 'trip_completed'],
    pickup_wait_target_seconds: 300,
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
    passenger_contact: null,
    earnings: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

async function renderMap(value: Trip = trip()) {
  mockUseTrip.mockReturnValue({ data: value, isLoading: false });
  mockPosition.mockReturnValue({ lat: 0.3532, lng: 32.5825 });

  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <TripMapScreen
        route={{ key: 'm', name: 'TripMap', params: { tripId: value.id } }}
        navigation={{ navigate: jest.fn(), goBack: jest.fn() } as never}
      />
    </SafeAreaProvider>,
  );
}

beforeEach(() => mockOpenDirections.mockClear());

it('points at the drop-off once the passenger is aboard', async () => {
  const { getByText } = await renderMap();

  expect(getByText('Drop-off')).toBeTruthy();
  expect(getByText('Kololo Airstrip')).toBeTruthy();
});

it('points at the pickup before the passenger is aboard', async () => {
  // Sending a driver to a kerb they already left is the kind of small
  // wrongness that makes an app feel like it is not paying attention.
  const { getByText } = await renderMap(trip({ status: 'driver_en_route' }));

  expect(getByText('Pickup')).toBeTruthy();
  expect(getByText('Acacia Mall')).toBeTruthy();
});

it('still says the distance is a straight line, not a road', async () => {
  const { getByText } = await renderMap();

  expect(getByText('straight line — not the road distance')).toBeTruthy();
});

it('keeps the hand-off to a real maps app, as a choice rather than the only door', async () => {
  const { getByLabelText } = await renderMap();

  void fireEvent.press(getByLabelText('Open in Maps'));

  expect(mockOpenDirections).toHaveBeenCalledWith(
    { lat: 0.3268, lng: 32.6011 },
    'Kololo Airstrip',
  );
});

it('offers no hand-off for a trip with no coordinates', async () => {
  const { queryByLabelText } = await renderMap(
    trip({ dropoff: { label: 'Kololo Airstrip', latitude: null, longitude: null } }),
  );

  expect(queryByLabelText('Open in Maps')).toBeNull();
});

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

it('names every marker, rather than leaving three coloured dots', async () => {
  // The complaint that produced this: "we cannot see where we are and where we
  // are going". All three points were on screen the whole time — as a green
  // ring, a red dot and a blue dot, with nothing saying which was which.
  // `docs/screen-rules.md` §6 forbids meaning by colour alone, and the
  // full-screen map has no rail beneath it to name the ends in words.
  const view = await renderMap();
  const html = mapHtml(view.toJSON());

  expect(html).toContain('"Pickup"');
  expect(html).toContain('"Drop-off"');
  expect(html).toContain('"You"');

  // The words reaching the document is not the same as the document drawing
  // them, and Jest does not execute the WebView — so the mechanism is pinned
  // too. Written after a mutation survived: deleting the line that writes the
  // label into the element left the three strings sitting in the HTML as
  // arguments to a call that no longer used them, and the assertions above
  // passed happily.
  expect(html).toContain('class="tag"');
  expect(html).toContain('textContent = label');
});

it('lets the driver pan and zoom when the map has the whole screen', async () => {
  // `interactive: false` is right for the 220pt panel — it sits in a
  // ScrollView and a pannable map swallows the drag meant to scroll the page.
  // On a full screen it meant a driver could not zoom in to see anything.
  const view = await renderMap();

  expect(mapHtml(view.toJSON())).toContain('interactive: true');
});
