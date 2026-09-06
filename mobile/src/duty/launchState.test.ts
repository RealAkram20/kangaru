import { shouldEndShiftOnLaunch } from './launchState';

/**
 * Whether a shift the app did not start should survive the app starting.
 *
 * Three states, and each one is a different way of being wrong to a driver:
 * leaving a lie on screen, ending a real shift, or ending one on a guess.
 */

it('ends a shift the handset is definitely not doing', () => {
  /*
   * **The observed bug.** The server says on duty, `startLocationUpdatesAsync`
   * has never been called this process, so there is no foreground service and
   * no heartbeat — yet the toggle read "Go Offline". The demo driver sat in
   * exactly this state with a position four and a half hours old.
   */
  expect(shouldEndShiftOnLaunch({ serverSaysOnDuty: true, serviceRunning: false })).toBe(true);
});

it('leaves a running shift alone', () => {
  /*
   * The app was backgrounded and came back, or the service survived. Nothing to
   * reconcile — and ending this would take a working driver off the road.
   */
  expect(shouldEndShiftOnLaunch({ serverSaysOnDuty: true, serviceRunning: true })).toBe(false);
});

it('does nothing when the driver is already off duty', () => {
  expect(shouldEndShiftOnLaunch({ serverSaysOnDuty: false, serviceRunning: false })).toBe(false);
  expect(shouldEndShiftOnLaunch({ serverSaysOnDuty: false, serviceRunning: null })).toBe(false);
});

it('never ends a shift on a guess', () => {
  /*
   * `null` is Expo Go, or a task registry that would not answer. Ending a real
   * shift because the app could not find out is the expensive direction to be
   * wrong in — a driver mid-job is signed off by an app that was unsure.
   *
   * Mutation check: change `serviceRunning === false` to `!serviceRunning` and
   * this fails.
   */
  expect(shouldEndShiftOnLaunch({ serverSaysOnDuty: true, serviceRunning: null })).toBe(false);
});
