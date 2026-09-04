import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react-native';
import * as Location from 'expo-location';

import type { DriverPresence } from '../api/types';
import { PresenceController } from './PresenceController';

/**
 * The heartbeat's answer must reach the duty cache.
 *
 * The first test this controller has had, and it covers the one thing the
 * timer itself cannot be wrong about but the screen can: the server's reply
 * to a heartbeat carries a fresh `dispatchable`, and `useDuty` has no poll
 * of its own. If the reply is dropped, "Waiting for a location fix" stays on
 * the Work screen after the server has started offering the driver work —
 * which is the exact state the warning exists to report honestly.
 */

const mockSendPresence = jest.fn();
const mockFetchDuty = jest.fn();
const mockSetDuty = jest.fn();
jest.mock('../api/endpoints', () => ({
  sendPresence: (...args: unknown[]) => mockSendPresence(...args),
  fetchDuty: (...args: unknown[]) => mockFetchDuty(...args),
  // Reached only by the launch reconciler below — a shift the app is not
  // actually running is ended through this.
  setDuty: (...args: unknown[]) => mockSetDuty(...args),
}));
// One client object for the whole file. `api` is a dependency of the
// heartbeat effect, and a fresh `{}` per render would restart the timer on
// every re-render — a second heartbeat the real app, whose client is stable,
// would never send.
const API = {};
jest.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ api: API }) }));

/*
 * **The foreground service is running for every test in this file**, and
 * saying so is load-bearing.
 *
 * `PresenceController` now ends a shift on launch when the server says on duty
 * and `hasStartedLocationUpdatesAsync` says the service is not running — the
 * cold-start state that used to leave a driver reading "You are online" with no
 * heartbeat behind it (`launchState.ts`). The shared mock in `jest.setup.ts`
 * answers **false**, which is that exact state, so without this every heartbeat
 * test here would be reconciled off duty before it could send anything.
 *
 * A heartbeat test is by definition a driver whose service *is* running, so
 * true is the honest fixture rather than a convenience. `launchState.test.ts`
 * covers the reconciling itself.
 */
(Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValue(true);

const STALE: DriverPresence = {
  driver_id: 15,
  on_duty: true,
  vehicle_id: 19,
  latitude: 0.3951,
  longitude: 32.703,
  recorded_at: '2026-08-18T23:21:42Z',
  dispatchable: false,
  position_age_seconds: 76_000,
  heartbeat_seconds: 60,
};

const FRESH: DriverPresence = {
  ...STALE,
  recorded_at: '2026-08-19T20:37:13Z',
  dispatchable: true,
  position_age_seconds: 0,
};

// RTL v14's `render` is async, and the heartbeat is four awaits deep
// (permission, fix, request, cache) before it writes anything — one flushed
// microtask is not enough. Fake timers keep the sixty-second interval from
// outliving the test, and `advanceTimersByTimeAsync(0)` drains the microtask
// queue between each await without letting the interval fire.
async function mount(client: QueryClient) {
  const view = await render(
    <QueryClientProvider client={client}>
      <PresenceController />
    </QueryClientProvider>,
  );
  mounted.push(view);
  return view;
}

async function flush() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
}

const mounted: { unmount: () => void | Promise<void> }[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  // The query's own refetch on mount returns what is already cached, so the
  // only thing that can change `dispatchable` in these tests is the heartbeat.
  mockFetchDuty.mockImplementation(async () => STALE);
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
    status: 'granted',
    granted: true,
  });
});

afterEach(async () => {
  for (const view of mounted.splice(0)) {
    await view.unmount();
  }
  jest.useRealTimers();
});

it('replaces the cached duty record with the heartbeat answer', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['duty'], STALE);
  mockSendPresence.mockResolvedValue(FRESH);

  await mount(client);
  await flush();

  expect(mockSendPresence).toHaveBeenCalledTimes(1);
  expect(client.getQueryData<DriverPresence>(['duty'])?.dispatchable).toBe(true);
});

it('leaves the cache alone when the answer lands after unmount', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['duty'], STALE);

  let resolve: (value: DriverPresence) => void = () => undefined;
  mockSendPresence.mockReturnValue(
    new Promise<DriverPresence>((r) => {
      resolve = r;
    }),
  );

  const view = await mount(client);
  await flush();
  expect(mockSendPresence).toHaveBeenCalledTimes(1);
  await view.unmount();

  resolve(FRESH);
  await flush();

  // A reply that arrives after the driver has gone off duty or signed out
  // describes a shift that is over; writing it back would re-light the card.
  expect(client.getQueryData<DriverPresence>(['duty'])).toEqual(STALE);
});

it('sends nothing, and writes nothing, while off duty', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['duty'], { ...STALE, on_duty: false });

  await mount(client);
  await flush();

  expect(mockSendPresence).not.toHaveBeenCalled();
  expect(client.getQueryData<DriverPresence>(['duty'])?.dispatchable).toBe(false);
});

it('treats a handset with no fix as a quiet no-op, not an unhandled rejection', async () => {
  // `getCurrentPositionAsync` **throws** when there is no position — indoors,
  // a tunnel, location switched off mid-shift — while `reportPresence` awaits
  // `getFix()` outside any try/catch, because its contract is
  // `Promise<PresenceFix | null>` and it has a `no_fix` outcome documented as
  // "a basement".
  //
  // Unguarded, that rejection travelled out of the heartbeat and landed in
  // front of the driver as a red error card, once a minute:
  // "Current location is unavailable. Make sure that location services are
  // enabled". Seen on the emulator; the handset case is the real one.
  const rejections: unknown[] = [];
  const onRejection = (error: unknown) => rejections.push(error);

  (Location.getCurrentPositionAsync as jest.Mock).mockRejectedValue(
    new Error('Current location is unavailable. Make sure that location services are enabled'),
  );

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['duty'], STALE);

  process.on('unhandledRejection', onRejection);

  try {
    await mount(client);
    await flush();
    await flush();

    // Nothing was sent — there was nothing to send.
    expect(mockSendPresence).not.toHaveBeenCalled();
    // And the cached record is untouched: a missing fix is not news about
    // duty, so it must not overwrite what the server last said.
    expect(client.getQueryData(['duty'])).toEqual(STALE);
    // The point of the test.
    expect(rejections).toHaveLength(0);
  } finally {
    process.off('unhandledRejection', onRejection);
  }
});

it('still sends the heartbeat once a fix comes back', async () => {
  // The other half: recovering from a basement must not need a restart.
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
    coords: { latitude: 0.3476, longitude: 32.5825, accuracy: 12 },
    timestamp: 1_770_000_000_000,
  });
  mockSendPresence.mockResolvedValue(FRESH);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['duty'], STALE);

  await mount(client);
  await flush();
  await flush();

  expect(mockSendPresence).toHaveBeenCalled();
});
