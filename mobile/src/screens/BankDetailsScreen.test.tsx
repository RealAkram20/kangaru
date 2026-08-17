import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { DriverPayoutAccount } from '../api/endpoints';
import { BankDetailsScreen } from './BankDetailsScreen';

/**
 * Where the office sends this driver's money (ADR-0042).
 *
 * The screen's job is narrow and the refusals are most of it:
 *
 * - It must not look like it pays anybody. ADR-0029 §6's boundary is that the
 *   platform records money moving rather than making it move, and a form about
 *   pay that leaves that ambiguous makes a promise nobody made.
 * - The form starts **blank**, never prefilled with the mask. An editable field
 *   showing `•••• 4567` invites somebody to correct four characters into a
 *   nonsense account.
 * - The labels follow the kind, because a mobile-money "account number" is a
 *   phone number and asking for the wrong one gets a wrong answer typed
 *   confidently.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

const mockUsePayoutAccount = jest.fn();
const mockSave = jest.fn();
const mockRemove = jest.fn();

jest.mock('../wallet/payoutQueries', () => ({
  usePayoutAccount: () => mockUsePayoutAccount(),
  useSavePayoutAccount: () => ({ mutateAsync: mockSave, isPending: false }),
  useDeletePayoutAccount: () => ({ mutateAsync: mockRemove, isPending: false }),
}));

function account(overrides: Partial<DriverPayoutAccount> = {}): DriverPayoutAccount {
  return {
    kind: 'bank',
    kind_label: 'Bank account',
    institution_label: 'Bank',
    number_label: 'Account number',
    institution: 'Stanbic',
    account_holder_masked: 'J. Kamau',
    account_number_masked: '•••• 4567',
    last_four: '4567',
    updated_at: '2026-08-17T20:00:00+03:00',
    ...overrides,
  };
}

const navigation = { goBack: jest.fn(), navigate: jest.fn() } as never;

async function renderScreen(element: ReactElement) {
  return render(<SafeAreaProvider initialMetrics={METRICS}>{element}</SafeAreaProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUsePayoutAccount.mockReturnValue({ data: null, isLoading: false });
});

it('says the office pays, so the screen cannot read as a payment request', async () => {
  const screen = await renderScreen(
    <BankDetailsScreen navigation={navigation} route={{} as never} />,
  );

  // ADR-0029 §6 and ADR-0032. The most important sentence on the screen.
  expect(screen.getByText(/does not request a payment/)).toBeTruthy();
});

it('prompts a driver who has given no details', async () => {
  const screen = await renderScreen(
    <BankDetailsScreen navigation={navigation} route={{} as never} />,
  );

  expect(screen.getByText('The office has no details for you')).toBeTruthy();
  expect(screen.getByLabelText('Add payout details')).toBeTruthy();
});

it('shows the masked account, and says why it is short', async () => {
  mockUsePayoutAccount.mockReturnValue({ data: account(), isLoading: false });

  const screen = await renderScreen(
    <BankDetailsScreen navigation={navigation} route={{} as never} />,
  );

  expect(screen.getByText('•••• 4567')).toBeTruthy();
  expect(screen.getByText('J. Kamau')).toBeTruthy();
  // A mask with no explanation reads as a bug, and a driver would reasonably
  // wonder whether the office holds a truncated number.
  expect(screen.getByText(/The office has the full number/)).toBeTruthy();
});

it('opens a blank form rather than prefilling the mask', async () => {
  mockUsePayoutAccount.mockReturnValue({ data: account(), isLoading: false });

  const screen = await renderScreen(
    <BankDetailsScreen navigation={navigation} route={{} as never} />,
  );

  await fireEvent.press(screen.getByLabelText('Replace'));

  // **The guard this screen turns on.** Prefilling `•••• 4567` into an
  // editable field invites correcting four characters into an account number
  // that belongs to nobody.
  const field = await screen.findByLabelText('Account number');

  expect(field.props.value).toBe('');
  expect(screen.getByLabelText('Bank').props.value).toBe('');
});

it('keeps the kind when replacing, so a mobile-money driver is not switched to a bank form', async () => {
  mockUsePayoutAccount.mockReturnValue({
    data: account({ kind: 'mobile_money', institution: 'MTN MoMo' }),
    isLoading: false,
  });

  const screen = await renderScreen(
    <BankDetailsScreen navigation={navigation} route={{} as never} />,
  );

  await fireEvent.press(screen.getByLabelText('Replace'));

  // The labels prove the kind carried over: a mobile-money number is a phone
  // number, and asking for an "account number" is how a wrong answer gets
  // typed confidently.
  expect(await screen.findByLabelText('Mobile money number')).toBeTruthy();
  expect(screen.getByLabelText('Provider')).toBeTruthy();
});

it('sends all four fields together', async () => {
  const screen = await renderScreen(
    <BankDetailsScreen navigation={navigation} route={{} as never} />,
  );

  await fireEvent.press(screen.getByLabelText('Add payout details'));

  await fireEvent.changeText(await screen.findByLabelText('Bank'), 'Stanbic');
  await fireEvent.changeText(screen.getByLabelText('Name on the account'), 'John Kamau');
  await fireEvent.changeText(screen.getByLabelText('Account number'), '9030001234567');

  await waitFor(() =>
    expect(screen.getByLabelText('Account number').props.value).toBe('9030001234567'),
  );

  await fireEvent.press(screen.getByLabelText('Save'));

  await waitFor(() =>
    // The whole object, not a partial. A destination is one fact made of four
    // parts, and half of one points somewhere wrong.
    expect(mockSave).toHaveBeenCalledWith({
      kind: 'bank',
      institution: 'Stanbic',
      account_holder: 'John Kamau',
      account_number: '9030001234567',
    }),
  );
});

it('refuses a gap rather than sending half a destination', async () => {
  const screen = await renderScreen(
    <BankDetailsScreen navigation={navigation} route={{} as never} />,
  );

  await fireEvent.press(screen.getByLabelText('Add payout details'));
  await fireEvent.changeText(await screen.findByLabelText('Bank'), 'Stanbic');
  await fireEvent.press(screen.getByLabelText('Save'));

  await waitFor(() => expect(screen.getByText(/cannot be paid into/)).toBeTruthy());

  expect(mockSave).not.toHaveBeenCalled();
});

it('says the save did not land, rather than pretending it did', async () => {
  mockSave.mockRejectedValueOnce(new Error('offline'));

  const screen = await renderScreen(
    <BankDetailsScreen navigation={navigation} route={{} as never} />,
  );

  await fireEvent.press(screen.getByLabelText('Add payout details'));
  await fireEvent.changeText(await screen.findByLabelText('Bank'), 'Stanbic');
  await fireEvent.changeText(screen.getByLabelText('Name on the account'), 'John Kamau');
  await fireEvent.changeText(screen.getByLabelText('Account number'), '9030001234567');

  await waitFor(() =>
    expect(screen.getByLabelText('Account number').props.value).toBe('9030001234567'),
  );

  await fireEvent.press(screen.getByLabelText('Save'));

  // These details are outside the offline outbox, so a driver must not be left
  // believing they are queued.
  await waitFor(() => expect(screen.getByText(/not queued/)).toBeTruthy());
});
