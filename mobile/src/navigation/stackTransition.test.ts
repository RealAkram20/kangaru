import { Platform } from 'react-native';

import { sheetAnimation, stackAnimation } from './stackTransition';

/**
 * The one decision behind every screen transition in the app.
 *
 * What can be wrong here is the kind a driver feels on every tap and the
 * office never sees: the stock Android fade coming back because a stack
 * stopped naming its animation, a sheet arriving like a page, or a driver
 * who asked the OS for less motion getting the full slide anyway.
 */

it('pushes from the right on Android — the designed motion, not the stock fade', () => {
  /*
   * `ios_from_right` is what react-native-screens implements natively on
   * Android: the new screen pushes in and the one beneath parallaxes. Leaving
   * this unset is what played the OEM's activity transition, which is the
   * whole complaint. Mutation check: return `'default'` for Android and this
   * fails.
   */
  jest.replaceProperty(Platform, 'OS', 'android');

  expect(stackAnimation(false)).toBe('ios_from_right');
});

it('leaves iOS on its own push, which already is that motion', () => {
  jest.replaceProperty(Platform, 'OS', 'ios');

  expect(stackAnimation(false)).toBe('default');
});

it('crossfades instead when the driver asked for less motion — gentler, not absent', () => {
  /*
   * `docs/screen-rules.md` §5. A fade still says the screen changed; it just
   * does not travel. Both platforms, because the native stack reads the OS
   * setting on neither by itself. Mutation check: drop the `reduceMotion`
   * branch and both lines fail.
   */
  jest.replaceProperty(Platform, 'OS', 'android');
  expect(stackAnimation(true)).toBe('fade');

  jest.replaceProperty(Platform, 'OS', 'ios');
  expect(stackAnimation(true)).toBe('fade');
});

it('brings a sheet up from the bottom, and fades it under reduced motion', () => {
  expect(sheetAnimation(false)).toBe('slide_from_bottom');
  expect(sheetAnimation(true)).toBe('fade');
});
