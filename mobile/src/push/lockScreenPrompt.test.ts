import { ASK_AGAIN_AFTER_MS, shouldAskForLockScreen } from './lockScreenPrompt';

/**
 * When a driver is asked for the permission that puts a job on a locked phone.
 *
 * The ways to get this wrong are the kind a driver notices and the office does
 * not: asking somebody who already holds the permission, asking on every shift,
 * asking on Android 13 for a permission they were born with — and the one the
 * first version got wrong the other way, never asking again after a single
 * "Not now", so a driver who had not granted it could never learn why jobs only
 * ever arrived as a banner.
 */

const NOW = 1_700_000_000_000;
const AN_HOUR = 60 * 60 * 1000;

it('asks a driver on Android 14 or above who has never been asked', () => {
  expect(shouldAskForLockScreen(true, false, null, NOW)).toBe(true);
});

it('never asks a driver who already holds it', () => {
  /*
   * The whole point of reading the state. Under the once-ever rule this driver
   * and a refuser were indistinguishable; now one is left alone for good.
   * Mutation check: drop the `granted === true` branch and this fails.
   */
  expect(shouldAskForLockScreen(true, true, null, NOW)).toBe(false);
  expect(shouldAskForLockScreen(true, true, NOW - 10 * 24 * AN_HOUR, NOW)).toBe(false);
});

it('asks again after a day, not on the next tap', () => {
  /*
   * "Not now" has to mean something for a shift, and no more. Asked an hour
   * ago: quiet. Asked yesterday: the question comes back, because a driver who
   * has not granted it is still getting banners and still does not know why.
   * Mutation check: remove the interval and the first line fails.
   */
  expect(shouldAskForLockScreen(true, false, NOW - AN_HOUR, NOW)).toBe(false);
  expect(shouldAskForLockScreen(true, false, NOW - ASK_AGAIN_AFTER_MS, NOW)).toBe(true);
});

it('reads a once-ever install as asked long ago, so it is asked again', () => {
  /*
   * The migration. The first version stored `'1'`, which `Number` reads as
   * one millisecond after the epoch — long enough ago that a driver still
   * without the permission is asked under the rule that can see they said no.
   */
  expect(shouldAskForLockScreen(true, false, 1, NOW)).toBe(true);
});

it('falls back to once-ever where the state cannot be read', () => {
  /*
   * Expo Go, or a build without `modules/full-screen-intent`. A yes and a no
   * look the same there, so one ask is all that is safe — the old rule, for
   * the old reason. Mutation check: treat `null` like `false` and the second
   * line fails.
   */
  expect(shouldAskForLockScreen(true, null, null, NOW)).toBe(true);
  expect(shouldAskForLockScreen(true, null, NOW - 30 * ASK_AGAIN_AFTER_MS, NOW)).toBe(false);
});

it('never asks on a handset that already holds it at install', () => {
  /*
   * Below Android 14 `USE_FULL_SCREEN_INTENT` is granted at install. Sending
   * that driver to a settings screen for something they already have is an
   * instruction that makes the app look broken.
   */
  expect(shouldAskForLockScreen(false, false, null, NOW)).toBe(false);
  expect(shouldAskForLockScreen(false, null, null, NOW)).toBe(false);
});
