import { fireEvent, render } from '@testing-library/react-native';

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
