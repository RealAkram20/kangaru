import { OFFER_ACTION } from './callContent';
import { claimAnswer, NOTIFEE_EVENT, outcomeOf, resetClaimsForTest } from './offerEvent';

/**
 * What a press on the call notification means (ADR-0049 §6).
 *
 * The whole of the shade-answer path that can be reached from a test. What is
 * being defended is not a crash: it is answering a job the driver did not
 * answer, answering the wrong one, and answering twice.
 */

beforeEach(() => resetClaimsForTest());

describe('outcomeOf', () => {
  it('accepts when Accept was pressed', () => {
    expect(
      outcomeOf({
        type: NOTIFEE_EVENT.ACTION_PRESS,
        notificationId: 'offer-call-41',
        pressActionId: OFFER_ACTION.accept,
      }),
    ).toEqual({ kind: 'accept', offerId: 41 });
  });

  it('declines when Decline was pressed', () => {
    expect(
      outcomeOf({
        type: NOTIFEE_EVENT.ACTION_PRESS,
        notificationId: 'offer-call-7',
        pressActionId: OFFER_ACTION.decline,
      }),
    ).toEqual({ kind: 'decline', offerId: 7 });
  });

  it('opens the job when the body is tapped', () => {
    expect(outcomeOf({ type: NOTIFEE_EVENT.PRESS, notificationId: 'offer-call-41' })).toEqual({
      kind: 'open',
      offerId: 41,
    });
  });

  /**
   * A driver who swipes it away has said *not now*, or their sleeve has.
   * Turning that into a decline costs them a fare they never refused.
   */
  it('does not read a dismissal as a decline', () => {
    expect(
      outcomeOf({ type: NOTIFEE_EVENT.DISMISSED, notificationId: 'offer-call-41' }),
    ).toEqual({ kind: 'ignore' });
  });

  it('ignores a notification that is not an offer', () => {
    expect(
      outcomeOf({
        type: NOTIFEE_EVENT.ACTION_PRESS,
        notificationId: 'trip-assigned-9',
        pressActionId: OFFER_ACTION.accept,
      }),
    ).toEqual({ kind: 'ignore' });
  });

  /**
   * A button from a build that is no longer installed. Opening shows the
   * driver the job and lets them decide; guessing would answer for them.
   */
  it('opens rather than guesses when the button is unrecognised', () => {
    expect(
      outcomeOf({
        type: NOTIFEE_EVENT.ACTION_PRESS,
        notificationId: 'offer-call-41',
        pressActionId: 'offer.snooze.from.a.future.build',
      }),
    ).toEqual({ kind: 'open', offerId: 41 });
  });

  it('ignores delivery, which is not an answer', () => {
    expect(
      outcomeOf({ type: NOTIFEE_EVENT.DELIVERED, notificationId: 'offer-call-41' }),
    ).toEqual({ kind: 'ignore' });
  });
});

describe('claimAnswer', () => {
  /**
   * **The double-accept, which is not hypothetical.** Accept launches the app,
   * so notifee reports the press through the event stream *and* through
   * `getInitialNotification()` on the start it caused. Two reports mean two
   * `POST /me/offers/41/acceptance` calls — and the second one's rejection is
   * what puts "somebody else took it" in front of the driver who just took it.
   */
  it('lets one accept through and refuses the replay', () => {
    const accept = { kind: 'accept', offerId: 41 } as const;

    expect(claimAnswer(accept)).toBe(true);
    expect(claimAnswer(accept)).toBe(false);
  });

  it('keeps different jobs apart', () => {
    expect(claimAnswer({ kind: 'accept', offerId: 41 })).toBe(true);
    expect(claimAnswer({ kind: 'accept', offerId: 42 })).toBe(true);
  });

  /**
   * A driver who declines and is then offered the same job again in a later
   * wave must be able to answer it. Accept and decline are separate claims for
   * that reason, not one "answered" flag per offer.
   */
  it('keeps accept and decline apart for the same job', () => {
    expect(claimAnswer({ kind: 'decline', offerId: 41 })).toBe(true);
    expect(claimAnswer({ kind: 'accept', offerId: 41 })).toBe(true);
  });

  it('never blocks opening, which is idempotent', () => {
    expect(claimAnswer({ kind: 'open', offerId: 41 })).toBe(true);
    expect(claimAnswer({ kind: 'open', offerId: 41 })).toBe(true);
  });
});

/**
 * `offerEvent.ts` carries its own copy of notifee's `EventType` because it
 * must stay importable without the native module. A copy that drifts is a
 * handler that reads an action press as a dismissal — silent, and it would
 * look exactly like the buttons not working.
 */
describe('the transcribed EventType', () => {
  it('matches the library', () => {
    // Required rather than imported: a top-level import would put the native
    // module in this file's graph, which is the thing `offerEvent.ts` is
    // written to avoid and which the mock only papers over.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
    const { EventType } = require('react-native-notify-kit');

    expect(NOTIFEE_EVENT.DISMISSED).toBe(EventType.DISMISSED);
    expect(NOTIFEE_EVENT.PRESS).toBe(EventType.PRESS);
    expect(NOTIFEE_EVENT.ACTION_PRESS).toBe(EventType.ACTION_PRESS);
    expect(NOTIFEE_EVENT.DELIVERED).toBe(EventType.DELIVERED);
  });
});
