import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DrawerContent } from './DrawerContent';

/**
 * The drawer, rendered.
 *
 * `drawer.test.ts` covers the row list as data; this covers the three things
 * only a render can see — that the identity block reads as one sentence, that
 * the duty control posts through the shared toggle rather than a second copy,
 * and that a row navigates into the right nesting.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

// `mock` prefix required: Jest hoists the factories above this line.
const mockProfile = jest.fn();
const mockStats = jest.fn();
const mockTrips = jest.fn();
const mockDuty = jest.fn();
const mockInbox = jest.fn();

jest.mock('../profile/queries', () => ({ useDriverProfile: () => mockProfile() }));
jest.mock('../trips/queries', () => ({
  useDriverStats: () => mockStats(),
  useTrips: () => mockTrips(),
}));
jest.mock('../duty/useDutyToggle', () => ({ useDutyToggle: () => mockDuty() }));
jest.mock('../notifications/queries', () => ({ useNotifications: () => mockInbox() }));

const closeDrawer = jest.fn();
const navigate = jest.fn();
const toggle = jest.fn();

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
  toggle.mockClear();

  mockProfile.mockReturnValue({
    data: { name: 'John Kamau', photo_url: null, trips_total: 428 },
  });
  mockStats.mockReturnValue({ data: { rating: 4.8, rating_count: 40 } });
  mockTrips.mockReturnValue({ data: { trips: [] } });
  mockDuty.mockReturnValue({ onDuty: true, busy: false, refusal: null, toggle });
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

  mockDuty.mockReturnValue({ onDuty: false, busy: false, refusal: null, toggle });
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

it('names the live trip by what it is doing, and only while it is live', async () => {
  mockTrips.mockReturnValue({ data: { trips: [{ id: 41, status: 'driver_en_route' }] } });

  const screen = await renderDrawer();

  expect(screen.getByText('On the way')).toBeTruthy();
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

it('posts duty through the shared toggle rather than a second copy', async () => {
  const screen = await renderDrawer();

  await fireEvent.press(screen.getByLabelText('Go Offline'));

  // `DutyBar` on the home screen calls the same hook. Two copies would have
  // been two answers to one question, and the half a copy drops is the
  // location permission — invisible until a driver signs on and gets no work.
  expect(toggle).toHaveBeenCalled();
});

it('offers to go online when off duty, and does not call that destructive', async () => {
  mockDuty.mockReturnValue({ onDuty: false, busy: false, refusal: null, toggle });

  const screen = await renderDrawer();

  expect(screen.getByLabelText('Go Online')).toBeTruthy();
});

it('shows the office refusal in the server own words', async () => {
  // ADR-0017 put the wording for approved leave, a roster and a suspension in
  // one place precisely so a driver is not told two different things by two
  // different screens — and this is the second screen.
  mockDuty.mockReturnValue({
    onDuty: false,
    busy: false,
    refusal: 'You are on approved leave until 20 August.',
    toggle,
  });

  const screen = await renderDrawer();

  expect(screen.getByText('You are on approved leave until 20 August.')).toBeTruthy();
});

// -- Chrome ----------------------------------------------------------------

it('reads the version from the manifest rather than a typed string', async () => {
  const screen = await renderDrawer();

  // The mockup says v2.3.0. That is somebody's placeholder, and this is the
  // number a driver reads out when they ring the office about a bug.
  expect(screen.getByText('v1.0.0')).toBeTruthy();
});

it('lights the row the driver is actually on, not merely its tab', async () => {
  const screen = await renderDrawer(drawerProps('Profile', 'Documents'));

  expect(
    screen.getByLabelText('Vehicle & Documents').props.accessibilityState.selected,
  ).toBe(true);
  expect(screen.getByLabelText('Profile').props.accessibilityState.selected).toBe(false);
});
