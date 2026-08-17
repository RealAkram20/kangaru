import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { DriverPerformance } from '../api/endpoints';
import { PerformanceScreen } from './PerformanceScreen';

/**
 * That the Performance screen mounts, and shows only what the platform has.
 *
 * `performance/presentation.test.ts` owns the arithmetic. This suite exists
 * because that one does not prove the screen renders — the lesson the home
 * screen taught this codebase, where a formatter's tests were green while the
 * tile printed `undefined NaN` — and because the refusals below would
 * otherwise live only in a docblock:
 *
 * - **No bonus card at all** when the scheme is off. Not an empty one.
 * - **No "Great job! Keep it up."** anywhere. It is a judgement this app has
 *   not assessed and would say identically to a driver at 40% acceptance.
 * - **No invented ceilings.** Where a denominator is absent the caption is
 *   absent too, rather than falling back to a plausible-looking number.
 * - **Every dial announces itself as one sentence**, so a 2×3 grid does not
 *   linearise into six figures followed by six labels.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

// `mock` prefix required: Jest hoists the factory above this line.
const mockUseDriverPerformance = jest.fn();

jest.mock('../performance/queries', () => ({
  useDriverPerformance: () => mockUseDriverPerformance(),
}));

/*
 * `SyncBanner` reaches `SyncProvider`, which reaches `AuthProvider`, which
 * imports the push token store and therefore AsyncStorage — a native module
 * that is null under Jest and throws at import, taking the whole suite with
 * it before a single test runs. The banner is not what this suite is about,
 * and `ProfileScreen.test.tsx` stubs it the same way.
 */
jest.mock('../ui/SyncBanner', () => ({ SyncBanner: () => null }));

function performance(overrides: Partial<DriverPerformance> = {}): DriverPerformance {
  return {
    acceptance_rate: 92,
    completion_rate: 96,
    cancellation_rate: 3,
    rating: 4.8,
    rating_count: 40,
    window_days: 30,
    trips_total: 428,
    week_start: '2026-08-10',
    timezone: 'Africa/Kampala',
    trips_this_week: 28,
    online_seconds_this_week: 26_400,
    rostered_seconds_this_week: 45 * 3600,
    bonus: {
      trips: 28,
      trip_target: 30,
      amount_minor: 20000,
      currency: 'UGX',
      week_start: '2026-08-10T00:00:00+03:00',
      ends_at: '2026-08-17T00:00:00+03:00',
      achieved: false,
    },
    ...overrides,
  };
}

const goBack = jest.fn();

async function renderScreen(
  data: DriverPerformance | null = performance(),
  isError = false,
): Promise<ReturnType<typeof render>> {
  mockUseDriverPerformance.mockReturnValue({ data: data ?? undefined, isError });

  const node: ReactElement = (
    <PerformanceScreen
      route={{ key: 'p', name: 'Performance', params: undefined }}
      navigation={{ goBack, navigate: jest.fn(), getParent: () => ({ navigate: jest.fn() }) } as never}
    />
  );

  return render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);
}

beforeEach(() => {
  goBack.mockClear();
  mockUseDriverPerformance.mockClear();
});

it('draws the six dials the mockup asks for', async () => {
  const { getByText } = await renderScreen();

  expect(getByText('Your Performance')).toBeTruthy();

  expect(getByText('4.8')).toBeTruthy();
  expect(getByText('92%')).toBeTruthy();
  expect(getByText('96%')).toBeTruthy();
  expect(getByText('3%')).toBeTruthy();
  expect(getByText('28')).toBeTruthy();
  expect(getByText('7h 20m')).toBeTruthy();

  expect(getByText('Rating')).toBeTruthy();
  expect(getByText('Acceptance')).toBeTruthy();
  expect(getByText('Completion')).toBeTruthy();
  expect(getByText('Cancellation')).toBeTruthy();
});

it('never says "Great job", and praises with a figure instead', async () => {
  const { getByText, queryByText } = await renderScreen();

  expect(queryByText(/Great job/i)).toBeNull();
  expect(getByText('428 trips completed, all time.')).toBeTruthy();
});

it('re-bases the two dials that had no ceiling, and says what against', async () => {
  const { getByText } = await renderScreen();

  // Not "Total Trips" and not "Online Hours 7h 20m against nothing". Both
  // dials now measure against something real, and the caption says what.
  expect(getByText('Trips this week')).toBeTruthy();
  expect(getByText('of 30')).toBeTruthy();
  expect(getByText('Hours this week')).toBeTruthy();
  expect(getByText('of 45h')).toBeTruthy();
});

it('shows the weekly card as the mockup draws it', async () => {
  const { getByText } = await renderScreen();

  expect(getByText('This week')).toBeTruthy();
  expect(getByText('Trips completed')).toBeTruthy();
  expect(getByText('28 / 30')).toBeTruthy();
  expect(getByText('Complete 2 more trips to reach your weekly bonus.')).toBeTruthy();
});

it('drops the weekly card entirely when the bonus scheme is off', async () => {
  const { queryByText, getByText } = await renderScreen(performance({ bonus: null }));

  // Absent, not empty. A card reading "0 of 40 trips" for a fleet that runs
  // no bonus scheme is an invented figure dressed as a measurement.
  expect(queryByText('This week')).toBeNull();
  expect(queryByText('Trips completed')).toBeNull();
  expect(queryByText(/weekly bonus/i)).toBeNull();

  // The count itself is still true and is still shown — only its ceiling and
  // the card are gone.
  expect(getByText('28')).toBeTruthy();
  expect(getByText('Trips this week')).toBeTruthy();
});

it('drops the roster caption and footnote for a driver with no roster', async () => {
  const { queryByText, getByText } = await renderScreen(
    performance({ rostered_seconds_this_week: null }),
  );

  // ADR-0017 §3: no shift windows means available at any hour, which is not a
  // number to draw an arc or write a caption against.
  expect(queryByText(/of 45h/)).toBeNull();
  expect(queryByText(/rostered for this week/i)).toBeNull();
  expect(getByText('7h 20m')).toBeTruthy();
});

it('shows em dashes rather than zeroes for a driver who has done nothing', async () => {
  const { getAllByText, getByText } = await renderScreen(
    performance({
      acceptance_rate: null,
      completion_rate: null,
      cancellation_rate: null,
      rating: null,
      rating_count: 0,
      trips_total: 0,
      trips_this_week: 0,
      online_seconds_this_week: 0,
      rostered_seconds_this_week: null,
      bonus: null,
    }),
  );

  // Four rates withheld. A 0% would read as a failing grade for having done
  // nothing wrong.
  expect(getAllByText('—')).toHaveLength(4);
  expect(getByText('Your figures appear here once you have completed a trip.')).toBeTruthy();
});

it('composes one announcement per dial rather than a grid of loose numbers', async () => {
  const { getByLabelText } = await renderScreen();

  expect(getByLabelText('Rating 4.8 out of 5, from 40 ratings.')).toBeTruthy();
  expect(getByLabelText('Acceptance rate 92 percent over the last 30 days.')).toBeTruthy();
  expect(getByLabelText('28 of 30 trips completed this week.')).toBeTruthy();
  expect(getByLabelText('Online 7h 20m this week, of 45h rostered.')).toBeTruthy();
  // The card's row, announced as a pair rather than as a label and a fraction
  // a listener has to join up themselves.
  expect(getByLabelText('Trips completed this week: 28 of 30.')).toBeTruthy();
});

/**
 * Counts the SVG circles the screen drew.
 *
 * Every dial draws a track; only a dial with a real denominator draws an arc
 * on top of it. Nothing else on this screen asserts that, and it is the one
 * behaviour the whole design turns on — the presentation tests prove
 * `fraction` is null, and this proves the component *acts* on it.
 *
 * `react-native-svg` is stubbed as host components in `jest.setup.ts`, so a
 * `Circle` renders as a host element of that name.
 */
function circles(tree: Awaited<ReturnType<typeof render>>): number {
  let count = 0;

  const walk = (node: unknown): void => {
    if (node === null || node === undefined || typeof node !== 'object') {
      return;
    }

    if (Array.isArray(node)) {
      node.forEach(walk);

      return;
    }

    const element = node as { type?: unknown; children?: unknown };

    if (element.type === 'Circle') {
      count++;
    }

    walk(element.children);
  };

  walk(tree.toJSON());

  return count;
}

it('draws an arc only where there is a real denominator', async () => {
  // Six tracks and six arcs: every figure here has something to be a fraction
  // of.
  expect(circles(await renderScreen())).toBe(12);

  // Bonus scheme off and no roster. Six tracks, four arcs — the two re-based
  // dials draw their figure and nothing else, because there is no ceiling to
  // draw them against. Make `fractionOf` return 0 instead of null, or drop
  // the null check in `Dial`, and this comes back as 12: two rings that claim
  // a driver achieved none of a target nobody set them.
  expect(
    circles(
      await renderScreen(performance({ bonus: null, rostered_seconds_this_week: null })),
    ),
  ).toBe(10);
});

it('says so when the figures could not be loaded, and can actually be pulled', async () => {
  const refetch = jest.fn();

  mockUseDriverPerformance.mockReturnValue({ data: undefined, isError: true, refetch, isRefetching: false });

  const tree = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <PerformanceScreen
        route={{ key: 'p', name: 'Performance', params: undefined }}
        navigation={{ goBack, navigate: jest.fn(), getParent: () => ({ navigate: jest.fn() }) } as never}
      />
    </SafeAreaProvider>,
  );

  expect(tree.getByText(/could not be loaded/i)).toBeTruthy();

  // The notice says "Pull down". It said that before there was anything to
  // pull, which is worse than saying nothing: a driver on a patchy upcountry
  // connection pulls, nothing happens, and concludes the app is broken rather
  // than the network. Remove the `refreshControl` and this fails.
  const scroll = tree.getByTestId('performance-scroll');

  expect(scroll.props.refreshControl).toBeTruthy();

  scroll.props.refreshControl.props.onRefresh();

  expect(refetch).toHaveBeenCalled();
});
