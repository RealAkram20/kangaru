import { fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SettingsScreen } from './SettingsScreen';

/**
 * The account's own controls.
 *
 * **Four of these assertions moved here from `ProfileScreen.test.tsx`** when
 * that screen shed its menu (the owner's *"we don't need to repeat the
 * menus"*). They were not rewritten — the properties they pin are unchanged
 * and were worth keeping: a parked update that cannot be found is ADR-0023 §6
 * broken, and "Bank details" is a rail this platform does not have.
 *
 * Their original wording is recorded in a comment in that file, so the
 * reasoning survives the move.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

// `mock` prefix required: Jest hoists the factory above this line.
const mockUseSync = jest.fn();
const mockSignOut = jest.fn();

jest.mock('../offline/SyncProvider', () => ({
  useSync: () => mockUseSync(),
}));

jest.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ signOut: mockSignOut }),
}));

const navigate = jest.fn();
const goBack = jest.fn();
const parentNavigate = jest.fn();

const navigation = {
  navigate,
  goBack,
  getParent: () => ({ navigate: parentNavigate }),
} as never;

async function renderSettings(): Promise<ReturnType<typeof render>> {
  const node: ReactElement = (
    <SettingsScreen route={{ key: 's', name: 'Settings', params: undefined }} navigation={navigation} />
  );

  return render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);
}

beforeEach(() => {
  navigate.mockClear();
  goBack.mockClear();
  parentNavigate.mockClear();
  mockSignOut.mockClear();
  mockUseSync.mockReturnValue({ parked: [], pending: 0 });
});

// -- The rows that moved here ---------------------------------------------

it('gives time off a way in, which the four-tab bar had left unreachable', async () => {
  const screen = await renderSettings();

  await fireEvent.press(screen.getByText('Time off'));

  expect(navigate).toHaveBeenCalledWith('TimeOff');
});

it('never offers bank details, which nothing on this platform can do', async () => {
  const screen = await renderSettings();

  expect(screen.queryByText(/Bank/i)).toBeNull();
  // The honest neighbour: settling up is a request the office answers
  // (ADR-0032), and it lives on the Wallet tab.
  expect(screen.getByText('Settling up')).toBeTruthy();
});

it('sends settling up to the wallet rather than implying a rail', async () => {
  const screen = await renderSettings();

  await fireEvent.press(screen.getByText('Settling up'));

  expect(parentNavigate).toHaveBeenCalledWith('Wallet');
});

it('keeps the parked queue reachable, and says when nothing is stuck', async () => {
  const screen = await renderSettings();

  expect(screen.getByText('Updates & sync')).toBeTruthy();
  expect(screen.getByText('Nothing stuck')).toBeTruthy();
});

it('counts what is stuck, so a refused update cannot be missed', async () => {
  // ADR-0023 §6. A driver whose closing odometer was refused has to be able to
  // read the number back to the office, which means the row has to shout.
  mockUseSync.mockReturnValue({ parked: [{ id: 'a' }, { id: 'b' }], pending: 2 });

  const screen = await renderSettings();

  expect(screen.getByText('2 need you')).toBeTruthy();
});

// -- What is deliberately absent ------------------------------------------

it('offers no push-notification switch, which would silently stop work arriving', async () => {
  const screen = await renderSettings();

  // The only push this platform sends is a job offer with a fifteen-second
  // clock. A driver who switched it off would stop being offered work while
  // still looking available to dispatch — the OS permission is the honest
  // control, because turning it off there says what it costs.
  expect(screen.queryByText(/push/i)).toBeNull();
  expect(screen.queryByText(/notification/i)).toBeNull();
});

it('offers no language or theme picker, because neither exists', async () => {
  const screen = await renderSettings();

  expect(screen.queryByText(/language/i)).toBeNull();
  expect(screen.queryByText(/theme|dark mode/i)).toBeNull();
});

// -- Signing out ----------------------------------------------------------

it('confirms before signing out rather than doing it on one tap', async () => {
  const screen = await renderSettings();

  await fireEvent.press(screen.getByText('Log out'));

  // The dialog is the confirmation; nothing is signed out until it is
  // answered. A one-tap log out in a menu is a mis-tap that ends a shift.
  expect(mockSignOut).not.toHaveBeenCalled();
});

it('shows the version, read from the manifest rather than typed', async () => {
  const screen = await renderSettings();

  // The mockup's "v2.3.0" was somebody's placeholder. This is the number a
  // driver reads out when they ring the office about a bug.
  expect(screen.getByText('KangaruRide v1.0.0')).toBeTruthy();
});
