import { act, fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { DriverClosureRequest } from '../api/endpoints';
import { ApiError } from '../api/errors';
import { CloseAccountScreen } from './CloseAccountScreen';

/**
 * Asking the office to close the account (ADR-0043).
 *
 * `profile/closure.test.ts` owns the wording of the states. This suite exists
 * for the three things that one cannot prove:
 *
 * 1. **The screen does not claim to delete anything.** A hard delete is not
 *    available to this platform at any price — invoices stay reproducible — and
 *    a button that said otherwise would be a lie a driver only discovers when
 *    it matters.
 * 2. **Nothing is sent on one tap.** §1: the office confirms, and none of the
 *    reasons to look first (money owed, cash held, a passenger in the car) is
 *    knowable from the button.
 * 3. **A pending request can be taken back.** ADR-0032 left withdrawal out and
 *    recorded that its absence was more annoying than it looked.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

// `mock` prefix required: Jest hoists the factory above these declarations.
const mockUseClosureRequest = jest.fn();
const mockRequestClosure = jest.fn();
const mockWithdraw = jest.fn();

jest.mock('../profile/closureQueries', () => ({
  useClosureRequest: () => mockUseClosureRequest(),
  useRequestClosure: () => ({ mutateAsync: mockRequestClosure, isPending: false }),
  useWithdrawClosureRequest: () => ({ mutateAsync: mockWithdraw, isPending: false }),
}));

function request(overrides: Partial<DriverClosureRequest> = {}): DriverClosureRequest {
  return {
    id: 3,
    status: 'pending',
    status_label: 'Waiting for the office',
    reason: null,
    decline_reason: null,
    requested_at: '2026-08-15T09:00:00+00:00',
    reviewed_at: null,
    closed_at: null,
    ...overrides,
  };
}

const goBack = jest.fn();
const navigation = { goBack } as never;

async function renderScreen(): Promise<ReturnType<typeof render>> {
  const node: ReactElement = (
    <CloseAccountScreen
      route={{ key: 'c', name: 'CloseAccount', params: undefined }}
      navigation={navigation}
    />
  );

  return render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);
}

/**
 * Press the destructive button in the confirmation dialog.
 *
 * `Alert.alert` is native and does nothing under Jest, so the buttons it was
 * handed are read off the spy and invoked. Without this the tests below would
 * be asserting that a dialog opened, which is not the same as asserting that
 * answering it sends anything.
 *
 * Inside `act`, because the handler sets state after an await: without it every
 * case here passes while printing a "not wrapped in act(...)" warning, and a
 * suite that prints warnings on a green run is one nobody reads warnings from.
 */
async function answerAlert(label: string) {
  const spy = Alert.alert as unknown as jest.Mock;
  const buttons = spy.mock.calls[spy.mock.calls.length - 1]?.[2] as
    | { text: string; onPress?: () => void }[]
    | undefined;

  await act(async () => {
    buttons?.find((button) => button.text === label)?.onPress?.();

    // Lets the mutation's promise settle inside the same `act`, so the state
    // it sets on resolution is flushed here rather than after the assertion.
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockUseClosureRequest.mockReturnValue({ data: null, isLoading: false });
  mockRequestClosure.mockResolvedValue(request());
  mockWithdraw.mockResolvedValue(request({ status: 'withdrawn' }));
});

// -- The honesty of it ----------------------------------------------------

/**
 * The claim the whole screen turns on. Mutation check — reword the lead into
 * "your account and all your data will be deleted" and this fails.
 *
 * `master-plan.md` §6 stakes the product on reproducible invoices and an
 * append-only ledger; a driver with completed trips behind them cannot be
 * erased without silently rewriting finished invoices' subjects.
 */
it('says plainly that closing is not erasing, before any control', async () => {
  const screen = await renderScreen();

  expect(screen.getByText('Closing your account is not the same as erasing it.')).toBeTruthy();
  expect(screen.getByText(/trips, earnings and invoices stay with the office/i)).toBeTruthy();
});

/**
 * `docs/screen-rules.md` §6 — meaning must not be carried by colour alone. A
 * driver misreading which consequence is which costs them more here than on
 * any other screen in the app.
 */
it('labels every consequence in words, not only in colour', async () => {
  const screen = await renderScreen();

  expect(screen.getAllByText('Kept').length).toBeGreaterThan(0);
  expect(screen.getByText('Lost')).toBeTruthy();
});

it('asks the office rather than claiming to act', async () => {
  const screen = await renderScreen();

  // Not "Delete my account". The button's tense is the screen's whole
  // argument: the office confirms, and the driver keeps working until it does.
  expect(screen.getByText('Ask the office to close my account')).toBeTruthy();
});

// -- Sending -------------------------------------------------------------

it('sends nothing on one tap', async () => {
  const screen = await renderScreen();

  await fireEvent.press(screen.getByText('Ask the office to close my account'));

  expect(Alert.alert).toHaveBeenCalled();
  expect(mockRequestClosure).not.toHaveBeenCalled();
});

it('sends once the dialog is answered', async () => {
  const screen = await renderScreen();

  await fireEvent.press(screen.getByText('Ask the office to close my account'));
  await answerAlert('Send request');

  expect(mockRequestClosure).toHaveBeenCalled();
});

/**
 * The reason is optional, and an untouched box must not be stored as one.
 * Mutation check — send the raw string and this fails on the empty case.
 */
it('carries the reason when there is one, and nothing when there is not', async () => {
  const screen = await renderScreen();

  await fireEvent.press(screen.getByText('Ask the office to close my account'));
  await answerAlert('Send request');

  expect(mockRequestClosure).toHaveBeenCalledWith('');

  await fireEvent.changeText(screen.getByLabelText('Why are you leaving?'), 'Moving to Jinja.');
  await fireEvent.press(screen.getByText('Ask the office to close my account'));
  await answerAlert('Send request');

  expect(mockRequestClosure).toHaveBeenLastCalledWith('Moving to Jinja.');
});

it('names the connection when the request does not reach the office', async () => {
  mockRequestClosure.mockRejectedValue(new Error('socket closed'));

  const screen = await renderScreen();

  await fireEvent.press(screen.getByText('Ask the office to close my account'));
  await answerAlert('Send request');

  expect(await screen.findByText(/needs a connection/i)).toBeTruthy();
});

/**
 * Branching on `code`, never on the sentence — AGENTS.md's rule and the reason
 * `ErrorCode` exists. The race: the office answered between this screen loading
 * and the driver tapping.
 */
it('explains the 409 rather than repeating the server s sentence', async () => {
  mockRequestClosure.mockRejectedValue(
    new ApiError({
      code: 'CLOSURE_REQUEST_ALREADY_OPEN',
      message: 'A closure request is already open for this driver.',
      status: 409,
    }),
  );

  const screen = await renderScreen();

  await fireEvent.press(screen.getByText('Ask the office to close my account'));
  await answerAlert('Send request');

  expect(await screen.findByText(/already have a request waiting/i)).toBeTruthy();
});

// -- Waiting, and changing your mind --------------------------------------

it('shows what is waiting, when it was asked, and where the answer comes', async () => {
  mockUseClosureRequest.mockReturnValue({ data: request(), isLoading: false });

  const screen = await renderScreen();

  expect(screen.getByText('Waiting for the office')).toBeTruthy();
  expect(screen.getByText(/Asked on 15 Aug 2026/)).toBeTruthy();
  // §4: a confirmed closure detaches the sign-in, so the answer cannot arrive
  // anywhere but an inbox. A driver not told that will watch the app.
  expect(screen.getByText(/by email/i)).toBeTruthy();
});

it('offers no second request while one is waiting', async () => {
  mockUseClosureRequest.mockReturnValue({ data: request(), isLoading: false });

  const screen = await renderScreen();

  expect(screen.queryByText('Ask the office to close my account')).toBeNull();
});

it('lets a driver take their request back', async () => {
  mockUseClosureRequest.mockReturnValue({ data: request(), isLoading: false });

  const screen = await renderScreen();

  await fireEvent.press(screen.getByText('Take my request back'));

  expect(mockWithdraw).toHaveBeenCalled();
});

/**
 * The other race, from the other side: the office confirmed or declined while
 * the driver was deciding to withdraw.
 */
it('explains a withdrawal the office got to first', async () => {
  mockUseClosureRequest.mockReturnValue({ data: request(), isLoading: false });
  mockWithdraw.mockRejectedValue(
    new ApiError({
      code: 'CLOSURE_REQUEST_ALREADY_DECIDED',
      message: 'This request has already been decided.',
      status: 409,
    }),
  );

  const screen = await renderScreen();

  await fireEvent.press(screen.getByText('Take my request back'));

  expect(await screen.findByText(/already answered/i)).toBeTruthy();
});

// -- Refused, and closed --------------------------------------------------

it('shows the office s reason for refusing, and lets the driver ask again', async () => {
  mockUseClosureRequest.mockReturnValue({
    data: request({ status: 'declined', decline_reason: 'Settle your balance first.' }),
    isLoading: false,
  });

  const screen = await renderScreen();

  expect(screen.getByText(/Settle your balance first./)).toBeTruthy();
  // Refused is not closed. A driver left with an explanation and no way
  // forward is the dead end this branch exists to prevent.
  expect(screen.getByText('Ask the office to close my account')).toBeTruthy();
});

it('does not offer to close an account that is already closed', async () => {
  mockUseClosureRequest.mockReturnValue({
    data: request({ status: 'confirmed', closed_at: '2026-08-16T09:00:00+00:00' }),
    isLoading: false,
  });

  const screen = await renderScreen();

  expect(screen.queryByText('Ask the office to close my account')).toBeNull();
  expect(screen.getByText(/start a new application/i)).toBeTruthy();
});
