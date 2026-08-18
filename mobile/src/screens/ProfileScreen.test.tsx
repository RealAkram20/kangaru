import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { DriverClosureRequest, DriverProfile, DriverStats } from '../api/endpoints';
import { ProfileScreen } from './ProfileScreen';

/**
 * That the profile screen mounts, and shows only what the platform holds.
 *
 * `profile/presentation.test.ts` owns the wording. This suite exists because
 * that one does not prove the screen renders, and because the refusals below
 * would otherwise live only in a docblock:
 *
 * - **No bare rating.** ADR-0030 §3 withholds a score below five ratings, and
 *   this screen must not reintroduce one.
 * - **The parked queue is still reachable**, which ADR-0023 §6 requires and
 *   which a menu-shaped redesign is exactly how you lose.
 * - **No push, language or theme control**, because none of the three exists.
 *
 * Two entries that used to be on that list are gone, and both were reversed by
 * something being *built* rather than by a change of mind. The photograph is
 * real now (ADR-0041 endpoints, wired here), and "Bank Details" goes somewhere
 * (ADR-0042). The refusals were right while the backends were absent.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

// `mock` prefix required: Jest hoists the factories above these declarations.
const mockUseDriverProfile = jest.fn();
const mockUseDriverStats = jest.fn();
const mockUseSync = jest.fn();
const mockUpdateProfile = jest.fn();
const mockUploadPhoto = jest.fn();
const mockDeletePhoto = jest.fn();
const mockUsePayoutAccount = jest.fn();

jest.mock('../profile/queries', () => ({
  useDriverProfile: () => mockUseDriverProfile(),
  useUpdateDriverProfile: () => ({ mutateAsync: mockUpdateProfile, isPending: false }),
  useUploadDriverPhoto: () => ({ mutateAsync: mockUploadPhoto, isPending: false }),
  useDeleteDriverPhoto: () => ({ mutateAsync: mockDeletePhoto, isPending: false }),
}));

jest.mock('../wallet/payoutQueries', () => ({
  usePayoutAccount: () => mockUsePayoutAccount(),
}));

const mockUseClosureRequest = jest.fn();

jest.mock('../profile/closureQueries', () => ({
  useClosureRequest: () => mockUseClosureRequest(),
}));

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchCameraAsync: jest.fn().mockResolvedValue({ canceled: true, assets: [] }),
  launchImageLibraryAsync: jest.fn().mockResolvedValue({ canceled: true, assets: [] }),
}));

jest.mock('../trips/queries', () => ({
  useDriverStats: () => mockUseDriverStats(),
}));

jest.mock('../offline/SyncProvider', () => ({
  useSync: () => mockUseSync(),
}));

jest.mock('../ui/SyncBanner', () => ({ SyncBanner: () => null }));

const mockSignOut = jest.fn();

jest.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { name: 'Account Name' }, signOut: mockSignOut }),
}));

function profile(overrides: Partial<DriverProfile> = {}): DriverProfile {
  return {
    name: 'John Kamau',
    // ADR-0041 made this required on `DriverProfile`.
    photo_url: null,
    phone: '+256700123456',
    email: null,
    member_since: '2024-01-15',
    trips_total: 428,
    vehicle: {
      make: 'Toyota',
      model: 'Wish',
      registration_number: 'UBB 123X',
      category: 'sedan',
      category_label: 'Sedan',
    },
    documents: { state: 'verified', verified: 4, total: 4, action_needed: 0, pending: 0 },
    ...overrides,
  };
}

function stats(overrides: Partial<DriverStats> = {}): DriverStats {
  return {
    trips_today: 2,
    earnings_today_minor: 16_400,
    wallet_balance_minor: -4_500,
    currency: 'UGX',
    acceptance_rate: 92,
    completion_rate: 100,
    rating: 4.8,
    rating_count: 6,
    window_days: 30,
    ...overrides,
  };
}

// Hoisted out of the object literal so the tests can assert on them. The
// parent's `navigate` in particular: "Settling up" crosses to the Wallet tab,
// and an inline `jest.fn()` inside `getParent` is a fresh spy on every call
// with nothing to assert against.
function closureRequest(overrides: Partial<DriverClosureRequest> = {}): DriverClosureRequest {
  return {
    id: 7,
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

const navigate = jest.fn();
const parentNavigate = jest.fn();

const navigation = {
  navigate,
  getParent: () => ({ navigate: parentNavigate }),
} as never;

async function renderProfile(element: ReactElement) {
  // RTL v14's render is async in this setup; awaiting is what makes the tree
  // exist rather than the screen appearing broken.
  return render(<SafeAreaProvider initialMetrics={METRICS}>{element}</SafeAreaProvider>);
}

beforeEach(() => {
  // Cleared, not merely re-stubbed. Without this the call counts below carry
  // over between cases, and `not.toHaveBeenCalled()` becomes an assertion
  // about test order rather than about the screen.
  jest.clearAllMocks();
  mockUseDriverProfile.mockReturnValue({ data: profile() });
  mockUseDriverStats.mockReturnValue({ data: stats() });
  mockUseSync.mockReturnValue({ parked: [], pending: 0 });
  mockUsePayoutAccount.mockReturnValue({ data: null });
  // A driver who has never asked to close their account, which is nearly all
  // of them and is the state every other case here should be read against.
  mockUseClosureRequest.mockReturnValue({ data: null });
});

/**
 * Open the phone editor, type, and press Save.
 *
 * **The wait between typing and saving is load-bearing, not defensive.**
 * `fireEvent.changeText` schedules a state update; without waiting for it to
 * land, `saveEdit` reads the *previous* draft, decides nothing changed and
 * closes the editor silently. The first version of these tests did exactly
 * that and reported "no request sent" as a pass — the unchanged-value test
 * would have gone on passing with the comparison deleted.
 */
async function editPhone(screen: Awaited<ReturnType<typeof render>>, value: string) {
  await fireEvent.press(screen.getByLabelText('Phone: +256700123456. Edit'));

  const field = await screen.findByLabelText('Your phone number');

  await fireEvent.changeText(field, value);

  // Belt and braces, and the braces are the point: awaiting `fireEvent` is
  // what flushes the state update, and this asserts it actually did. Without
  // the flush, `saveEdit` reads the *previous* draft, decides nothing changed
  // and closes the editor silently — which the first version of these tests
  // reported as "no request sent", a pass for entirely the wrong reason.
  await waitFor(() => expect(screen.getByLabelText('Your phone number').props.value).toBe(value));

  await fireEvent.press(screen.getByLabelText('Save'));
}

it('shows who the driver is, and what they drive', async () => {
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.getByText('John Kamau')).toBeTruthy();
  expect(screen.getByText('+256700123456')).toBeTruthy();
  expect(screen.getByText('Toyota Wish · UBB 123X')).toBeTruthy();
  expect(screen.getByText('Sedan')).toBeTruthy();
  expect(screen.getByText('Jan 2024')).toBeTruthy();
  expect(screen.getByText('4.8')).toBeTruthy();
});

it('falls back to a monogram when the driver has no photograph', async () => {
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  // Derived from the driver's own name. **This is now a fallback, not a
  // refusal** — ADR-0041 built driver photographs and this screen sets them.
  // What has not changed is that a stock face would misidentify the person a
  // dispatcher is looking for, so the empty state stays the initials.
  expect(screen.getByText('JK')).toBeTruthy();
});

it('shows the photograph once there is one, instead of the initials', async () => {
  mockUseDriverProfile.mockReturnValue({
    data: profile({ photo_url: 'https://api.test/api/v1/me/photo?v=abc123' }),
  });

  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.queryByText('JK')).toBeNull();
  expect(screen.getByLabelText('Change your photo')).toBeTruthy();
  // Only offered when one is held: "Remove photo" against a monogram is a
  // control that does nothing.
  expect(screen.getByLabelText('Remove your photo')).toBeTruthy();
});

it('offers to add a photograph when there is none, and not to remove one', async () => {
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.getByLabelText('Add your photo')).toBeTruthy();
  expect(screen.queryByLabelText('Remove your photo')).toBeNull();
});

it('withholds the rating below five, rather than printing one', async () => {
  mockUseDriverStats.mockReturnValue({ data: stats({ rating: null, rating_count: 2 }) });

  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.getByText('—')).toBeTruthy();
  // The count is what makes the dash legible — a bare dash invites a driver to
  // assume the worst about a number that can end their income.
  expect(screen.getByText(/2 ratings so far/)).toBeTruthy();
});

/*
 * **These assertions have been here, then in `SettingsScreen.test.tsx`, and
 * are now back.** The round trip is not churn, it is two owner rulings: the
 * drawer took the map of the app ("we don't need to repeat the menus") and
 * Settings took the account actions; then Settings itself went ("all things in
 * the settings should be moved to profile page… so we don't need the settings
 * page"). `SettingsScreen.tsx` and its suite are deleted, and every property
 * they pinned is asserted below against the screen that now carries the rows.
 *
 * **One of them is deliberately not carried over**: *"never offers bank
 * details, which nothing on this platform can do"*. ADR-0042 built the payout
 * account, and this file already inverts that assertion below — a row that
 * goes somewhere real is the opposite of a dead surface, not a regression.
 *
 * The drift risk is unchanged and is what these pin: **this screen and
 * `navigation/drawer.ts` must be edited together.** A row added to one and not
 * the other is how a driver who learned the app from the drawer finds the
 * profile missing a destination.
 */
it('carries both groups of rows, since Settings was folded in', async () => {
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.getByText('Work')).toBeTruthy();
  expect(screen.getByText('Vehicle & Documents')).toBeTruthy();
  expect(screen.getByText('Account')).toBeTruthy();
  expect(screen.getByText('Log out')).toBeTruthy();
});

/**
 * Mutation check on the deletion itself — leave the old row in place and this
 * fails. A "Settings" row on this screen now points at a route that no longer
 * exists, which is a crash rather than a dead end.
 */
it('no longer offers a Settings row, because there is no Settings screen', async () => {
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.queryByText('Settings')).toBeNull();
});

it('gives time off a way in, which the four-tab bar had left unreachable', async () => {
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  await fireEvent.press(screen.getByText('Time off'));

  expect(navigate).toHaveBeenCalledWith('TimeOff');
});

it('sends settling up to the wallet rather than implying a rail', async () => {
  // ADR-0032: settling up is a request the office answers, not a transfer.
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  await fireEvent.press(screen.getByText('Settling up'));

  expect(parentNavigate).toHaveBeenCalledWith('Wallet');
});

it('keeps changing the password one tap from the profile', async () => {
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  await fireEvent.press(screen.getByText('Change password'));

  expect(navigate).toHaveBeenCalledWith('ChangePassword');
});

it('keeps the parked queue reachable, and says when nothing is stuck', async () => {
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.getByText('Updates & sync')).toBeTruthy();
  expect(screen.getByText('Nothing stuck')).toBeTruthy();
});

it('counts what is stuck, so a refused update cannot be missed', async () => {
  // ADR-0023 §6. A driver whose closing odometer was refused has to be able to
  // read the number back to the office, which means the row has to shout.
  mockUseSync.mockReturnValue({ parked: [{ id: 'a' }, { id: 'b' }], pending: 2 });

  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.getByText('2 need you')).toBeTruthy();
});

it('confirms before signing out rather than doing it on one tap', async () => {
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  await fireEvent.press(screen.getByText('Log out'));

  // The dialog is the confirmation; nothing is signed out until it is
  // answered. A one-tap log out at the foot of a scroll is a mis-tap that ends
  // a shift.
  expect(mockSignOut).not.toHaveBeenCalled();
});

it('shows the version, read from the manifest rather than typed', async () => {
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  // The mockup's "v2.3.0" was somebody's placeholder. This is the number a
  // driver reads out when they ring the office about a bug.
  expect(screen.getByText('KangaruRide v1.0.0')).toBeTruthy();
});

/**
 * Carried over from the Settings suite, and still true of the screen that
 * absorbed it. The only push this platform sends is a job offer with a
 * fifteen-second clock: a driver who switched it off would stop being offered
 * work while still looking available to dispatch. The OS permission is the
 * honest control, because turning it off there says what it costs.
 */
it('offers no push switch, language or theme picker, because none exists', async () => {
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.queryByText(/push/i)).toBeNull();
  expect(screen.queryByText(/language/i)).toBeNull();
  expect(screen.queryByText(/theme|dark mode/i)).toBeNull();
});

/*
 * **This replaces a test that asserted the row's absence**, as that test's own
 * body said it would. It is not deleted quietly: the row was missing for one
 * pass because its endpoint did not exist and a row that navigates nowhere is
 * a dead surface. ADR-0042 built the endpoint, so the row is now here and the
 * assertion is inverted rather than dropped.
 */
it('offers bank details, now that there is somewhere for them to go', async () => {
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.getByText('Bank Details')).toBeTruthy();
  // Not set, because this driver has none — the row prompts rather than
  // reading as an error.
  expect(screen.getByText('Not set')).toBeTruthy();
});

it('names the bank on the row, and never the account number', async () => {
  mockUsePayoutAccount.mockReturnValue({
    data: {
      kind: 'bank',
      kind_label: 'Bank account',
      institution_label: 'Bank',
      number_label: 'Account number',
      institution: 'Stanbic',
      account_holder_masked: 'J. Kamau',
      account_number_masked: '•••• 4567',
      last_four: '4567',
      updated_at: null,
    },
  });

  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.getByText('Stanbic')).toBeTruthy();
  // **This screen is opened in front of passengers and dispatchers.** Even the
  // masked tail belongs on the Bank Details screen, which a driver went
  // looking for; it has no business on a profile glanced at over a shoulder.
  expect(screen.queryByText(/4567/)).toBeNull();
});

/**
 * **This replaces a test that asserted the row's absence**, and it is the
 * second time this file has inverted one that way — Bank Details did it above.
 * Neither was a change of mind: both rows were withheld while pressing them
 * would have reached nothing, and both appear now because ADR-0042 and ADR-0043
 * built what they reach. *"A Delete that only appears to work is worse than no
 * Delete"* is the rule, and it is satisfied rather than abandoned.
 */
it('offers the danger zone, now that the office can answer it', async () => {
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.getByText('Danger zone')).toBeTruthy();

  await fireEvent.press(screen.getByText('Delete account'));

  expect(navigate).toHaveBeenCalledWith('CloseAccount');
});

/**
 * The row answers "did that go through?" without costing a tap.
 *
 * Mutation check — drop the `value` and this fails. A driver who asked to close
 * their account yesterday and sees an unchanged row has no way to tell whether
 * the request was ever sent, and the honest place to say so is the screen they
 * are already on.
 */
it('says on the row when a closure request is waiting', async () => {
  mockUseClosureRequest.mockReturnValue({ data: closureRequest({ status: 'pending' }) });

  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.getByText('Waiting for the office')).toBeTruthy();
});

it('says nothing on the row when there is nothing waiting', async () => {
  // A status nobody asked for is noise. Declined and withdrawn read the same
  // as never having asked, because all three mean the driver may ask again.
  mockUseClosureRequest.mockReturnValue({ data: closureRequest({ status: 'declined' }) });

  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.queryByText('Waiting for the office')).toBeNull();
});

it('lets a driver correct their own phone number', async () => {
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  await editPhone(screen, '+256701999888');

  await waitFor(() => {
    // The field name is asserted, not just that something was sent. A mutation
    // called with `{name: ...}` here would rename the driver to their own
    // phone number and the screen would look correct until the next reload.
    expect(mockUpdateProfile).toHaveBeenCalledWith({ phone: '+256701999888' });
  });
});

it('sends nothing when the value has not actually changed', async () => {
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  // A trailing space is what a driver produces by tapping in and out of a
  // field. Sending it writes an audit-log entry recording a change nobody
  // made — and the office reads that log to find out why a number moved.
  await editPhone(screen, '+256700123456 ');

  // The editor closing is the assertion that the save was *handled*, not
  // dropped. Without it "nothing was sent" would also pass if the button had
  // simply stopped working.
  await waitFor(() => expect(screen.queryByLabelText('Your phone number')).toBeNull());

  expect(mockUpdateProfile).not.toHaveBeenCalled();
});

it('refuses a blank value on the handset rather than asking the server', async () => {
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  await editPhone(screen, '   ');

  await waitFor(() => expect(screen.getByText('A phone number cannot be blank.')).toBeTruthy());

  expect(mockUpdateProfile).not.toHaveBeenCalled();
});

it('says the save did not land, rather than pretending it did', async () => {
  mockUpdateProfile.mockRejectedValueOnce(new Error('offline'));

  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  await editPhone(screen, '+256701999888');

  // The wording matters: this mutation is outside the offline outbox, so a
  // driver must not be left believing it is queued. ADR-0023 carries trip
  // transitions, not this.
  await waitFor(() => expect(screen.getByText(/not queued/)).toBeTruthy());
});

it('names who manages what the driver cannot edit', async () => {
  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  // The whole point of the rebuild: an omitted control reads as unfinished,
  // where a named holder reads as deliberate. Without this the screen is back
  // to looking incomplete.
  expect(screen.getByText('The depot allocates vehicles.')).toBeTruthy();
  expect(screen.queryByLabelText(/Vehicle: Toyota Wish · UBB 123X\. Edit/)).toBeNull();
});

it('reports the documents state rather than assuming the friendly one', async () => {
  mockUseDriverProfile.mockReturnValue({
    data: profile({
      documents: { state: 'action_needed', verified: 2, total: 4, action_needed: 1, pending: 1 },
    }),
  });

  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  expect(screen.getByText('1 needs attention')).toBeTruthy();
  expect(screen.queryByText('Verified')).toBeNull();
});

it('renders em dashes rather than blanks before the profile loads', async () => {
  mockUseDriverProfile.mockReturnValue({ data: undefined });
  mockUseDriverStats.mockReturnValue({ data: undefined });

  const screen = await renderProfile(<ProfileScreen navigation={navigation} route={{} as never} />);

  // The account's name still stands in — a driver knows their own name even
  // when their driver record has not arrived.
  expect(screen.getByText('Account Name')).toBeTruthy();
  expect(screen.getAllByText('—').length).toBeGreaterThan(1);
});
