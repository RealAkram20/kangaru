import { render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { PermissionStates, Reliability } from '../permissions/permissions';
import { PermissionsScreen } from './PermissionsScreen';

/**
 * The Permissions screen, rendered.
 *
 * `docs/screen-rules.md` §8: green tests over formatters do not prove a screen
 * mounts. `permissions.test.ts` covers the counting; this covers the thing that
 * counting is for — **what a driver actually reads**.
 *
 * The assertions are deliberately about words rather than layout. Two of these
 * six permissions cannot be read by any API in this stack, and the failure this
 * screen must never have is claiming a state it does not know.
 */

const mockRead = jest.fn();
const mockLive = jest.fn();

jest.mock('../permissions/readState', () => ({
  readPermissionStates: () => mockRead() as Promise<PermissionStates>,
  readReliability: () => mockLive() as Promise<Reliability>,
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function states(overrides: Partial<PermissionStates> = {}): PermissionStates {
  return {
    notifications: 'granted',
    locationWhenInUse: 'granted',
    locationAlways: 'granted',
    battery: 'unreadable',
    lockScreen: 'unreadable',
    camera: 'granted',
    ...overrides,
  };
}

/** Everything healthy: nobody on duty, battery saver off. */
function healthy(overrides: Partial<Reliability> = {}): Reliability {
  return { batterySaver: 'off', onlineService: 'off_duty', ...overrides };
}

async function renderScreen(initial: PermissionStates, live: Reliability = healthy()) {
  mockRead.mockResolvedValue(initial);
  mockLive.mockResolvedValue(live);

  const navigation = { goBack: jest.fn(), navigate: jest.fn() };

  // `await render` — RTL v14 renders concurrently, and the screen resolves its
  // first permission read in an effect. Without the await the tree asserted on
  // is the one before any state arrived.
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <PermissionsScreen
        // The screen uses only `goBack` and the route's name; the rest of the
        // navigator surface is not worth reconstructing for that.
        navigation={navigation as never}
        route={{ key: 'Permissions', name: 'Permissions', params: undefined } as never}
      />
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  mockRead.mockReset();
  mockLive.mockReset();
});

it('names every permission a job depends on', async () => {
  await renderScreen(states());

  // The three that carry a job, in a driver's words rather than Android's.
  expect(await screen.findByText('Notifications')).toBeTruthy();
  expect(screen.getByText('Location')).toBeTruthy();
  expect(screen.getByText('Location all the time')).toBeTruthy();

  // And the one that is not about jobs at all, kept apart under its own heading.
  expect(screen.getByText('Camera')).toBeTruthy();
  expect(screen.getByText('For your trips')).toBeTruthy();
});

it('says nothing at the top when nothing is wrong', async () => {
  /*
   * No congratulation. A screen that reassures a driver every time they open it
   * spends their attention on the one state that needs none — and a warning
   * that is always present is one nobody reads on the day it matters.
   */
  await renderScreen(states());

  await screen.findByText('Notifications');

  expect(screen.queryByText(/stopping jobs reaching you/)).toBeNull();
});

it('says how many permissions are stopping jobs', async () => {
  await renderScreen(states({ notifications: 'missing' }));

  expect(
    await screen.findByText('1 permission below is stopping jobs reaching you.'),
  ).toBeTruthy();

  // Paired with the row's own word, never colour alone (`screen-rules` §6).
  expect(screen.getByText('Not allowed')).toBeTruthy();
});

it('claims no state for a permission Android will not report', async () => {
  /*
   * **The rule the whole screen exists to hold.** `USE_FULL_SCREEN_INTENT` and
   * the battery exemption have no readable state, so those rows carry an action
   * and no status word — a "Not allowed" that cannot be verified would be wrong
   * on every handset that had already granted it.
   *
   * Asserted by counting: with everything else granted there must be no status
   * word anywhere, because the only two rows left are the unreadable ones.
   */
  await renderScreen(states());

  await screen.findByText('Notifications');

  expect(screen.queryByText('Not allowed')).toBeNull();
  expect(screen.getByText(/Android will not report the last two/)).toBeTruthy();
});

it('draws the two Android-only rows on Android, and nowhere else', async () => {
  /*
   * **The rows the whole feature turns on, and this runner hides them by
   * default.** `jest-expo` reports `Platform.OS === 'ios'`, so every assertion
   * above runs against a tree with the battery and lock-screen rows absent —
   * which is correct for iOS and proves nothing about the platform this fleet
   * actually runs.
   *
   * They are Android-only deliberately: iOS has no battery-optimisation concept
   * and no full-screen intent at any privilege level, so both rows there would
   * be instructions a driver cannot carry out — the dead surface
   * `docs/screen-rules.md` refuses.
   *
   * Mutation check: drop the `Platform.OS === 'android'` guard in the screen and
   * the iOS assertion below fails.
   */
  jest.replaceProperty(Platform, 'OS', 'android');

  await renderScreen(states());

  expect(await screen.findByText('Run in the background')).toBeTruthy();
  expect(screen.getByText('Show jobs over the lock screen')).toBeTruthy();
});

it('draws neither of them on iOS, where a driver could not act on either', async () => {
  /*
   * The other half of the pair, and it renders once like every test here — an
   * earlier version rendered twice inside a single test to compare platforms,
   * which left two trees mounted and made the *following* test fail to find its
   * own text. One render per test; the platform is the variable.
   *
   * **The platform is set explicitly even though `ios` is the runner's
   * default**, because `jest.replaceProperty` does not restore on its own — it
   * is undone by `jest.restoreAllMocks()`, which this project does not
   * configure. Left implicit, this test passes alone and fails after the
   * Android one above, which is the worst kind of test: order-dependent, and
   * green on the developer's machine.
   */
  jest.replaceProperty(Platform, 'OS', 'ios');

  await renderScreen(states());

  await screen.findByText('Notifications');

  expect(screen.queryByText('Run in the background')).toBeNull();
  expect(screen.queryByText('Show jobs over the lock screen')).toBeNull();
});

it('tells a driver what to fix first when one permission blocks another', async () => {
  /*
   * Android will not offer "all the time" until while-using is held. The second
   * row says what it is waiting for instead of "Not allowed", so the driver has
   * one thing to fix rather than two — and the summary counts one, not two.
   */
  await renderScreen(states({ locationWhenInUse: 'missing', locationAlways: 'blocked' }));

  expect(
    await screen.findByText('1 permission below is stopping jobs reaching you.'),
  ).toBeTruthy();
  expect(screen.getByText('Needs the one above')).toBeTruthy();
});

// -- The two live facts no permission covers -------------------------------

it('warns when battery saver is on, which no permission would catch', async () => {
  /*
   * **Battery Saver is not battery optimisation.** The exemption is per-app and
   * is what the battery row asks for; Battery Saver is a system-wide switch the
   * driver flips themselves, and it throttles background work whatever any app
   * is exempted from.
   *
   * So a driver can hold all six permissions, switch it on, go online and get
   * nothing — and before this the screen showed six green rows and said
   * everything was fine.
   *
   * Mutation check: drop the `batterySaver` branch from `whatIsWrong` and this
   * fails.
   */
  jest.replaceProperty(Platform, 'OS', 'android');

  await renderScreen(states(), healthy({ batterySaver: 'on' }));

  expect(
    await screen.findByText(
      'Battery saver is on. Your phone may stop the app and jobs will not reach you.',
    ),
  ).toBeTruthy();

  // And the row itself stops being a bare action and carries the readable half.
  expect(screen.getByText('Battery saver is on')).toBeTruthy();
});

it('says so when the driver is online but the phone has stopped the service', async () => {
  /*
   * **The outcome, not a proxy for it.** Every permission can be granted and
   * this can still be true — an OEM battery manager needs no permission to kill
   * a process. It is also the only state here that means jobs are being missed
   * at this moment, so it outranks everything else on the screen.
   */
  await renderScreen(states(), healthy({ onlineService: 'stopped' }));

  expect(
    await screen.findByText(
      'You are online, but this phone has stopped the app. Jobs will not reach you.',
    ),
  ).toBeTruthy();
});

it('does not call a finished shift a fault', async () => {
  /*
   * Nothing runs when nobody has gone online, so reporting "stopped" off duty
   * would put a red warning on the screen of every driver who has finished for
   * the day.
   */
  await renderScreen(states(), healthy({ onlineService: 'off_duty' }));

  await screen.findByText('Notifications');

  expect(screen.queryByText(/has stopped the app/)).toBeNull();
});
