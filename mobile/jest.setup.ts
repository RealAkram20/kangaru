/**
 * Native modules this app calls have no implementation under Jest. They are
 * mocked here rather than per-test so a screen test that renders a provider
 * does not have to know which native module the provider reaches for.
 *
 * The two suites that carry the real weight — the outbox and the transition
 * logic — touch none of this: they are pure TypeScript over injected ports,
 * which is why they are the suites worth trusting.
 */

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => ({
    execAsync: jest.fn(async () => undefined),
    runAsync: jest.fn(async () => ({ lastInsertRowId: 1, changes: 1 })),
    getAllAsync: jest.fn(async () => []),
    getFirstAsync: jest.fn(async () => null),
  })),
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: false })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: false })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test]' })),
}));

// `isDevice: false` by default, which is what a simulator reports — and what
// `PushRegistrar` checks first, so the common test path exits before it
// touches anything else.
jest.mock('expo-device', () => ({
  isDevice: false,
  osVersion: '14',
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  // The *read*, which neither prompts nor was mocked until `PickupScreen`
  // needed it. `PresenceController` has always called it too; its absence
  // meant every caller silently took the catch branch, so the position path
  // went unexercised rather than failing loudly.
  //
  // Denied by default. A test that wants a fix says so — see
  // `PickupScreen.test.tsx` — and the default keeps every other suite on the
  // branch that renders an em dash, which is the one a handset in a basement
  // takes.
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied', granted: false })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: 0.3476, longitude: 32.5825, accuracy: 12 },
    timestamp: 0,
  })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  Accuracy: { High: 4, Balanced: 3 },
  ActivityType: { AutomotiveNavigation: 3 },
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));

/*
  The ringtone's native half.

  Nothing asserts against these: the rules that matter live in
  `duty/ringtone.ts` and are covered there over fake ports, which is the whole
  reason that file was separated from `duty/offerRingtone.ts`. This mock exists
  so that a screen test which happens to mount `OfferPresenter` does not reach
  a native module — and so `seekTo` returns a promise, since the real one does
  and the code `void`s it.
*/
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({
    loop: false,
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(async () => undefined),
    remove: jest.fn(),
  })),
  setAudioModeAsync: jest.fn(async () => undefined),
}));

/*
  The library's own mock, not a hand-written stand-in.

  It is a real in-memory store rather than a set of stubs that resolve `null`,
  which is what `duty/dutyStore` needs to be worth testing at all: the thing
  that can go wrong there is a record written in one shape and read back in
  another, and stubs that never return what was put in cannot catch it.

  Unmocked, the native module throws on import — and it throws from whichever
  file happened to import it first, which is why the failure surfaced in
  `PresenceController.test.tsx` rather than anywhere near the storage code.
*/
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true })),
  MediaTypeOptions: { Images: 'Images' },
}));

/*
  `expo-file-system`'s `File` is a native class, and every upload builds one
  (`api/formFile.ts`). The stand-in keeps the three members the code and the
  assertions actually use — a name, a mime type and the promise of bytes — so a
  test can read back what a form part was labelled as, which is the thing the
  real `FormData` will not hand over.
*/
jest.mock('expo-file-system', () => ({
  File: class {
    readonly uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    get name(): string {
      return this.uri.split('/').pop() ?? '';
    }

    get type(): string {
      return this.uri.endsWith('.png') ? 'image/png' : 'image/jpeg';
    }

    async bytes(): Promise<Uint8Array> {
      return new Uint8Array();
    }
  },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000000'),
}));

/*
 * The system clipboard, for the trip record's copyable reference.
 *
 * A native module, so there is nothing behind it under Jest. Mocked as a
 * resolving spy rather than as a no-op, because the assertion worth making is
 * *what string was copied* — a copy button that puts the trip's database id on
 * the clipboard instead of the customer's reference is wrong in a way no render
 * shows.
 */
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => true),
}));

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => () => undefined),
  fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
}));


/**
 * `react-native-webview` as a plain view.
 *
 * The real module resolves `RNCWebViewModule` through `TurboModuleRegistry.
 * getEnforcing`, which throws at *import* time under Jest — so any screen
 * holding a map fails to load before a single element renders.
 *
 * Both maps in this app are MapLibre inside a WebView (`TripMap`,
 * `PickupMap`), which makes this the load-bearing mock for every screen that
 * shows one. Stubbed as a host component so the layout around the map is
 * still exercised.
 *
 * **Nothing asserts on the map, and that limit is worth stating rather than
 * hiding: a passing suite says the screen mounts, not that tiles arrive.**
 * Proving that needs a handset and a network, and no test here substitutes
 * for looking at it.
 */
jest.mock('react-native-webview', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');

  const WebView = (props: Record<string, unknown>) => React.createElement('WebView', props);

  WebView.displayName = 'WebView';

  return { __esModule: true, default: WebView, WebView };
});

/**
 * The date picker as a plain element.
 *
 * A native module (ADR-0032's transactions filter uses it for a custom
 * range), so under Jest it has no view manager and throws on render. Mocked
 * as a named element rather than as `null`, so a test can still assert the
 * picker *opened* — which is the only thing about it worth asserting from
 * here; the calendar itself is the platform's.
 */
jest.mock('@react-native-community/datetimepicker', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');

  const DateTimePicker = (props: Record<string, unknown>) =>
    React.createElement('DateTimePicker', props);

  DateTimePicker.displayName = 'DateTimePicker';

  return { __esModule: true, default: DateTimePicker };
});

/**
 * `react-native-svg` as plain views.
 *
 * Not a convenience: the real module reaches for `processColor` off the
 * `react-native` root, and the Jest preset for RN 0.86 does not surface it,
 * so importing it throws before a single element renders. `processColor`
 * exists perfectly well at runtime — this is a test-environment gap, not
 * something the app can hit.
 *
 * Stubbed as host components rather than as `null`, so a screen containing a
 * chart or an icon still renders its real layout and everything around the
 * vector is genuinely exercised. Nothing asserts on the vectors themselves:
 * `icons.tsx` draws decoration, and `CountdownRing` hides its arc from the
 * accessibility tree because the screen announces the seconds in its own
 * sentence.
 */
jest.mock('react-native-svg', () => {
  // `require`, not an import: Jest hoists this factory above the import
  // block, so a module-scope `React` binding does not exist yet when it runs.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');

  const stub = (name: string) => {
    const Component = ({ children, ...props }: { children?: unknown }) =>
      React.createElement(name, props, children);

    Component.displayName = name;

    return Component;
  };

  const Svg = stub('Svg');

  return {
    __esModule: true,
    default: Svg,
    Svg,
    Circle: stub('Circle'),
    Ellipse: stub('Ellipse'),
    G: stub('G'),
    Line: stub('Line'),
    Path: stub('Path'),
    Polygon: stub('Polygon'),
    Polyline: stub('Polyline'),
    Rect: stub('Rect'),
    Text: stub('SvgText'),
    Defs: stub('Defs'),
    LinearGradient: stub('LinearGradient'),
    Stop: stub('Stop'),
    ClipPath: stub('ClipPath'),
    Mask: stub('Mask'),
  };
});

/*
 * The drawer's three native dependencies (ADR-0039's navigation restructure).
 *
 * `react-native-gesture-handler` ships its own Jest setup and needs calling —
 * without it every screen that mounts inside the drawer throws at import.
 * Reanimated is mocked rather than run: its worklets need a UI thread that
 * does not exist here, and the drawer's animation is not what any test in this
 * suite is asserting.
 */
require('react-native-gesture-handler/jestSetup');

jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');

  // The mock omits this and the drawer calls it on mount.
  Reanimated.default.call = () => undefined;

  return Reanimated;
});

// `expo-constants` backs `ui/version.ts`, which the drawer and two screens
// render. Mocked to a fixed version so a test asserting the footer does not
// change every time `app.json` does.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0' } },
}));

/*
 * `expo-image` throws at import under Jest — its observer integration reaches
 * for a browser API that is not there. Nothing had rendered it in a test
 * before the drawer, which draws the brand wordmark and the driver's
 * photograph, so this is the first suite to need it.
 *
 * Mocked as a plain `Image` rather than as null, so a test can still assert
 * that a photograph was rendered and with what source.
 */
jest.mock('expo-image', () => {
  const { Image } = require('react-native');

  return { Image, __esModule: true };
});

/*
 * `requestIdleCallback` / `cancelIdleCallback` are React Native runtime globals
 * that this environment does not provide.
 *
 * `OdometerScreen` uses them to raise the keypad once the modal's entry
 * animation is done — `autoFocus` fires mid-transition on Android and the
 * keyboard never comes up, which is a defect a driver reported as being unable
 * to enter the reading at all. React Native deprecated `InteractionManager`
 * and names these as the replacement.
 *
 * Polyfilled as a macrotask, which is the closest honest analogue under fake
 * timers: "after the work already queued". Deliberately *not* synchronous — a
 * focus that lands during render would be a different behaviour from the one
 * that ships, and the test would then be asserting something the device never
 * does.
 */
type IdleHandle = ReturnType<typeof setTimeout>;

globalThis.requestIdleCallback ??= ((callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void): IdleHandle =>
  setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 0)) as typeof globalThis.requestIdleCallback;

globalThis.cancelIdleCallback ??= ((handle: IdleHandle) =>
  clearTimeout(handle)) as typeof globalThis.cancelIdleCallback;
