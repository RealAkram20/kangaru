import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, type TextInput } from 'react-native';
import { createRef } from 'react';

import { Field } from './components';

/**
 * `Field`'s reveal control.
 *
 * Tested at the component rather than on one screen, because the owner's
 * instruction was "for all the places that require a password" — a test on
 * `PasswordScreen` would prove three call sites and say nothing about the
 * next one somebody writes.
 *
 * The behaviour that matters is narrow and easy to get subtly wrong:
 *
 * - Revealing must actually stop masking the text.
 * - The control must not appear on a field that is not a password, where it
 *   would toggle nothing.
 * - Revealing must win over the caller's own `secureTextEntry`, rather than
 *   depending on prop order at the call site.
 */

it('starts hidden, because shoulders exist', async () => {
  const screen = await render(
    <Field
      label="Current password"
      secureTextEntry
      revealable
      value="hunter2"
      onChangeText={() => {}}
    />,
  );

  expect(screen.getByLabelText('Current password').props.secureTextEntry).toBe(true);
  expect(screen.getByLabelText('Show password')).toBeTruthy();
});

it('stops masking the text when revealed, and offers to hide it again', async () => {
  const screen = await render(
    <Field
      label="New password"
      secureTextEntry
      revealable
      value="hunter2"
      onChangeText={() => {}}
    />,
  );

  await fireEvent.press(screen.getByLabelText('Show password'));

  // The assertion is on the input's own prop, not on the button's label. A
  // toggle that flipped its icon without unmasking the field would pass a
  // label-only check and fail the driver squinting at it in the sun.
  expect(screen.getByLabelText('New password').props.secureTextEntry).toBe(false);
  expect(screen.getByLabelText('Hide password')).toBeTruthy();
});

it('hides it again on a second press', async () => {
  const screen = await render(
    <Field
      label="New password"
      secureTextEntry
      revealable
      value="hunter2"
      onChangeText={() => {}}
    />,
  );

  await fireEvent.press(screen.getByLabelText('Show password'));
  await fireEvent.press(screen.getByLabelText('Hide password'));

  expect(screen.getByLabelText('New password').props.secureTextEntry).toBe(true);
});

it('offers no toggle on a field that is not a password', async () => {
  // `revealable` on a plain text input would render a control that toggles
  // nothing — a button that does not do anything is worse than no button.
  const screen = await render(
    <Field label="Odometer reading" revealable value="120450" onChangeText={() => {}} />,
  );

  expect(screen.queryByLabelText('Show password')).toBeNull();
});

it('offers no toggle on a password field that did not ask for one', async () => {
  const screen = await render(
    <Field label="Current password" secureTextEntry value="hunter2" onChangeText={() => {}} />,
  );

  expect(screen.queryByLabelText('Show password')).toBeNull();
  expect(screen.getByLabelText('Current password').props.secureTextEntry).toBe(true);
});

// -- The `style` prop, which used to delete the field ----------------------

it('keeps the field looking like a field when a caller restyles it', async () => {
  // Found from a driver's report — *"i failed to enter the odometer on this
  // page"*. `style` sat before the prop spread, so a caller passing one
  // replaced the whole base look: no border, no background, no padding, just a
  // run of text. `OdometerScreen` had been that way all along and it only
  // became unusable when its placeholder was removed, at which point the field
  // was invisible and there was nothing on screen to type into.
  const { getByLabelText } = await render(
    <Field
      label="Kilometres"
      value=""
      onChangeText={() => undefined}
      style={{ fontSize: 34, minHeight: 68 }}
    />,
  );

  const resolved = StyleSheet.flatten(getByLabelText('Kilometres').props.style);

  // The box the base style owns, which a caller must not be able to remove by
  // accident. Asserted by property rather than by snapshot: a snapshot here
  // would go green on any of these silently becoming undefined.
  expect(resolved.borderWidth).toBe(1);
  expect(resolved.backgroundColor).toBeDefined();
  expect(resolved.paddingHorizontal).toBeGreaterThan(0);

  // And the caller still wins where it asked to.
  expect(resolved.fontSize).toBe(34);
  expect(resolved.minHeight).toBe(68);
});

it('forwards a ref to the input, so a screen can focus it itself', async () => {
  // The enabling half of `OdometerScreen`'s keypad fix. `autoFocus` fires
  // during a modal's entry animation on Android and the keyboard never comes
  // up — reproduced on a device, and reported by a driver as being unable to
  // enter the reading at all. The screen defers a real `focus()` call instead,
  // which it can only do if this ref arrives.
  //
  // Guarded here rather than on the screen because losing the forward would
  // break the keypad silently: nothing throws, the field simply never focuses.
  const ref = createRef<TextInput>();

  await render(<Field ref={ref} label="Kilometres" value="" onChangeText={() => undefined} />);

  expect(ref.current).not.toBeNull();
  expect(typeof ref.current?.focus).toBe('function');
});
