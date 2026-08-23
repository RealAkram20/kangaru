import { askFirstRunPermissions, FIRST_RUN_ORDER, type FirstRunPermission } from './firstRun';

/**
 * Asking for everything once, on the first launch.
 *
 * Android shows each of these dialogs **once, ever**. So every rule here is
 * about not wasting that one chance: asking in an order the platform will
 * honour, one at a time, and not stopping at the first refusal.
 */

/** Records the order asks arrived in, answering from a script. */
function recorder(answers: Partial<Record<FirstRunPermission, boolean>> = {}) {
  const asked: FirstRunPermission[] = [];

  return {
    asked,
    ask: async (permission: FirstRunPermission) => {
      asked.push(permission);

      return answers[permission] ?? true;
    },
  };
}

it('asks for notifications first, because that is what a job arrives on', () => {
  expect(FIRST_RUN_ORDER[0]).toBe('notifications');
});

it('asks while-using before all-the-time, because Android will not offer it otherwise', () => {
  /*
   * **Android's rule, not ours.** "Allow all the time" is not offered until the
   * foreground permission is held. Asked first it is refused silently — and the
   * one dialog Android would ever have shown is spent on a question that could
   * not have succeeded.
   *
   * Mutation check: swap the two in `FIRST_RUN_ORDER` and this fails.
   */
  expect(FIRST_RUN_ORDER.indexOf('locationWhenInUse')).toBeLessThan(
    FIRST_RUN_ORDER.indexOf('locationAlways'),
  );
});

it('asks one at a time, in order', async () => {
  /*
   * Never `Promise.all`. Android shows one permission dialog at a time and
   * drops the rest, so three of four would be silently refused without the
   * driver seeing them.
   */
  const { ask, asked } = recorder();

  await askFirstRunPermissions(ask);

  expect(asked).toEqual([...FIRST_RUN_ORDER]);
});

it('keeps going after a refusal', async () => {
  /*
   * A driver who says no to the camera still needs to be asked about location.
   * Treating the first no as fatal would leave the rest unasked — and
   * unaskable, since Android only offers each dialog once.
   */
  const { ask, asked } = recorder({ notifications: false });

  const granted = await askFirstRunPermissions(ask);

  expect(asked).toContain('camera');
  expect(granted.notifications).toBe(false);
  expect(granted.camera).toBe(true);
});

it('does not waste the all-the-time dialog when while-using was refused', async () => {
  /*
   * The one refusal that *should* stop the next ask, because Android would
   * refuse it anyway without showing anything. The Permissions screen carries
   * it instead, where the driver can grant the prerequisite first.
   *
   * Mutation check: remove the `break` and this fails — `locationAlways` gets
   * asked, spending a dialog that could not succeed.
   */
  const { ask, asked } = recorder({ locationWhenInUse: false });

  const granted = await askFirstRunPermissions(ask);

  expect(asked).not.toContain('locationAlways');
  expect(granted.locationAlways).toBe(false);
});

it('returns the same shape however the sequence ended', async () => {
  /*
   * A caller reading `granted.camera` must not get `undefined` because the
   * sequence broke early — an absent key and a refusal are different things to
   * anything that counts them.
   */
  const { ask } = recorder({ locationWhenInUse: false });

  const granted = await askFirstRunPermissions(ask);

  for (const permission of FIRST_RUN_ORDER) {
    expect(typeof granted[permission]).toBe('boolean');
  }
});

it('treats a throwing ask as a refusal rather than stopping', async () => {
  /*
   * A native module that is absent — Expo Go, a simulator — must not take the
   * rest of the sequence down with it.
   */
  const asked: FirstRunPermission[] = [];
  const ask = async (permission: FirstRunPermission) => {
    asked.push(permission);

    if (permission === 'notifications') {
      throw new Error('no notifications module on this build');
    }

    return true;
  };

  const granted = await askFirstRunPermissions(ask);

  expect(granted.notifications).toBe(false);
  expect(asked).toContain('camera');
});
