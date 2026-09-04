import AsyncStorage from '@react-native-async-storage/async-storage';

import { forgetShift, readShift, rememberShift } from './dutyStore';

/**
 * The record the background task reads when there is no React tree above it.
 *
 * What is worth testing here is not the round trip — that is AsyncStorage's
 * job — but the **reading of a record written by a different version of this
 * app**. That file sits on disk across an update, and the task that reads it
 * runs unattended with the phone asleep, so a bad read is a heartbeat that
 * fails in a pocket and nowhere else.
 */

const KEY = 'kangaruride.driver.shift';

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('reads back what was written', async () => {
  await rememberShift({ onDuty: true, vehicleId: 7, heartbeatSeconds: 45 });

  expect(await readShift()).toEqual({ onDuty: true, vehicleId: 7, heartbeatSeconds: 45 });
});

it('reports off duty when nothing has ever been written', async () => {
  // The safe half of the choice: a task that reads this and stops costs a
  // driver one interval, and the foreground app rewrites the record within
  // seconds of being opened. The opposite default would have a signed-out
  // handset pinging the platform.
  expect(await readShift()).toEqual({ onDuty: false, vehicleId: null, heartbeatSeconds: 60 });
});

it('forgets the shift, so a shared handset does not report for the last driver', async () => {
  await rememberShift({ onDuty: true, vehicleId: 7, heartbeatSeconds: 45 });

  await forgetShift();

  expect(await readShift()).toMatchObject({ onDuty: false, vehicleId: null });
});

// -- Records written by another version of the app -------------------------

it('never yields a heartbeat of NaN, whatever is on disk', async () => {
  // The failure this prevents: `setInterval` with `NaN` milliseconds fires as
  // fast as the loop will go. A driver would discover it as a flat battery by
  // mid-morning, and no test that only writes well-formed records would see
  // it coming.
  await AsyncStorage.setItem(KEY, JSON.stringify({ onDuty: true }));

  const shift = await readShift();

  expect(shift.heartbeatSeconds).toBe(60);
  expect(Number.isFinite(shift.heartbeatSeconds)).toBe(true);
});

it('refuses a zero or negative heartbeat rather than passing it to the OS', async () => {
  await AsyncStorage.setItem(KEY, JSON.stringify({ onDuty: true, heartbeatSeconds: 0 }));

  expect((await readShift()).heartbeatSeconds).toBe(60);
});

it('treats a non-numeric vehicle as no vehicle, not as the string it found', async () => {
  // `vehicle_id` is nullable on the heartbeat and the server falls back to the
  // driver's default, so null is a real answer. Forwarding `"7"` would put a
  // string where the API contract says integer.
  await AsyncStorage.setItem(KEY, JSON.stringify({ onDuty: true, vehicleId: '7' }));

  expect((await readShift()).vehicleId).toBeNull();
});

it('treats a truthy-but-not-true duty flag as off duty', async () => {
  await AsyncStorage.setItem(KEY, JSON.stringify({ onDuty: 'yes' }));

  expect((await readShift()).onDuty).toBe(false);
});

it('survives a half-written record instead of throwing into the task', async () => {
  // An exception here escapes into an OS-invoked task with no `catch` above
  // it, which on Android is a crash the driver sees as the app vanishing.
  await AsyncStorage.setItem(KEY, '{"onDuty":true,');

  expect(await readShift()).toEqual({ onDuty: false, vehicleId: null, heartbeatSeconds: 60 });
});
