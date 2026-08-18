import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';
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
  expect(getByText('Weekly trips')).toBeTruthy();
  expect(getByText('of 30')).toBeTruthy();
  expect(getByText('Weekly hours')).toBeTruthy();
  expect(getByText('of 45h')).toBeTruthy();
});

it('keeps every dial label inside the width a 360dp handset gives it', async () => {
  const { getAllByText } = await renderScreen();

  // `ui/facts.tsx` measured this for the fleet's narrowest phone: a
  // fourteen-character label at 14pt does not hold one line in a third of a
  // 360dp screen, which is why its stat cells drop to 12pt. These are 14pt and
  // must stay short enough not to need that. Twelve characters is
  // "Cancellation", which has shipped on this grid since it was drawn.
  for (const label of ['Rating', 'Acceptance', 'Completion', 'Cancellation', 'Weekly trips', 'Weekly hours']) {
    expect(getAllByText(label)).toHaveLength(1);
    expect(label.length).toBeLessThanOrEqual(12);
  }
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
  expect(getByText('Weekly trips')).toBeTruthy();
});

it('drops the roster caption and its explanation for a driver with no roster', async () => {
  const { queryByText, getByText } = await renderScreen(
    performance({ rostered_seconds_this_week: null }),
  );

  // ADR-0017 §3: no shift windows means available at any hour, which is not a
  // number to draw an arc or write a caption against.
  expect(queryByText(/of 45h/)).toBeNull();
  expect(queryByText(/roster/i)).toBeNull();
  expect(getByText('7h 20m')).toBeTruthy();
});

it('explains the grid in one line rather than in two paragraphs', async () => {
  const { getByText, queryByText } = await renderScreen();

  expect(getByText('Rates cover the last 30 days. Hours are measured against your roster.')).toBeTruthy();

  // The two blocks this replaced. The first asserted a 30-day window on the
  // rating, which the server does not apply to it; the second was twenty-three
  // words of prose under a screen of labelled rings.
  expect(queryByText(/Rating, acceptance, completion and cancellation/)).toBeNull();
  expect(queryByText(/could not be reached/)).toBeNull();
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

/**
 * The width of a dial's ring, in points.
 *
 * **Addressed by `testID`, and the first cut of this was a test that could not
 * fail.** It walked the tree for the first element of type `Svg` — which is the
 * header's back chevron, 26pt — so it measured an icon, fitted inside every
 * column, and passed at any ring size at all. The mutation that was supposed to
 * break it (the ring back to 96pt against a 93.6pt column) sailed through.
 */
function ringWidth(tree: Awaited<ReturnType<typeof render>>): number {
  const width = tree.getAllByTestId('dial-ring')[0]?.props.width;

  if (typeof width !== 'number') {
    throw new Error('No ring was drawn.');
  }

  return width;
}

/**
 * That the grid is 2×3 and that three rings fit a row on the narrowest phone.
 *
 * **This is the one class of defect every other test on this screen is blind
 * to.** Jest's renderer does not lay out, so `getByText('Cancellation')` passes
 * against a label that is, on a handset, four characters wide and sitting on
 * top of its neighbour — which is exactly what shipped: `Dial` carried
 * `flex: 1`, which expands to `flexBasis: 0%`, so every dial claimed no width,
 * all six "fitted" one line, `flexWrap` never wrapped, and the screen rendered
 * as six overlapping rings with every label clipped. Thirty-eight tests were
 * green through all of it. Only the emulator found it.
 *
 * So these assert the geometry as arithmetic rather than as appearance, which
 * is the part Jest can actually hold.
 */
it('lays the dials out three to a row, and wraps', async () => {
  const tree = await renderScreen();

  const dial = StyleSheet.flatten(
    tree.getByLabelText('Rating 4.8 out of 5, from 40 ratings.').props.style,
  ) as Record<string, unknown>;

  // Neither growing nor shrinking: a dial that can shrink is a dial that
  // squeezes to let a fourth one onto the row instead of pushing it down.
  expect(dial.flexGrow).toBe(0);
  expect(dial.flexShrink).toBe(0);

  const basis = Number(String(dial.flexBasis).replace('%', ''));

  // Three fit; a fourth cannot. Stated as the property rather than as "30%",
  // so tuning the column is allowed and collapsing it is not.
  expect(basis * 3).toBeLessThanOrEqual(100);
  expect(basis * 4).toBeGreaterThan(100);

  expect(StyleSheet.flatten(tree.getByTestId('performance-grid').props.style).flexWrap).toBe('wrap');
});

it('keeps the ring inside its column on the fleet’s narrowest handset', async () => {
  const tree = await renderScreen();

  const dial = StyleSheet.flatten(
    tree.getByLabelText('Rating 4.8 out of 5, from 40 ratings.').props.style,
  ) as Record<string, unknown>;

  const basis = Number(String(dial.flexBasis).replace('%', '')) / 100;
  const gutters = StyleSheet.flatten(
    tree.getByTestId('performance-scroll').props.contentContainerStyle,
  ).paddingHorizontal as number;

  // 360dp is the narrowest phone in the fleet (`ui/facts.tsx` measures the
  // same handset). The ring is fixed in points and the column is a percentage,
  // so the three numbers have to be checked against each other: widen the
  // gutters, or grow the ring, without moving the other and the ring overflows
  // its column and the row silently stops being three wide.
  const column = (360 - gutters * 2) * basis;

  expect(ringWidth(tree)).toBeLessThanOrEqual(column);
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
