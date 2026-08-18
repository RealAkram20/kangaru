import { fireEvent, render, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HomeScreen } from './HomeScreen';

/**
 * The home screen's top bar.
 *
 * The first test this screen has ever had, and it covers the bell rather than
 * the figures below it: the money, the rates and the rating are formatted by
 * `statsPresentation` and `offerPresentation`, which have their own suites and
 * are where a wrong number would come from. What only a render can see is
 * **where a control goes**, and the bell is the one that has been wrong — it
 * opened a second copy of this screen for as long as the app has existed.
 *
 * `Notifications` lives on the *Profile* stack, so the navigation is a hop up
 * to the tab navigator and then into it. That indirection is exactly the sort
 * of thing that typechecks while landing nowhere, which is why it is asserted
 * here rather than assumed.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

// `mock` prefix required: Jest hoists the factories above this line.
const mockTrips = jest.fn();
const mockStats = jest.fn();
const mockDuty = jest.fn();
const mockInbox = jest.fn();

jest.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: { name: 'Demo Driver' } }) }));
jest.mock('../trips/queries', () => ({
  useTrips: () => mockTrips(),
  useDriverStats: () => mockStats(),
}));
jest.mock('../duty/queries', () => ({
  useDuty: () => mockDuty(),
  useSetDuty: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('../notifications/queries', () => ({ useNotifications: () => mockInbox() }));
jest.mock('../offline/SyncProvider', () => ({
  useSync: () => ({
    sync: jest.fn(async () => undefined),
    online: true,
    pending: 0,
    parked: [],
    bufferedPings: 0,
  }),
}));

const navigate = jest.fn();
const parentNavigate = jest.fn();

const navigation = {
  navigate,
  getParent: () => ({ navigate: parentNavigate, getParent: () => ({ dispatch: jest.fn() }) }),
} as never;

async function renderHome(): Promise<ReturnType<typeof render>> {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <HomeScreen navigation={navigation} route={{ key: 'home', name: 'TripsHome' } as never} />
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  navigate.mockClear();
  parentNavigate.mockClear();

  mockTrips.mockReturnValue({ trips: [], isRefetching: false, refetch: jest.fn() });
  mockStats.mockReturnValue({ data: undefined, refetch: jest.fn() });
  mockDuty.mockReturnValue({ data: { on_duty: false } });
  mockInbox.mockReturnValue({ data: { notifications: [], unread: 0 } });
});

it('opens the inbox on the Profile stack when the bell is tapped', async () => {
  const screen = await renderHome();

  await fireEvent.press(screen.getByLabelText('Notifications'));

  // Not `navigate('Today')`, which is what this did and what the owner had
  // removed — and not a bare `navigate('Notifications')` either, which would
  // look right in a diff and throw on a handset: the route is not on this
  // stack.
  expect(parentNavigate).toHaveBeenCalledWith('Profile', { screen: 'Notifications' });
  expect(navigate).not.toHaveBeenCalled();
});

it('badges the bell with unread mail, and says the count out loud', async () => {
  mockInbox.mockReturnValue({ data: { notifications: [], unread: 3 } });

  const screen = await renderHome();

  // The drawer's row is worded identically — one control, one wording.
  const bell = screen.getByLabelText('Notifications, 3 unread');

  // Scoped to the bell rather than to the screen: the stat cards below are
  // full of bare numerals, and a free `getByText('3')` would pass on the trip
  // count while the badge drew nothing.
  expect(within(bell).getByText('3')).toBeTruthy();
});

it('draws no badge when nothing is unread', async () => {
  const screen = await renderHome();

  // A zero on a bell is a badge a driver taps to find nothing behind, and it
  // is what this would draw if the count were rendered unconditionally.
  const bell = screen.getByLabelText('Notifications');

  expect(within(bell).queryByText('0')).toBeNull();
});
