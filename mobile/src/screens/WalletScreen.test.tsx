import { fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type {
  DriverLedgerEntry,
  DriverSettlementRequest,
  DriverStats,
} from '../api/endpoints';
import { WalletScreen } from './WalletScreen';

/**
 * That the wallet screen mounts, and shows only what the platform has.
 *
 * `wallet/presentation.test.ts` owns the wording and the arithmetic. This
 * suite exists because that one does not prove the screen renders, and
 * because the refusals below would otherwise live only in a docblock:
 *
 * - **No Withdraw and no Add Money** — ADR-0029 §6, and no endpoint either
 *   could call.
 * - **Not "Available Balance"**, which misnames a figure that is normally
 *   negative, and no minus sign on it — direction goes in words.
 * - **No Tip, Weekly Bonus or Withdrawal rows** — none of the three exists.
 * - **`cash_collected` is shown**, so the statement explains the balance
 *   rather than contradicting it.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

// `mock` prefix required: Jest hoists the factories above these declarations.
const mockUseDriverStats = jest.fn();
const mockUseDriverLedger = jest.fn();
const mockUseSettlementRequests = jest.fn();
const mockCreateSettlement = jest.fn();
const mockFetchNextPage = jest.fn();

jest.mock('../trips/queries', () => ({
  useDriverStats: () => mockUseDriverStats(),
}));

jest.mock('../wallet/queries', () => ({
  useDriverLedger: () => mockUseDriverLedger(),
  useSettlementRequests: () => mockUseSettlementRequests(),
  useCreateSettlementRequest: () => ({
    mutate: mockCreateSettlement,
    isPending: false,
    isError: false,
  }),
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

/** The pair a completed cash trip writes. */
const COMPLETED_TRIP: DriverLedgerEntry[] = [
  entry({ id: 2, amount_minor: 8_000 }),
  entry({
    id: 1,
    kind: 'cash_collected',
    kind_label: 'Cash collected',
    amount_minor: -10_000,
    description: 'Cash taken on trip #412; 2000 of it is commission at 20%',
  }),
];

function settlementRequest(
  overrides: Partial<DriverSettlementRequest> = {},
): DriverSettlementRequest {
  return {
    id: 9,
    driver_id: 3,
    trip_id: null,
    kind: 'remittance',
    kind_label: 'Cash handed to the office',
    status: 'pending',
    status_label: 'Waiting for the office',
    amount_minor: 47_000,
    currency: 'UGX',
    note: 'Paid Musoke at Nakawa depot',
    decline_reason: null,
    reviewed_at: null,
    ledger_entry_id: null,
    created_at: '2026-08-15T10:45:00+03:00',
    ...overrides,
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

const goBack = jest.fn();
const navigate = jest.fn();
// The back arrow crosses to the Home **tab**, so it goes through the parent
// navigator rather than through `goBack()` — which on a tab root is a silent
// no-op. See the test at the end of this file.
const getParentNavigate = jest.fn();

async function renderWallet(
  entries: DriverLedgerEntry[] = COMPLETED_TRIP,
  driverStats: DriverStats | null = stats(),
  extra: {
    hasNextPage?: boolean;
    isLoading?: boolean;
    requests?: DriverSettlementRequest[];
  } = {},
): Promise<ReturnType<typeof render>> {
  mockUseDriverStats.mockReturnValue({ data: driverStats ?? undefined });
  mockUseSettlementRequests.mockReturnValue({ data: extra.requests ?? [] });
  mockUseDriverLedger.mockReturnValue({
    data: { pages: [{ entries, nextCursor: null }] },
    isLoading: extra.isLoading ?? false,
    isRefetching: false,
    isFetchingNextPage: false,
    hasNextPage: extra.hasNextPage ?? false,
    fetchNextPage: mockFetchNextPage,
    refetch: jest.fn(),
  });

  const node: ReactElement = (
    <WalletScreen
      route={{ key: 'w', name: 'WalletHome', params: undefined }}
      navigation={{ goBack, navigate, getParent: () => ({ navigate: getParentNavigate }) } as never}
    />
  );

  return render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);
}

beforeEach(() => {
  goBack.mockClear();
  navigate.mockClear();
  getParentNavigate.mockClear();
  mockFetchNextPage.mockClear();
  mockCreateSettlement.mockClear();
});

// -- The balance card -----------------------------------------------------

/**
 * **The heading carries the direction now**, and this pair of assertions
 * replaces three older ones that between them said: the label must be "Wallet
 * balance" and never "Available Balance"; the figure must be unsigned with the
 * direction in a note beneath; and a sentence must explain why the balance is
 * usually money owed.
 *
 * The owner asked for the mockup's card — *Available Balance / UGX 135,000* —
 * and for the explaining sentence to go. The objection behind those tests was
 * never the words, it was that **"Available" over a figure a driver actually
 * owes is a false claim**, and that direction must live somewhere a driver
 * cannot miss (AGENTS.md § Accessibility: never a sign or a colour alone).
 *
 * Both survive by moving the direction into the *heading*: the mockup exactly
 * when in credit, and the truth when not.
 */
it('says "Available Balance" only when the money is actually available', async () => {
  const credit = await renderWallet(COMPLETED_TRIP, stats({ wallet_balance_minor: 135_000 }));

  expect(credit.getByText('Available Balance')).toBeTruthy();
  expect(credit.getByText('UGX 135,000')).toBeTruthy();
});

it('says the balance is owed when it is owed, in the heading itself', async () => {
  // The ordinary state for cash work (ADR-0029 §5), and the one the mockup
  // does not draw. "Available Balance" here would describe money to spend.
  const { getByText, queryByText } = await renderWallet();

  expect(getByText('Balance you owe')).toBeTruthy();
  expect(queryByText('Available Balance')).toBeNull();

  // Still a magnitude. The first person shown "UGX -4,500" asked whether the
  // minus was a bug, which is why the sign never carries this alone.
  expect(getByText('UGX 4,500')).toBeTruthy();
  expect(queryByText('UGX -4,500')).toBeNull();
});

it('no longer explains the balance in a paragraph, at the owner’s request', async () => {
  const { queryByText } = await renderWallet();

  expect(queryByText(/Cash fares are the office/)).toBeNull();
});

/**
 * **The mockup's two buttons, and the sentence that keeps them honest.**
 *
 * This assertion used to be its opposite — that the buttons must *not* say
 * Withdraw and Add Money (ADR-0032 §1). The owner has asked for the mockup's
 * labels twice; the mechanism behind them is untouched, and the property the
 * old wording protected is now carried by the hint and the sheet.
 */
it('offers the mockup’s two actions, each saying what it really does', async () => {
  const { getByLabelText } = await renderWallet();

  const withdraw = getByLabelText('Withdraw');
  const addMoney = getByLabelText('Add Money');

  expect(withdraw).toBeTruthy();
  expect(addMoney).toBeTruthy();

  // The label is short; the hint is the truth, and a screen reader gets it
  // without opening anything.
  expect(withdraw.props.accessibilityHint).toContain('Nothing is transferred by this app');
  expect(addMoney.props.accessibilityHint).toContain('Nothing is transferred by this app');
});

it('opens a sheet that says nothing is transferred by the app', async () => {
  // A driver who believes tapping a button pays them is a driver who stops
  // trusting the app the first time nothing arrives.
  const { getByLabelText, getByText } = await renderWallet();

  await fireEvent.press(getByLabelText('Withdraw'));

  expect(getByText(/nothing is transferred by this app/)).toBeTruthy();
});

it('disables a kind that already has a request waiting, and says why', async () => {
  // ADR-0032 §4. Disabled rather than hidden: a control that vanishes leaves
  // a driver wondering whether they imagined it.
  const { getByLabelText, getByText } = await renderWallet(COMPLETED_TRIP, stats(), {
    requests: [settlementRequest()],
  });

  expect(getByLabelText('Add Money').props.accessibilityState.disabled).toBe(true);
  expect(getByLabelText('Withdraw').props.accessibilityState.disabled).toBe(false);

  // And the open request is shown, with the sentence that matters most.
  expect(getByText('Cash handed over')).toBeTruthy();
  expect(getByText('Waiting for the office. Your balance has not changed yet.')).toBeTruthy();
});

it('never suggests a pending request has already moved the balance', async () => {
  // The safety property of the whole feature, said on the screen.
  const { getByText } = await renderWallet(COMPLETED_TRIP, stats(), {
    requests: [settlementRequest()],
  });

  expect(getByText('UGX 4,500')).toBeTruthy();
  expect(getByText('Balance you owe')).toBeTruthy();
  expect(getByText(/has not changed yet/)).toBeTruthy();
});

it('opens the full statement from View all', async () => {
  const { getByLabelText } = await renderWallet();

  void fireEvent.press(getByLabelText('View all transactions'));

  expect(navigate).toHaveBeenCalledWith('Transactions');
});

// -- The statement --------------------------------------------------------

it('shows both halves of a completed trip, so the rows explain the balance', async () => {
  // Serving only the credit would make a prettier list that does not sum to
  // the balance above it — and this screen's whole subject is why the balance
  // is what it is.
  const { getByText } = await renderWallet();

  expect(getByText('Ride earnings')).toBeTruthy();
  expect(getByText('+ UGX 8,000')).toBeTruthy();

  expect(getByText('Cash collected')).toBeTruthy();
  expect(getByText('− UGX 10,000')).toBeTruthy();
});

/**
 * **Inverted deliberately**, and the explanation now lives one screen away
 * rather than being lost.
 *
 * The mockup's wallet row is two lines — title and time. The server's
 * explanation is a third, and it is where ADR-0029 §3 freezes the commission
 * rate that applied, so it is not deleted from the app: the wallet shows the
 * last five as a *glance*, and Transactions shows all of them as a *record*,
 * with the description on every row. `StatementRow`'s `compact` prop is that
 * split.
 */
it('leaves the explanation to the Transactions screen, as the mockup does', async () => {
  const { queryByText } = await renderWallet();

  expect(queryByText(/2000 of it is commission at 20%/)).toBeNull();
});

/**
 * The mockup's three remaining rows, and the one line of it this app will not
 * draw whatever a mockup says.
 */
it('draws the tip, bonus and withdrawal rows — and never the passenger’s name', async () => {
  const { getByText, queryByText } = await renderWallet([
    entry({ id: 4, kind: 'tip_earned', kind_label: 'Tip', amount_minor: 1_600 }),
    entry({ id: 3, kind: 'bonus', kind_label: 'Bonus', amount_minor: 20_000, service_type: null }),
    entry({ id: 2, kind: 'settlement', kind_label: 'Settlement', amount_minor: -50_000 }),
  ]);

  expect(getByText('Tip')).toBeTruthy();
  expect(getByText('Bonus')).toBeTruthy();
  // Named by its sign: a negative settlement *is* a withdrawal.
  expect(getByText('Withdrawal')).toBeTruthy();

  // ADR-0024 §7. A wallet statement is permanent and scrollable, and a list of
  // everyone who ever tipped a driver, by name, is the directory that rule
  // exists to prevent. The server sends no name for this to print.
  expect(queryByText('Tip from Sarah N.')).toBeNull();
  expect(queryByText(/Sarah/)).toBeNull();
});

it('never names a passenger on a historical row', async () => {
  // Independent of tips not existing: ADR-0024 §7 releases contact details
  // only while a trip is live, because a completed trip is not a directory.
  // A permanent, scrollable list of names is the opposite of that.
  const { queryByText } = await renderWallet();

  expect(queryByText(/Sarah/)).toBeNull();
});

it('reads a row as one sentence, with direction in words', async () => {
  // A screen reader may or may not announce "+". "to you" and "you are
  // holding" cannot be missed.
  const { getByLabelText } = await renderWallet();

  expect(
    getByLabelText(
      'Ride earnings. UGX 8,000 in your favour. Fare for trip #412 at 20% commission',
    ),
  ).toBeTruthy();
});

it('says a delivery was a delivery', async () => {
  const { getByText } = await renderWallet([entry({ service_type: 'delivery' })]);

  expect(getByText('Delivery earnings')).toBeTruthy();
});

it('falls back to the server’s words for a trip nobody classified', async () => {
  const { getByText } = await renderWallet([entry({ service_type: null })]);

  expect(getByText('Fare earned')).toBeTruthy();
});

// -- Empty and paging -----------------------------------------------------

it('says the statement is empty rather than showing nothing at all', async () => {
  const { getByText } = await renderWallet([]);

  expect(getByText(/Nothing here yet/)).toBeTruthy();
});

it('does not ask for another page when there is not one', async () => {
  const { getByText } = await renderWallet(COMPLETED_TRIP, stats(), { hasNextPage: false });

  void fireEvent(getByText('Ride earnings'), 'layout', {
    nativeEvent: { layout: { width: 300, height: 60 } },
  });

  expect(mockFetchNextPage).not.toHaveBeenCalled();
});

// -- Where back goes ------------------------------------------------------

/**
 * **The arrow survived the move to four tabs, but its destination changed**,
 * and both halves are worth pinning.
 *
 * It used to call `goBack()`, which was right while the wallet was pushed onto
 * the trips stack from a card on Home. The wallet is a **tab root** now, and
 * `goBack()` on a stack root is a *silent no-op* — the control would look
 * live, be tapped, and do nothing.
 *
 * Dropping the arrow was the first answer and it was wrong: the mockup draws
 * the arrow and the tab bar together, and a driver who opened this from the
 * Home screen's balance card expects the way out to work. So it stays, and
 * navigates to the Home tab explicitly.
 */
it('has a back arrow, and it goes somewhere rather than no-opping', async () => {
  const { getByLabelText } = await renderWallet();

  void fireEvent.press(getByLabelText('Back'));

  expect(getParentNavigate).toHaveBeenCalledWith('Home');
  // Never `goBack()` from a tab root — it is silent, and silence on a control
  // a driver has just pressed reads as the app having frozen.
  expect(goBack).not.toHaveBeenCalled();
});
