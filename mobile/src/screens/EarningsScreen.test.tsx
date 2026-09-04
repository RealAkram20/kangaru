import { fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { DriverEarnings } from '../api/endpoints';
import { EarningsScreen } from './EarningsScreen';

/**
 * That the earnings screen mounts, and shows only what the platform has.
 *
 * `earnings/presentation.test.ts` owns the arithmetic and the wording. This
 * suite exists because that one does not prove the screen renders, and because
 * the refusals below would otherwise live only in a docblock:
 *
 * - **No Tips row and no Bonuses row**, in any period. Neither exists.
 * - **No `UGX 0`** anywhere — the specific thing screen-rules §1 forbids.
 * - **"Time on trips", never "Online hours"** — the platform keeps no duty
 *   history and must not imply it does.
 * - **The unclassifiable row is shown**, so the breakdown adds up.
 * - **The heading follows the tab**, so a month is never called "today".
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

// `mock` prefix required: Jest hoists the factory above this line.
const mockUseDriverEarnings = jest.fn();

jest.mock('../earnings/queries', () => ({
  useDriverEarnings: (period: string) => mockUseDriverEarnings(period),
}));

function earnings(overrides: Partial<DriverEarnings> = {}): DriverEarnings {
  return {
    period: 'day',
    timezone: 'Africa/Kampala',
    from: '2026-08-15T00:00:00+03:00',
    to: '2026-08-16T00:00:00+03:00',
    currency: 'UGX',
    total_minor: 85_000,
    trips: 10,
    on_trip_minutes: 440,
    breakdown: [
      { service_type: 'ride', trips: 6, earned_minor: 60_000 },
      { service_type: 'delivery', trips: 3, earned_minor: 18_000 },
      { service_type: 'other', trips: 1, earned_minor: 7_000 },
    ],
    trend: Array.from({ length: 24 }, (_, hour) => ({
      bucket: `2026-08-15 ${String(hour).padStart(2, '0')}:00`,
      earned_minor: hour === 18 ? 40_000 : 0,
    })),
    ...overrides,
  };
}

const goBack = jest.fn();

async function renderEarnings(
  data: DriverEarnings | null = earnings(),
  isLoading = false,
): Promise<ReturnType<typeof render>> {
  mockUseDriverEarnings.mockReturnValue({ data: data ?? undefined, isLoading });

  const node: ReactElement = (
    <EarningsScreen
      route={{ key: 'e', name: 'EarningsHome', params: undefined }}
      navigation={{ goBack, navigate: jest.fn(), getParent: () => ({ navigate: jest.fn() }) } as never}
    />
  );

  return render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);
}

beforeEach(() => {
  goBack.mockClear();
  mockUseDriverEarnings.mockClear();
});

// -- The figures ----------------------------------------------------------

it('shows the total and the breakdown that adds up to it', async () => {
  const { getByText } = await renderEarnings();

  expect(getByText("Today's earnings")).toBeTruthy();
  expect(getByText('UGX 85,000')).toBeTruthy();

  expect(getByText('Rides')).toBeTruthy();
  expect(getByText('UGX 60,000')).toBeTruthy();
  expect(getByText('Deliveries')).toBeTruthy();
  expect(getByText('UGX 18,000')).toBeTruthy();

  // 60,000 + 18,000 + 7,000 = 85,000. Without this row the rows would show
  // 78,000 under a total of 85,000 and nothing would say why.
  expect(getByText('Other work')).toBeTruthy();
  expect(getByText('UGX 7,000')).toBeTruthy();
});

it('shows time on trips, and never calls it online hours', async () => {
  const { getByText, queryByText } = await renderEarnings();

  expect(getByText('Time on trips')).toBeTruthy();
  expect(getByText('7h 20m')).toBeTruthy();

  // The mockup's label. `driver_presence` is overwritten on every duty
  // toggle, so online time was never recorded and cannot be shown.
  expect(queryByText('Online hours')).toBeNull();
  // The footnote under this row was cut; the label is the whole point and
  // it must keep saying "on trips" rather than the mockup's "online".
  expect(getByText('Time on trips')).toBeTruthy();
});

it('has no tips row and no bonuses row, because neither exists', async () => {
  const { queryByText } = await renderEarnings();

  expect(queryByText('Tips')).toBeNull();
  expect(queryByText('Bonuses')).toBeNull();
});

it('states a known zero plainly, and says why there is nothing under it', async () => {
  // The distinction `docs/screen-rules.md` §1 actually draws. The banned zero
  // is one standing in for a figure the platform does not have — "UGX 0 reads
  // as a free ride". This zero is *known*: the day loaded and no work was
  // completed in it, so the driver earned exactly nothing, and the sentence
  // beneath says so. An em dash here would claim not to know.
  //
  // What stays banned is the mockup's `UGX 0` against Bonuses, which stood
  // for a feature that does not exist — see the tips/bonuses test above.
  const { getByText } = await renderEarnings(
    earnings({
      total_minor: 0,
      trips: 0,
      on_trip_minutes: null,
      breakdown: [],
      trend: Array.from({ length: 24 }, (_, hour) => ({
        bucket: `2026-08-15 ${String(hour).padStart(2, '0')}:00`,
        earned_minor: 0,
      })),
    }),
  );

  expect(getByText('UGX 0')).toBeTruthy();
  expect(getByText(/No completed work in this period/)).toBeTruthy();
  // And here the em dash *is* right: null means no trip carried both
  // timestamps, which is not the same as having driven for no time.
  expect(getByText('—')).toBeTruthy();
});

// -- The tabs -------------------------------------------------------------

it('renames the total when the tab changes, so a month is never called today', async () => {
  const { getByLabelText, getByText } = await renderEarnings();

  expect(getByText("Today's earnings")).toBeTruthy();

  mockUseDriverEarnings.mockReturnValue({
    data: earnings({ period: 'month', total_minor: 1_240_000 }),
    isLoading: false,
  });

  await fireEvent.press(getByLabelText('Month'));

  expect(getByText('This month')).toBeTruthy();
  expect(getByText('UGX 1,240,000')).toBeTruthy();
});

it('asks the server for the period the driver picked', async () => {
  const { getByLabelText } = await renderEarnings();

  await fireEvent.press(getByLabelText('Week'));

  expect(mockUseDriverEarnings).toHaveBeenCalledWith('week');
});

it('marks the selected tab by state, not by colour alone', async () => {
  const { getByLabelText } = await renderEarnings();

  expect(getByLabelText('Day').props.accessibilityState.selected).toBe(true);
  expect(getByLabelText('Week').props.accessibilityState.selected).toBe(false);
});

// -- The chart ------------------------------------------------------------

it('reads the trend as one sentence rather than 24 loose numbers', async () => {
  // A screen reader walking bar by bar gets a list of numbers with no shape,
  // which is worse than naming the busiest slot — and the shape is why a
  // chart is here at all.
  const { getByLabelText } = await renderEarnings();

  // "6 PM", not "2026-08-15 18:00". Rendering the screen caught the raw
  // bucket key being read aloud — a database identifier spoken to the one
  // person who cannot see the chart it indexes.
  expect(
    getByLabelText('Earnings trend across 24 hours. Busiest was 6 PM, at UGX 40,000.'),
  ).toBeTruthy();
});

it('labels the axis at midnight, six, noon and six', async () => {
  const { getByText } = await renderEarnings();

  expect(getByText('12 AM')).toBeTruthy();
  expect(getByText('6 AM')).toBeTruthy();
  expect(getByText('12 PM')).toBeTruthy();
  expect(getByText('6 PM')).toBeTruthy();
});

// -- The reconciliation guard ---------------------------------------------

it('says so rather than drawing a breakdown that does not add up', async () => {
  const { getByText } = await renderEarnings(
    earnings({ breakdown: [{ service_type: 'ride', trips: 6, earned_minor: 60_000 }] }),
  );

  expect(getByText(/These figures may be wrong/)).toBeTruthy();
});

it('draws no warning when the figures reconcile', async () => {
  const { queryByText } = await renderEarnings();

  expect(queryByText(/do not add up/)).toBeNull();
});

// -- Loading --------------------------------------------------------------

it('shows em dashes rather than zeros while the figures are unknown', async () => {
  // Nothing has loaded, so nothing is known — and this is exactly the case
  // screen-rules §1 is about. `UGX 0` here would tell a driver they had
  // earned nothing today when the truth is that the app has not asked yet.
  const { getAllByText, queryByText } = await renderEarnings(null, true);

  // Both the total and the time-on-trips row.
  expect(getAllByText('—').length).toBeGreaterThanOrEqual(2);
  expect(queryByText('UGX 0')).toBeNull();
});
