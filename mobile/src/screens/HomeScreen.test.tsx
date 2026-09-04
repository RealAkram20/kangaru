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
const mockDriverProfile = jest.fn();

jest.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: { name: 'Demo Driver' } }) }));
jest.mock('../trips/queries', () => ({
  useTrips: () => mockTrips(),
  useDriverStats: () => mockStats(),
}));
// The shared act, mocked at the hook rather than at the queries under it: the
// screen's contract is with `useDutyToggle` — permission, vehicle, and the
// server's refusal all travel through it — and a test that reached under it
// to a bare `useSetDuty` would pass against the exact bypass this fixed.
const mockToggle = jest.fn(async () => undefined);
jest.mock('../duty/useDutyToggle', () => ({ useDutyToggle: () => mockDuty() }));
jest.mock('../notifications/queries', () => ({ useNotifications: () => mockInbox() }));
// The header avatar reads the driver's photograph from the same query the
// drawer uses. `null` is the ordinary case — a driver who has not sent one.
jest.mock('../profile/queries', () => ({ useDriverProfile: () => mockDriverProfile() }));
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
  mockToggle.mockClear();
  mockDuty.mockReturnValue({
    duty: { on_duty: false },
    onDuty: false,
    dispatchable: false,
    busy: false,
    refusal: null,
    toggle: mockToggle,
  });
  mockInbox.mockReturnValue({ data: { notifications: [], unread: 0 } });
  mockDriverProfile.mockReturnValue({ data: { name: 'Demo Driver', photo_url: null } });
});

it('shows the office\'s refusal under the switch when a sign-on is turned down', async () => {
  // The sentence is the server's (ADR-0017), shown verbatim. Found on a
  // handset: a driver off their roster tapped Go online, got 409
  // DRIVER_UNAVAILABLE, and this screen said nothing — the switch stayed put
  // and the button read as broken while they waited for offers that could
  // never come.
  mockDuty.mockReturnValue({
    onDuty: false,
    busy: false,
    refusal: 'This driver is not rostered for that time.',
    toggle: mockToggle,
  });

  const screen = await renderHome();

  const refusal = screen.getByText('This driver is not rostered for that time.');
  // Announced, not merely painted: a screen-reader user otherwise hears a
  // switch that did not move and nothing else.
  expect(refusal.props.accessibilityRole).toBe('alert');
  expect(screen.getByText('You are offline')).toBeTruthy();
});

it('says nothing under the switch when nothing was refused', async () => {
  const screen = await renderHome();

  expect(screen.queryByText('This driver is not rostered for that time.')).toBeNull();
});

it('says when the driver is online but not yet findable', async () => {
  // On duty is not the same as dispatchable — the gap is where "I'm online
  // but get nothing" lives, and the owner sat in it for an hour. The sentence
  // is `DutyBar`'s, verbatim: one state, one wording, on both surfaces.
  mockDuty.mockReturnValue({
    duty: { on_duty: true },
    onDuty: true,
    dispatchable: false,
    busy: false,
    refusal: null,
    toggle: mockToggle,
  });

  const screen = await renderHome();

  expect(screen.getByText('Waiting for a location fix — you may not get jobs yet')).toBeTruthy();
});

it('says nothing extra once the driver is findable', async () => {
  mockDuty.mockReturnValue({
    duty: { on_duty: true },
    onDuty: true,
    dispatchable: true,
    busy: false,
    refusal: null,
    toggle: mockToggle,
  });

  const screen = await renderHome();

  expect(screen.queryByText(/location fix/)).toBeNull();
});

it('routes both duty controls through the shared toggle, not a bare mutation', async () => {
  // Two controls, one act. Either goes through `useDutyToggle` — which is
  // what asks for location, carries the vehicle, and catches the refusal. A
  // direct `setDuty.mutate` here would silently sign a driver on and drop
  // all three, which is exactly what this screen used to do.
  const screen = await renderHome();

  await fireEvent.press(screen.getByRole('switch', { name: 'Go online' }));
  expect(mockToggle).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByRole('button', { name: 'Go online' }));
  expect(mockToggle).toHaveBeenCalledTimes(2);
});

it('opens the inbox on the Profile stack when the bell is tapped', async () => {
  const screen = await renderHome();

  await fireEvent.press(screen.getByLabelText('Notifications'));

  // Not `navigate('Today')`, which is what this did and what the owner had
  // removed — and not a bare `navigate('Notifications')` either, which would
  // look right in a diff and throw on a handset: the route is not on this
  // stack.
  //
  // **`initial: false` is asserted, not incidental** — the same guard
  // `DrawerContent.test.tsx` puts on its own three calls. Without it the
  // Profile stack is created as `["Notifications"]` at index 0, with
  // `ProfileHome` never in it: nothing to pop, so the Profile tab appears
  // dead and Android's back gesture leaves the app. The drawer was fixed for
  // this and **this call site was missed**, which is how it returned as the
  // owner's "we are stuck, sometimes".
  expect(parentNavigate).toHaveBeenCalledWith('Profile', {
    screen: 'Notifications',
    initial: false,
  });
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

it('opens the profile when the avatar is tapped, because that is what it looks like', async () => {
  // It was a bare `View`: the most person-shaped thing on the screen, sitting
  // in the corner every app puts an account button in, doing nothing. The
  // owner's words — "most time people will click on it".
  const screen = await renderHome();

  await fireEvent.press(screen.getByLabelText('Your profile'));

  // `getParent()`, like the bell: Profile is a sibling tab, not a screen on
  // this stack, and a local navigate would typecheck and throw on a handset.
  expect(parentNavigate).toHaveBeenCalledWith('Profile', { screen: 'ProfileHome' });
  expect(navigate).not.toHaveBeenCalled();
});

it('shows the driver photograph in the header once there is one', async () => {
  // The comment this replaces said "the platform holds no avatar" — true when
  // written, wrong since ADR-0041. The drawer has rendered `photo_url` all
  // along, so a driver who set one saw their face there and their initial here.
  mockDriverProfile.mockReturnValue({
    data: { name: 'Demo Driver', photo_url: 'https://api.test/me/photo?v=abc' },
  });

  const screen = await renderHome();
  const avatar = screen.getByLabelText('Your profile');

  // The initial must be gone, not merely covered — asserted inside the avatar
  // so the driver's name elsewhere on the screen cannot satisfy it.
  expect(within(avatar).queryByText('D')).toBeNull();
});

it('falls back to the initial when no photograph has been sent', async () => {
  const screen = await renderHome();
  const avatar = screen.getByLabelText('Your profile');

  expect(within(avatar).getByText('D')).toBeTruthy();
});

/**
 * The desk's assignment, on the home screen (ADR-0064).
 *
 * An `assigned` trip is one the driver has not answered, and before this
 * card it surfaced only in the Trips list's Upcoming group — an owner
 * watched a freshly dispatched delivery reach the handset and show nothing.
 */
it('puts an unanswered desk assignment on the home screen, opening the trip record', async () => {
  mockTrips.mockReturnValue({
    trips: [
      {
        id: 95,
        status: 'assigned',
        origin: 'Kampala Road',
        destination: 'Mukono Health Centre IV, Seeta',
        completed_at: null,
      },
    ],
    isRefetching: false,
    refetch: jest.fn(),
  });

  const screen = await renderHome();

  expect(screen.getByText('New trip assigned')).toBeTruthy();
  expect(screen.getByText('Mukono Health Centre IV, Seeta')).toBeTruthy();

  void fireEvent.press(screen.getByLabelText(/New trip assigned from Kampala Road/));

  // The record view is where Accept and Decline live — an assigned trip is
  // a question, and the app must not route to a pickup map before it is
  // answered.
  expect(navigate).toHaveBeenCalledWith('TripDetail', { tripId: 95 });
});

it('shows no assignment card when every trip is answered or done', async () => {
  mockTrips.mockReturnValue({
    trips: [
      {
        id: 96,
        status: 'trip_completed',
        origin: 'Wandegeya',
        destination: 'Ntinda',
        completed_at: new Date().toISOString(),
      },
    ],
    isRefetching: false,
    refetch: jest.fn(),
  });

  const screen = await renderHome();

  expect(screen.queryByText('New trip assigned')).toBeNull();
});
