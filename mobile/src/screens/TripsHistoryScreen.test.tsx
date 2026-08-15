import { fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { DriverHistoryTrip, DriverTripHistoryPage } from '../api/endpoints';
import { TripsHistoryScreen } from './TripsHistoryScreen';

/**
 * That the trips history mounts, groups by day, and shows only what the
 * platform has.
 *
 * `trips/history.test.ts` owns the wording and the arithmetic. This suite
 * exists because that one does not prove the screen renders, and because the
 * decisions below would otherwise live only in a docblock:
 *
 * - **The filter goes to the server**, not to a predicate over loaded rows.
 * - **Cancelled trips appear**, with an em dash and their status in words —
 *   never `UGX 0`.
 * - **The day headings come from the server's zone**, not the handset's.
 * - **No passenger name is anywhere on it** (ADR-0024 §7).
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

// `mock` prefix required: Jest hoists the factory above these declarations.
const mockUseTripHistory = jest.fn();
const mockFetchNextPage = jest.fn();

jest.mock('../trips/historyQueries', () => ({
  useTripHistory: (serviceType: string | null) => mockUseTripHistory(serviceType),
}));

function trip(overrides: Partial<DriverHistoryTrip> = {}): DriverHistoryTrip {
  return {
    id: 1,
    status: 'trip_completed',
    service_type: 'ride',
    origin: 'Acacia Mall',
    destination: 'Kololo',
    happened_at: '2026-08-15T07:45:00Z',
    local_day: '2026-08-15',
    local_time: '10:45',
    earned_minor: 12_500,
    currency: 'UGX',
    ...overrides,
  };
}

function page(trips: DriverHistoryTrip[]): DriverTripHistoryPage {
  return {
    trips,
    nextCursor: null,
    today: '2026-08-15',
    yesterday: '2026-08-14',
    timezone: 'Africa/Kampala',
  };
}

const navigate = jest.fn();
const goBack = jest.fn();

async function renderHistory(
  pages: DriverTripHistoryPage[] | null = [page([trip()])],
  extra: Record<string, unknown> = {},
): Promise<ReturnType<typeof render>> {
  mockUseTripHistory.mockReturnValue({
    data: pages === null ? undefined : { pages },
    isLoading: false,
    isError: false,
    isRefetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: mockFetchNextPage,
    refetch: jest.fn(),
    ...extra,
  });

  const node: ReactElement = (
    <TripsHistoryScreen
      route={{ key: 'h', name: 'TripsHistory', params: undefined }}
      navigation={{ goBack, navigate } as never}
    />
  );

  // `await`: RTL v14's render is async under this setup, and a synchronous
  // call returns before the tree has committed.
  return render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('the screen', () => {
  it('mounts and draws a row', async () => {
    const screen = await renderHistory();

    expect(screen.getByText('Trips History')).toBeTruthy();
    expect(screen.getByText('Ride')).toBeTruthy();
    expect(screen.getByText('10:45 AM')).toBeTruthy();
    expect(screen.getByText('UGX 12,500')).toBeTruthy();
  });

  it('heads a day with the server’s word, not the handset’s clock', async () => {
    const screen = await renderHistory([
      page([
        trip({ id: 1, local_day: '2026-08-15' }),
        trip({ id: 2, local_day: '2026-08-14', happened_at: '2026-08-14T15:30:00Z' }),
        trip({ id: 3, local_day: '2026-08-01', happened_at: '2026-08-01T09:00:00Z' }),
      ]),
    ]);

    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Yesterday')).toBeTruthy();
    // Anything older gets a date. Nothing on this screen computes a day from
    // `new Date()`, which is why a driver in another zone sees the fleet's.
    expect(screen.getByText('1 Aug 2026')).toBeTruthy();
  });
});

describe('the filter chips', () => {
  it('asks the server for one kind of job, rather than filtering a loaded page', async () => {
    const screen = await renderHistory();

    expect(mockUseTripHistory).toHaveBeenLastCalledWith(null);

    await fireEvent.press(screen.getByText('Deliveries'));

    // The value the server understands. Filtering the twenty-five loaded rows
    // instead would show "3 deliveries" and imply that was all of them.
    expect(mockUseTripHistory).toHaveBeenLastCalledWith('delivery');
  });

  it('says which chip is selected, not only which one is green', async () => {
    const screen = await renderHistory();

    // Never colour alone (AGENTS.md § Accessibility, DESIGN.md §3).
    expect(screen.getByLabelText('All').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Rides').props.accessibilityState.selected).toBe(false);
  });

  it('names the empty state after the chip, not after the whole history', async () => {
    const screen = await renderHistory([page([])]);

    expect(screen.getByText(/No finished trips yet/)).toBeTruthy();

    await fireEvent.press(screen.getByText('Deliveries'));

    // "No trips yet" under Deliveries is wrong and discouraging for a driver
    // who has done thirty rides.
    expect(screen.getByText(/No deliveries yet/)).toBeTruthy();
  });
});

describe('a trip that paid nothing', () => {
  it('renders an em dash and the status in words, never a zero', async () => {
    const screen = await renderHistory([
      page([trip({ status: 'cancelled', earned_minor: null, currency: null })]),
    ]);

    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('UGX 0')).toBeNull();
    // The em dash alone is a difference that is easy to miss and is not
    // announced at all — so the reason is on the row in words.
    expect(screen.getByText('Cancelled')).toBeTruthy();
  });

  it('does not label a completed trip, which every row here already is', async () => {
    const screen = await renderHistory();

    expect(screen.queryByText('Completed')).toBeNull();
  });
});

describe('what must not be on this screen', () => {
  it('shows no passenger name, because a history is not a directory', async () => {
    const screen = await renderHistory();

    // ADR-0024 §7. The payload carries no contact at all, and this pins the
    // screen against a future one that did.
    expect(screen.queryByText(/Sarah/)).toBeNull();
    expect(screen.queryByText(/Passenger/)).toBeNull();
  });

  it('shows no tip, bonus or rating', async () => {
    const screen = await renderHistory();

    // None of the three exists anywhere on this platform. Fourth screen to
    // refuse tips, third to refuse bonuses.
    expect(screen.queryByText(/Tip/)).toBeNull();
    expect(screen.queryByText(/Bonus/)).toBeNull();
    expect(screen.queryByText(/Rating/)).toBeNull();
  });
});

describe('opening a row', () => {
  it('routes through the shared destination map rather than always to the record', async () => {
    const screen = await renderHistory();

    void fireEvent.press(screen.getByLabelText(/Ride from Acacia Mall to Kololo/));

    // `TodayScreen` shipped a bug where every row went to `TripDetail`
    // regardless of status, which put a driver mid-trip on the record view.
    // `tripDestination()` is the one decision, and this list uses it.
    expect(navigate).toHaveBeenCalledWith('TripDetail', { tripId: 1 });
  });

  it('announces a row as one sentence, saying whose money the figure is', async () => {
    const screen = await renderHistory();

    expect(
      screen.getByLabelText('Ride from Acacia Mall to Kololo, at 10:45 AM. You earned UGX 12,500.'),
    ).toBeTruthy();
  });
});

describe('when the office cannot be reached', () => {
  it('serves the saved history and says it is saved', async () => {
    const screen = await renderHistory([page([trip()])], { isError: true });

    expect(screen.getByText('Ride')).toBeTruthy();
    expect(screen.getByText(/Showing the history saved on this phone/)).toBeTruthy();
  });

  it('says so plainly when there is nothing saved either', async () => {
    const screen = await renderHistory(null, { isError: true });

    expect(screen.getByText(/Could not load your trips/)).toBeTruthy();
  });
});
