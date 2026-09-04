import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Location from 'expo-location';

import { readShift } from '../duty/dutyStore';
import { readFullScreenIntentGranted } from '../push/fullScreenIntent';
import { readPermissionStates, readReliability } from './readState';

/**
 * Reading the two facts no permission reports.
 *
 * The whole risk here is **blaming the handset for the runtime**. Every read in
 * this file crosses into native code that behaves differently in Expo Go, on a
 * simulator and on a driver's phone, and the failure that matters is not a
 * crash — it is a confident, wrong sentence on a screen.
 */

jest.mock('../duty/dutyStore', () => ({
  readShift: jest.fn(),
}));

// The native read behind the lock-screen row. Replaced per test so each of its
// three answers — held, refused, unreadable — reaches the screen unchanged.
jest.mock('../push/fullScreenIntent', () => ({
  readFullScreenIntentGranted: jest.fn(() => null),
  fullScreenIntentIsGrantable: jest.fn(() => false),
  openFullScreenIntentSettings: jest.fn(async () => false),
}));

const mockShift = readShift as jest.MockedFunction<typeof readShift>;
const hasStarted = Location.hasStartedLocationUpdatesAsync as jest.MockedFunction<
  typeof Location.hasStartedLocationUpdatesAsync
>;

function onDuty() {
  mockShift.mockResolvedValue({ onDuty: true, vehicleId: 1, heartbeatSeconds: 60 });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Constants, 'executionEnvironment', ExecutionEnvironment.Bare);
});

it('does not ask about the service in Expo Go, and does not blame the phone', async () => {
  /*
   * **The bug this closes, observed rather than imagined.** In Expo Go
   * `hasStartedLocationUpdatesAsync` does not throw — it writes *"Background
   * location is limited in Expo Go: on Android, it is not available at all"* to
   * the console and answers false.
   *
   * So the first version of this reported `stopped`, and the screen told a
   * driver on duty that "this phone has stopped the app" when the service had
   * never been startable in that runtime at all.
   *
   * Asserting that the API is **not called** rather than only checking the
   * result: the console warning is part of the harm, and `observability.ts`
   * lets the first one per process through on purpose — one fired by this
   * screen on every open would drown the duty toggle's, which is the one worth
   * having.
   *
   * Mutation check: remove the `runsInExpoGo()` branch and this fails twice.
   */
  onDuty();
  jest.replaceProperty(Constants, 'executionEnvironment', ExecutionEnvironment.StoreClient);

  const live = await readReliability();

  expect(hasStarted).not.toHaveBeenCalled();
  expect(live.onlineService).toBe('unknown');
});

it('reports the service running on a real build', async () => {
  onDuty();
  hasStarted.mockResolvedValue(true);

  expect((await readReliability()).onlineService).toBe('running');
});

it('reports it stopped when the phone really has stopped it', async () => {
  /*
   * The state the whole reliability question turns on: on duty, a real build,
   * and the foreground service is not running. An OEM battery manager needs no
   * permission to produce this.
   */
  onDuty();
  hasStarted.mockResolvedValue(false);

  expect((await readReliability()).onlineService).toBe('stopped');
});

it('calls a finished shift off duty, never stopped', async () => {
  /*
   * Nothing runs when nobody has gone online. Reporting `stopped` here would put
   * a red warning on the screen of every driver who has finished for the day —
   * and it would never ask the OS, so the answer would be pure invention.
   */
  mockShift.mockResolvedValue({ onDuty: false, vehicleId: null, heartbeatSeconds: 60 });

  const live = await readReliability();

  expect(live.onlineService).toBe('off_duty');
  expect(hasStarted).not.toHaveBeenCalled();
});

it('reports the lock screen exactly as the platform answers', async () => {
  /*
   * The row this feeds used to say nothing, because nothing could read the
   * state. Now `modules/full-screen-intent` can, and the three answers have to
   * survive the trip to the screen without being reinterpreted: a refusal is
   * "missing", a grant is "granted", and *could not ask* is "unreadable" —
   * never "missing", which would tell a driver they refused something the app
   * never managed to look at.
   */
  const read = readFullScreenIntentGranted as jest.MockedFunction<typeof readFullScreenIntentGranted>;

  read.mockReturnValue(true);
  expect((await readPermissionStates()).lockScreen).toBe('granted');

  read.mockReturnValue(false);
  expect((await readPermissionStates()).lockScreen).toBe('missing');

  read.mockReturnValue(null);
  expect((await readPermissionStates()).lockScreen).toBe('unreadable');
});
