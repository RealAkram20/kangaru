import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DrawerContent } from './DrawerContent';

/**
 * The drawer, rendered.
 *
 * `drawer.test.ts` covers the row list as data; this covers what only a render
 * can see — that the identity block reads as one sentence, that a row navigates
 * into the right nesting, and **that three things the owner removed stay
 * removed**: the live-trip row, the duty button, and the version string. Those
 * three are absence assertions, which are the easy ones to write badly, so each
 * names every form the removed thing could come back in.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

// `mock` prefix required: Jest hoists the factories above this line.
const mockProfile = jest.fn();
const mockStats = jest.fn();
const mockDuty = jest.fn();
const mockInbox = jest.fn();

jest.mock('../profile/queries', () => ({ useDriverProfile: () => mockProfile() }));
jest.mock('../trips/queries', () => ({
  useDriverStats: () => mockStats(),
}));
// The read-only duty query, not `useDutyToggle`: this panel reports duty state
// and no longer offers the action. Mocked at the query rather than left real
// because `duty/queries` reaches `AuthProvider` and AsyncStorage.
jest.mock('../duty/queries', () => ({ useDuty: () => mockDuty() }));
jest.mock('../notifications/queries', () => ({ useNotifications: () => mockInbox() }));

const closeDrawer = jest.fn();
const navigate = jest.fn();

function drawerProps(
  tab = 'Home',
  screen = 'TripsHome',
): React.ComponentProps<typeof DrawerContent> {
  return {
    state: {
      index: 0,
      routes: [
        {
          key: 'main',
          name: 'Main',
          state: {
            index: 0,
            routes: [{ name: tab, state: { index: 0, routes: [{ name: screen }] } }],
          },
        },
      ],
    },
    navigation: { closeDrawer, navigate },
    descriptors: {},
  } as never;
}

async function renderDrawer(
  props: React.ComponentProps<typeof DrawerContent> = drawerProps(),
): Promise<ReturnType<typeof render>> {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <DrawerContent {...props} />
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  closeDrawer.mockClear();
  navigate.mockClear();

  mockProfile.mockReturnValue({
    data: { name: 'John Kamau', photo_url: null, trips_total: 428 },
  });
  mockStats.mockReturnValue({ data: { rating: 4.8, rating_count: 40 } });
  mockDuty.mockReturnValue({ data: { on_duty: true } });
  mockInbox.mockReturnValue({ data: { notifications: [], unread: 0 } });
});

// -- Identity --------------------------------------------------------------

it('reads the identity block as one sentence rather than four fragments', async () => {
  const screen = await renderDrawer();

  expect(
    screen.getByLabelText('John Kamau. Rating 4.8. 428 trips. Online. Opens your profile.'),
  ).toBeTruthy();
});

it('draws initials when there is no photograph, which is the ordinary case', async () => {
  const screen = await renderDrawer();

  // Not an error state. A driver who has never sent the office a photograph
  // has this permanently, which is why it is the brand tint and their letters
  // rather than a grey silhouette.
  expect(screen.getByText('JK')).toBeTruthy();
});

it('says the duty state in a word, never with the green dot alone', async () => {
  const screen = await renderDrawer();

  // `docs/screen-rules.md` §6, and this is the most consequential fact here:
  // a driver who believes they are online and is not is being offered no work
  // and does not know it.
  expect(screen.getByText('Online')).toBeTruthy();

  mockDuty.mockReturnValue({ data: { on_duty: false } });
  const offline = await renderDrawer();

  expect(offline.getByText('Offline')).toBeTruthy();
});

// -- The rows --------------------------------------------------------------

it('draws the whole map of the app, including the rows Profile gave up', async () => {
  const screen = await renderDrawer();

  for (const label of [
    'Home',
    'Trips History',
    'Earnings',
    'Wallet',
    'Promotions',
    'Performance',
    'Notifications',
    'Profile',
    'Vehicle & Documents',
    'Help & Safety',
    'Support',
  ]) {
    expect(screen.getByText(label)).toBeTruthy();
  }
});

it('shows no trip row when nothing is running', async () => {
  const screen = await renderDrawer();

  // The mockup's permanent "Trip Details" could not work — a trip screen needs
  // an id, and opening the most recent journey is a guess dressed as
  // navigation.
  expect(screen.queryByText('Trip Details')).toBeNull();
});

it('names no live trip, whatever the driver is in the middle of', async () => {
  // The row this replaces was labelled `statusLabel(live.status)`, so a driver
  // part-way through the opening odometer read **"Passenger on board"** in
  // their menu — a lifecycle state offered as a destination. The owner asked
  // what it was for; `HomeScreen`'s `ActiveTripCard` already opens the live
  // trip in one tap, from the screen this panel slides over.
  //
  // The drawer no longer reads the trip list at all, which is why there is no
  // trips mock to set up: asserted through the rendered panel rather than
  // through `drawer.ts` alone, because the two could disagree.
  const screen = await renderDrawer();

  expect(screen.queryByText('Passenger on board')).toBeNull();
  expect(screen.queryByText('On the way')).toBeNull();
  expect(screen.queryByText('Trip in progress')).toBeNull();
});

it('navigates into the tab nesting and closes behind itself', async () => {
  const screen = await renderDrawer();

  await fireEvent.press(screen.getByLabelText('Vehicle & Documents'));

  expect(closeDrawer).toHaveBeenCalled();
  expect(navigate).toHaveBeenCalledWith('Main', {
    screen: 'Profile',
    params: { screen: 'Documents', params: undefined },
  });
});

/*
 * Inverted after a device run — see `drawer.test.ts` for the full account.
 * "Resumes where the driver left it" made the Profile row a visible no-op.
 */
it('sends a tab row to its stack root, so it always visibly navigates', async () => {
  const screen = await renderDrawer();

  await fireEvent.press(screen.getByLabelText('Wallet'));

  expect(navigate).toHaveBeenCalledWith('Main', {
    screen: 'Wallet',
    params: { screen: 'WalletHome', params: undefined },
  });
});

it('opens the profile from the identity block, so the face is not a dead control', async () => {
  const screen = await renderDrawer();

  await fireEvent.press(screen.getByLabelText(/Opens your profile/));

  expect(closeDrawer).toHaveBeenCalled();
  expect(navigate).toHaveBeenCalledWith('Main', {
    screen: 'Profile',
    params: { screen: 'ProfileHome', params: undefined },
  });
});

// -- The unread dot --------------------------------------------------------

it('announces the unread count rather than leaving the dot silent', async () => {
  mockInbox.mockReturnValue({ data: { notifications: [], unread: 3 } });

  const screen = await renderDrawer();

  expect(screen.getByLabelText('Notifications, 3 unread')).toBeTruthy();
});

/*
 * **A mutation survived here and this is the honest version of the test.**
 *
 * The original asserted that null and zero "must not look the same", and
 * replacing `?? null` with `?? 0` in `DrawerContent` did not fail it — because
 * at the *render* layer they genuinely are the same: both draw no dot and both
 * announce a bare "Notifications". The distinction is real in the data (see
 * `drawer.test.ts`, where it does bite) and meaningless on screen, which is
 * exactly right: "nothing to read" and "not loaded yet" should both be quiet.
 *
 * So this asserts what a render can actually prove — an inbox that has not
 * loaded neither crashes the drawer nor announces a count it does not have.
 */
it('does not announce a count it has not loaded', async () => {
  mockInbox.mockReturnValue({ data: undefined });

  const screen = await renderDrawer();

  expect(screen.getByLabelText('Notifications')).toBeTruthy();
  expect(screen.queryByLabelText(/unread/)).toBeNull();
});

// -- Duty ------------------------------------------------------------------

it('offers no way to change duty, in either direction', async () => {
  // The owner removed the red full-width **Go Offline** at the foot of the
  // panel: *"it sounds like we are forcing people to go offline."* A menu that
  // ends every opening with one loud action is suggesting it, and this menu is
  // opened to get somewhere else. `HomeScreen` carries the same toggle through
  // the same `useSetDuty`, so nothing is lost.
  //
  // Both directions are named, because the button rendered "Go Online" when
  // off duty — a test that only looked for "Go Offline" would pass against a
  // panel that still showed the control to every off-duty driver.
  const online = await renderDrawer();

  expect(online.queryByLabelText('Go Offline')).toBeNull();
  expect(online.queryByLabelText('Go Online')).toBeNull();

  mockDuty.mockReturnValue({ data: { on_duty: false } });
  const offline = await renderDrawer();

  expect(offline.queryByLabelText('Go Offline')).toBeNull();
  expect(offline.queryByLabelText('Go Online')).toBeNull();
});

it('still says whether the driver is online, because that is not the action', async () => {
  // The state stays and the control goes. `docs/screen-rules.md` §6 makes this
  // the most consequential fact on the panel: a driver who believes they are
  // online and is not is being offered no work and does not know it. Removing
  // the button must not take the word with it.
  const screen = await renderDrawer();

  expect(screen.getByText('Online')).toBeTruthy();
});

// -- Chrome ----------------------------------------------------------------

it('carries no version string, which lives on Profile and Support instead', async () => {
  // The owner's *"the version can be also removed from this menu pannel"*. It
  // was the third copy — `ProfileScreen` renders "KangaruRide 1.0.0" and
  // `SupportScreen` an "App version" row, and Support is the screen a driver is
  // on when they ring the office, which is the job this copy was defended for.
  const screen = await renderDrawer();

  expect(screen.queryByText('v1.0.0')).toBeNull();
  expect(screen.queryByText(/^v\d+\.\d+\.\d+$/)).toBeNull();
});

it('lights the row the driver is actually on, not merely its tab', async () => {
  const screen = await renderDrawer(drawerProps('Profile', 'Documents'));

  expect(
    screen.getByLabelText('Vehicle & Documents').props.accessibilityState.selected,
  ).toBe(true);
  expect(screen.getByLabelText('Profile').props.accessibilityState.selected).toBe(false);
});
