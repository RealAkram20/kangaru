import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';

import { canReceivePush, pushUnavailableReason } from './expoNotifications';

/**
 * Whether this build can be pushed to, and — the part that is new — *why not*.
 *
 * ## Why a boolean was not enough, stated as the bug it caused
 *
 * `canReceivePush()` answered *whether*. Every caller read a false as "carry
 * on quietly", which is correct for the driver and was catastrophic for the
 * office: the whole fleet ran in Expo Go, no handset ever registered a push
 * token, `device_tokens` stayed empty, and thirty-eight job offers were
 * dispatched with nothing to send them to. Every guard behaved exactly as
 * designed and nothing anywhere said so.
 *
 * A reason can be reported and a boolean cannot. `expo_go` says a development
 * build is missing — a fact about the build, fixed for the process, and the
 * one that takes the foreground service and the call notification down with
 * it. `simulator` is an ordinary desk and must never read as a fleet outage.
 */

it('names Expo Go as the reason, because it is the one that means a missing build', () => {
  jest.replaceProperty(Constants, 'executionEnvironment', ExecutionEnvironment.StoreClient);

  // A real handset, so nothing else can be what is refusing. Without this the
  // test would pass on the simulator branch and prove nothing.
  jest.replaceProperty(Device, 'isDevice', true);

  expect(pushUnavailableReason()).toBe('expo_go');
});

it('names Expo Go ahead of the simulator when a run is both', () => {
  /*
   * Expo Go on an emulator is the commonest development setup in this project,
   * and the order matters: `simulator` reads as "your desk", `expo_go` reads
   * as "nobody in the field can receive a job". Reporting the weaker of the
   * two would understate a fleet-wide outage as a local quirk.
   */
  jest.replaceProperty(Constants, 'executionEnvironment', ExecutionEnvironment.StoreClient);
  jest.replaceProperty(Device, 'isDevice', false);

  expect(pushUnavailableReason()).toBe('expo_go');
});

it('names the simulator when the build itself is fine', () => {
  jest.replaceProperty(Constants, 'executionEnvironment', ExecutionEnvironment.Bare);
  jest.replaceProperty(Device, 'isDevice', false);

  expect(pushUnavailableReason()).toBe('simulator');
});

it('refuses nothing on a development build running on a real handset', () => {
  jest.replaceProperty(Constants, 'executionEnvironment', ExecutionEnvironment.Bare);
  jest.replaceProperty(Device, 'isDevice', true);

  expect(pushUnavailableReason()).toBeNull();
});

it('keeps `canReceivePush` answering exactly what it always did', () => {
  /*
   * The reason is additive; the boolean is unchanged. `notifyKit.ts`,
   * `channels.ts` and `loadNotifications` all still ask the *whether*
   * question and none of them has anywhere to report a reason to — so if this
   * ever stops tracking `pushUnavailableReason() === null`, three guards start
   * disagreeing about what "this handset does notifications" means.
   */
  jest.replaceProperty(Constants, 'executionEnvironment', ExecutionEnvironment.StoreClient);
  jest.replaceProperty(Device, 'isDevice', true);
  expect(canReceivePush()).toBe(false);

  jest.replaceProperty(Constants, 'executionEnvironment', ExecutionEnvironment.Bare);
  jest.replaceProperty(Device, 'isDevice', true);
  expect(canReceivePush()).toBe(true);
});
