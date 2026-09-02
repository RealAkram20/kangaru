import { CALL_SURFACE } from './callNotification';
import { loadNotifications } from './expoNotifications';
import { dismissPlainPush } from './offerCall';

jest.mock('./expoNotifications', () => ({ loadNotifications: jest.fn() }));

/**
 * Withdrawing the plain push without taking the call screen down with it.
 *
 * ## The bug this exists to keep dead
 *
 * `dismissPlainPush` finds the row to withdraw by the offer it names. The call
 * notification names the same offer — that is deliberate, so a tap on either
 * routes the same way — and it is raised by `raiseOfferCall` immediately
 * before this runs. So the filter matched both, and the call screen was
 * cancelled about a second after being put up.
 *
 * What a driver saw: the phone rings, the screen wakes, and by the time they
 * look there is nothing to answer — only the plain heads-up, which cannot be
 * accepted. Every guard in the chain reported success: the headless task
 * logged `open_offer`, `showCallNotification` returned true, and the
 * dismissal was doing exactly what it was told.
 *
 * It was found in logcat, not in a suite, because nothing here was covered:
 *
 *     ReactNativeJS: 'offer.push_task', 'open_offer', 91, 'background'
 *     NotifAttentionHelper: No vibration for canceled notification 0|...
 *
 * A pure test over the presented-notification list is the cheapest place to
 * hold this, which is the rule `offerSurface.ts` already states: the suites
 * worth trusting in this app are TypeScript over injected values.
 */

/** A presented notification as `getPresentedNotificationsAsync` returns one. */
function presented(identifier: string, data: Record<string, unknown>) {
  return { request: { identifier, content: { data } } };
}

function mockPresented(items: ReturnType<typeof presented>[]) {
  const dismissNotificationAsync = jest.fn().mockResolvedValue(undefined);

  (loadNotifications as jest.Mock).mockResolvedValue({
    getPresentedNotificationsAsync: jest.fn().mockResolvedValue(items),
    dismissNotificationAsync,
  });

  return dismissNotificationAsync;
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('withdraws the plain push for the offer', async () => {
  const dismiss = mockPresented([presented('plain-91', { offer_id: '91' })]);

  await dismissPlainPush(91);

  expect(dismiss).toHaveBeenCalledWith('plain-91');
});

it('leaves the call screen up, though it names the same offer', async () => {
  /*
   * The regression. Both rows carry `offer_id: '91'`; only `surface`
   * separates them, and getting this wrong is invisible everywhere except on
   * a locked handset.
   */
  const dismiss = mockPresented([
    presented('plain-91', { offer_id: '91' }),
    presented('call-91', { offer_id: '91', surface: CALL_SURFACE }),
  ]);

  await dismissPlainPush(91);

  expect(dismiss).toHaveBeenCalledWith('plain-91');
  expect(dismiss).not.toHaveBeenCalledWith('call-91');
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it('leaves another job alone', async () => {
  // One driver can hold a second offer while the first is still ringing, and
  // withdrawing by offer id is the only thing keeping those apart.
  const dismiss = mockPresented([
    presented('plain-91', { offer_id: '91' }),
    presented('plain-92', { offer_id: '92' }),
  ]);

  await dismissPlainPush(91);

  expect(dismiss).toHaveBeenCalledWith('plain-91');
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it('does nothing when push is unavailable, rather than throwing into a headless task', async () => {
  // `offerPushTask` has no error boundary — see its docblock. A rejection
  // here would be a crash in a process the driver cannot see.
  (loadNotifications as jest.Mock).mockResolvedValue(null);

  await expect(dismissPlainPush(91)).resolves.toBeUndefined();
});
