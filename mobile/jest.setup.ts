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

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true })),
  MediaTypeOptions: { Images: 'Images' },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000000'),
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
