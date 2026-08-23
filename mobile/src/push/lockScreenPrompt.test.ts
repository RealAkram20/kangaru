import { shouldAskForLockScreen } from './lockScreenPrompt';

/**
 * When a driver is asked for the permission that puts a job on a locked phone.
 *
 * Two ways to get this wrong, and both are the kind a driver notices and the
 * office does not: asking somebody who already holds the permission, and asking
 * the same person on every shift.
 */

it('asks a driver on Android 14 or above who has not been asked', () => {
  expect(shouldAskForLockScreen(true, false)).toBe(true);
});

it('never asks twice', () => {
  /*
   * **Nothing in this stack can read whether the permission was granted** —
   * `canUseFullScreenIntent()` is exposed by neither `expo-notifications` nor
   * `react-native-notify-kit`. So a driver who said yes and one who said no are
   * indistinguishable from here, and asking again would nag every driver who
   * already granted it, every shift. An app that nags about a permission is one
   * whose notifications get switched off in Android's own settings, where the
   * office cannot see it.
   *
   * The Profile row is the permanent door. Mutation check: drop `!alreadyAsked`
   * and this fails.
   */
  expect(shouldAskForLockScreen(true, true)).toBe(false);
});

it('never asks on a handset that already holds the permission', () => {
  /*
   * Below Android 14 `USE_FULL_SCREEN_INTENT` is granted at install. Sending
   * that driver to a settings screen for something they already have is an
   * instruction that makes the app look broken.
   */
  expect(shouldAskForLockScreen(false, false)).toBe(false);
  expect(shouldAskForLockScreen(false, true)).toBe(false);
});
