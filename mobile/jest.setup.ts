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
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
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
