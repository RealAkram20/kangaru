import {
  backgroundLocationIsAskable,
  blockingJobs,
  blockingSummary,
  statusLabel,
  statusTone,
  type PermissionStates,
} from './permissions';

/**
 * The counting behind the Permissions screen.
 *
 * Every test here stands for a way of lying to a driver: telling them something
 * is broken when it is not, telling them everything is fine when a job cannot
 * reach them, or shouting twice about one tap.
 */

function states(overrides: Partial<PermissionStates> = {}): PermissionStates {
  return {
    notifications: 'granted',
    locationWhenInUse: 'granted',
    locationAlways: 'granted',
    battery: 'unreadable',
    lockScreen: 'unreadable',
    camera: 'granted',
    ...overrides,
  };
}

it('says nothing when nothing is wrong', () => {
  /*
   * Null, not "All good". A screen that congratulates a driver every time they
   * open it spends their attention on the one state that needs none.
   */
  expect(blockingSummary(states())).toBeNull();
  expect(blockingJobs(states())).toEqual([]);
});

it('never counts a permission it cannot read', () => {
  /*
   * **The rule the whole screen is built around.** `USE_FULL_SCREEN_INTENT` and
   * the battery exemption have no readable state in this stack —
   * `fullScreenIntent.ts` argues that at length. Counting them as missing would
   * tell a driver whose phone is perfectly set up that two things are broken,
   * every time they opened the screen, forever.
   *
   * **Asserted against a permission that IS offer-critical**, and the first
   * version of this test was not. It passed `battery` and `lockScreen` as
   * `unreadable` and expected an empty list — which those two produce whatever
   * the predicate says, because neither is in `OFFER_CRITICAL`. The list was
   * protecting the test, not the rule. It survived the mutation below, which is
   * the definition of a guard that is not one.
   *
   * `notifications` is the honest subject: it is counted, so if the predicate
   * ever widens from "missing" to "not granted", this is what catches it. That
   * matters most on the day somebody adds `lockScreen` to `OFFER_CRITICAL` —
   * a reasonable-looking change that would start counting a state nothing can
   * read.
   *
   * Mutation check: change `states[key] === 'missing'` in `blockingJobs` to
   * `states[key] !== 'granted'` and this fails. Verified.
   */
  expect(blockingJobs(states({ notifications: 'unreadable' }))).toEqual([]);
  expect(blockingSummary(states({ notifications: 'unreadable' }))).toBeNull();

  // And the two that genuinely are unreadable today stay out of the count.
  expect(blockingJobs(states({ battery: 'unreadable', lockScreen: 'unreadable' }))).toEqual([]);
});

it('does not count the camera, because it costs nobody a fare', () => {
  /*
   * An odometer photograph is evidence for a trip already accepted. A driver
   * who declined it still gets every job, so a red badge here would be the
   * screen shouting about something that stops no work.
   */
  expect(blockingJobs(states({ camera: 'missing' }))).toEqual([]);
});

it('names the permissions that really are stopping jobs', () => {
  expect(blockingJobs(states({ notifications: 'missing' }))).toEqual(['notifications']);
  expect(blockingSummary(states({ notifications: 'missing' }))).toBe(
    '1 permission below is stopping jobs reaching you.',
  );
});

it('counts more than one, and says so in figures', () => {
  const two = states({ notifications: 'missing', locationAlways: 'missing' });

  expect(blockingJobs(two)).toEqual(['notifications', 'locationAlways']);
  expect(blockingSummary(two)).toBe(
    '2 permissions below are stopping jobs reaching you.',
  );
});

it('shouts once about one tap, not twice', () => {
  /*
   * A driver who has not granted while-using cannot be offered "all the time" —
   * Android will not show it. That is **one** problem with one fix, and listing
   * the consequence beside the cause would have the screen report two.
   *
   * Mutation check: include `'blocked'` alongside `'missing'` in `blockingJobs`
   * and this fails.
   */
  const cascade = states({ locationWhenInUse: 'missing', locationAlways: 'blocked' });

  expect(blockingJobs(cascade)).toEqual(['locationWhenInUse']);
  expect(blockingSummary(cascade)).toBe(
    '1 permission below is stopping jobs reaching you.',
  );
});

it('will not offer "all the time" before while-using is held', () => {
  /*
   * Android's rule, not ours. A row that opens a settings screen where the
   * promised option does not exist is a dead end that teaches a driver the app
   * is broken.
   */
  expect(backgroundLocationIsAskable('granted')).toBe(true);
  expect(backgroundLocationIsAskable('missing')).toBe(false);
  expect(backgroundLocationIsAskable('blocked')).toBe(false);
  expect(backgroundLocationIsAskable('unreadable')).toBe(false);
});

it('shows no status word for a permission it cannot read', () => {
  /*
   * The row carries an action and makes no claim about state. Any word here —
   * including a hopeful one — would be wrong on half the handsets in the fleet.
   */
  expect(statusLabel('unreadable')).toBeNull();
  expect(statusLabel('granted')).toBe('Allowed');
  expect(statusLabel('missing')).toBe('Not allowed');
  expect(statusLabel('blocked')).toBe('Needs the one above');
});

it('never carries meaning by colour alone', () => {
  /*
   * `docs/screen-rules.md` §6. Every tone below is paired with a word from
   * `statusLabel`, and the two states that share the muted tone are told apart
   * by that word rather than by the colour. In direct sun on a cradle, the word
   * is what survives.
   */
  const toned: Parameters<typeof statusTone>[0][] = ['granted', 'missing', 'blocked'];

  for (const status of toned) {
    expect(statusTone(status)).toBeTruthy();
    expect(statusLabel(status)).toBeTruthy();
  }

  // The one exception, and it is the honest one: no colour claim either.
  expect(statusTone('unreadable')).toBe('muted');
  expect(statusLabel('unreadable')).toBeNull();
});
