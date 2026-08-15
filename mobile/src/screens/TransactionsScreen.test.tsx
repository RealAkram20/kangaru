import { fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { DriverLedgerEntry, LedgerRange } from '../api/endpoints';
import { TransactionsScreen } from './TransactionsScreen';

/**
 * The statement, filtered by date — where the wallet's *View all* goes.
 *
 * The cases that matter are about the filter reaching the *server*: the
 * ledger is paginated, so a client-side filter can only search what happens
 * to be in memory, and a driver picking a date on a page that starts later
 * would be told there was nothing — the most confident possible way to be
 * wrong about somebody's money.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

// `mock` prefix required: Jest hoists the factory above this line.
const mockUseDriverLedger = jest.fn();

jest.mock('../wallet/queries', () => ({
  useDriverLedger: (range: LedgerRange) => mockUseDriverLedger(range),
}));

function entry(overrides: Partial<DriverLedgerEntry> = {}): DriverLedgerEntry {
  return {
    id: 1,
    kind: 'fare_earned',
    kind_label: 'Fare earned',
    amount_minor: 8_000,
    currency: 'UGX',
    description: 'Fare for trip #412 at 20% commission',
    trip_id: 412,
    service_type: 'ride',
    created_at: '2026-08-15T10:45:00+03:00',
    ...overrides,
  };
}

const goBack = jest.fn();

async function renderTransactions(
  entries: DriverLedgerEntry[] = [entry()],
): Promise<ReturnType<typeof render>> {
  mockUseDriverLedger.mockReturnValue({
    data: { pages: [{ entries, nextCursor: null }] },
    isLoading: false,
    isRefetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: jest.fn(),
    refetch: jest.fn(),
  });

  const node: ReactElement = (
    <TransactionsScreen
      route={{ key: 't', name: 'Transactions', params: undefined }}
      navigation={{ goBack, navigate: jest.fn() } as never}
    />
  );

  return render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);
}

beforeEach(() => {
  goBack.mockClear();
  mockUseDriverLedger.mockClear();
  jest.useFakeTimers();
  // Saturday 15 August 2026, so "this week" began Monday the 10th.
  jest.setSystemTime(new Date(2026, 7, 15, 20, 0, 0));
});

afterEach(() => {
  jest.useRealTimers();
});

// -- The filters ----------------------------------------------------------

it('offers Today, This week and Custom', async () => {
  const { getByLabelText } = await renderTransactions();

  expect(getByLabelText('Today')).toBeTruthy();
  expect(getByLabelText('This week')).toBeTruthy();
  expect(getByLabelText('Custom')).toBeTruthy();
});

it('asks the server for today, at both ends of the day', async () => {
  // `to` is inclusive on the server, so a single day returns that day rather
  // than nothing — the first thing anybody tries.
  await renderTransactions();

  expect(mockUseDriverLedger).toHaveBeenCalledWith({ from: '2026-08-15', to: '2026-08-15' });
});

it('asks the server for the week when the week is picked', async () => {
  const { getByLabelText } = await renderTransactions();

  await fireEvent.press(getByLabelText('This week'));

  expect(mockUseDriverLedger).toHaveBeenLastCalledWith({ from: '2026-08-10', to: '2026-08-15' });
});

it('marks the selected filter by state, not by colour alone', async () => {
  const { getByLabelText } = await renderTransactions();

  expect(getByLabelText('Today').props.accessibilityState.selected).toBe(true);
  expect(getByLabelText('Custom').props.accessibilityState.selected).toBe(false);
});

// -- The custom range -----------------------------------------------------

it('shows two date buttons only when Custom is picked', async () => {
  const { getByLabelText, queryByLabelText } = await renderTransactions();

  expect(queryByLabelText(/^From,/)).toBeNull();

  await fireEvent.press(getByLabelText('Custom'));

  expect(getByLabelText('From, Pick a date')).toBeTruthy();
  expect(getByLabelText('To, Pick a date')).toBeTruthy();
});

it('sends no window until a custom date is picked', async () => {
  // Rather than guessing a range the driver has not chosen.
  const { getByLabelText } = await renderTransactions();

  await fireEvent.press(getByLabelText('Custom'));

  expect(mockUseDriverLedger).toHaveBeenLastCalledWith({});
});

it('names the selected date in the button, for a screen reader too', async () => {
  const { getByLabelText, getByTestId } = await renderTransactions();

  await fireEvent.press(getByLabelText('Custom'));
  await fireEvent.press(getByLabelText('From, Pick a date'));

  // The platform's own calendar; all this screen owns is what it does with
  // the answer.
  const picker = getByTestId('range-picker');

  await fireEvent(picker, 'change', { type: 'set' }, new Date(2026, 7, 9));

  expect(getByLabelText('From, 9 Aug 2026')).toBeTruthy();
  expect(mockUseDriverLedger).toHaveBeenLastCalledWith({ from: '2026-08-09', to: '2026-08-09' });
});

it('keeps the old date when the driver cancels the picker', async () => {
  // Android hands the value back unchanged on dismiss; treating that as a
  // pick would silently set a date the driver rejected.
  const { getByLabelText, getByTestId } = await renderTransactions();

  await fireEvent.press(getByLabelText('Custom'));
  await fireEvent.press(getByLabelText('From, Pick a date'));

  const picker = getByTestId('range-picker');

  await fireEvent(picker, 'change', { type: 'dismissed' }, new Date(2026, 7, 9));

  expect(getByLabelText('From, Pick a date')).toBeTruthy();
});

// -- The list -------------------------------------------------------------

it('lists the movements it was given', async () => {
  const { getByText } = await renderTransactions();

  expect(getByText('Ride earnings')).toBeTruthy();
  expect(getByText('+ UGX 8,000')).toBeTruthy();
});

it('says which filter found nothing, rather than just being blank', async () => {
  const { getByText } = await renderTransactions([]);

  expect(getByText('Nothing today yet.')).toBeTruthy();
});

it('goes back to the wallet', async () => {
  const { getByLabelText } = await renderTransactions();

  void fireEvent.press(getByLabelText('Back'));

  expect(goBack).toHaveBeenCalled();
});
