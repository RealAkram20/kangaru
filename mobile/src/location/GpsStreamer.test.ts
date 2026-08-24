import * as Location from 'expo-location';

import { GpsStreamer } from './GpsStreamer';
import type { Ping } from './pings';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  watchPositionAsync: jest.fn(),
  Accuracy: { High: 4 },
}));

/**
 * The fix that broke the buffer.
 *
 * Expo types `speed`, `heading` and `accuracy` as `number | null`, and the
 * capture guarded them with `=== null`. A real Android fix omits them
 * entirely — the emulator does it constantly — so they arrive `undefined`,
 * walk past that check, and land in the arithmetic: `undefined * 3.6` is NaN,
 * and `typeof NaN` is `'number'`, so nothing in TypeScript objects.
 *
 * SQLite objects. Its binder cannot cast NaN and rejects the whole statement,
 * so a fix missing one optional field dropped the **entire ping** — and pings
 * are what ADR-0045 measures a trip's distance from. It surfaced in Sentry as
 * `NativeDatabase.prepareAsync has been rejected`, three layers from the cause.
 *
 * Asserted on what reaches the buffer rather than on the helpers, because the
 * helpers are private and the bug was in what `capture` handed to SQLite.
 */
async function captureReading(coords: Record<string, unknown>): Promise<Ping> {
  // A holder rather than a bare `let`: assigning inside the mock's callback
  // is invisible to the compiler, which then narrows the variable to `never`
  // and rejects the call below.
  const emitter: { current: ((reading: unknown) => void) | null } = { current: null };

  (Location.watchPositionAsync as jest.Mock).mockImplementation(
    async (_options: unknown, callback: (reading: unknown) => void) => {
      emitter.current = callback;

      return { remove: jest.fn() };
    },
  );

  const recorded: Ping[] = [];
  const buffer = {
    record: jest.fn(async (_tripId: number, ping: Ping) => {
      recorded.push(ping);
    }),
    nextBatch: jest.fn(async () => null),
    discard: jest.fn(async () => undefined),
  };

  const streamer = new GpsStreamer({
    api: { request: jest.fn() } as never,
    buffer: buffer as never,
  });

  await streamer.start(7);

  emitter.current?.({
    coords,
    timestamp: Date.parse('2026-08-24T08:00:00.000Z'),
    mocked: false,
  });

  // `capture` is fire-and-forget (`void this.capture(...)`), so let its
  // microtasks settle before reading what the buffer was handed.
  await new Promise<void>((resolve) => setImmediate(() => resolve()));

  // Stops the flush interval — a live timer here strands the whole suite.
  await streamer.stop();

  const ping = recorded[0];

  if (ping === undefined) {
    throw new Error('The streamer recorded no ping — the reading never reached capture().');
  }

  return ping;
}

const KAMPALA = { latitude: 0.3476, longitude: 32.5825 };

it('records nulls, not NaN, when the fix omits speed, heading and accuracy', async () => {
  const ping = await captureReading(KAMPALA);

  expect(ping.speedKph).toBeNull();
  expect(ping.headingDegrees).toBeNull();
  expect(ping.accuracyMetres).toBeNull();

  // The assertion that actually catches it: NaN is `typeof number`, so a
  // `toBeNull()` alone would still pass a value SQLite refuses to bind.
  expect(Number.isNaN(ping.speedKph as number)).toBe(false);
  expect(Number.isNaN(ping.headingDegrees as number)).toBe(false);
  expect(Number.isNaN(ping.accuracyMetres as number)).toBe(false);
});

it('still keeps the figures a fix does report', async () => {
  const ping = await captureReading({
    ...KAMPALA,
    speed: 10, // m/s
    heading: 119.6,
    accuracy: 8.25,
  });

  expect(ping.speedKph).toBe(36); // 10 m/s -> 36 km/h
  expect(ping.headingDegrees).toBe(120);
  expect(ping.accuracyMetres).toBe(8.3);
});

it('still reports null for the platform\'s "unknown" heading of -1', async () => {
  const ping = await captureReading({ ...KAMPALA, heading: -1, speed: null, accuracy: null });

  expect(ping.headingDegrees).toBeNull();
});
