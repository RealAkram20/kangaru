import { pushDataFromTaskPayload } from './offerPushPayload';
import { intentFrom } from './routing';

/**
 * Reading a push out of a background task's payload.
 *
 * The failure guarded against here has **no symptom**. A parser that returns
 * null for the real shape produces a task that runs, decides "nothing to do",
 * and leaves the driver with the plain heads-up — which is exactly what they
 * get with no task at all. Nothing throws and nothing logs, so the only way
 * this is ever caught is here or on a handset.
 */

it('reads the loose fields a task payload carries', () => {
  expect(pushDataFromTaskPayload({ notification: {}, data: { offer_id: 41 } })).toEqual({
    offer_id: 41,
  });
});

it('prefers the JSON string Android nests the payload in', () => {
  // `dataString` sits *beside* the loose fields rather than instead of them,
  // and on the versions that populate it the loose fields are the incomplete
  // half. Betting on the wrong one is the silent failure this file exists for.
  const payload = {
    notification: null,
    data: { dataString: JSON.stringify({ offer_id: 41 }), someOtherField: 'x' },
  };

  expect(pushDataFromTaskPayload(payload)).toEqual({ offer_id: 41 });
});

it('reads a payload nested under body', () => {
  const payload = { notification: {}, data: { body: JSON.stringify({ trip_id: 900 }) } };

  expect(pushDataFromTaskPayload(payload)).toEqual({ trip_id: 900 });
});

it('falls back to the loose fields when the nested string is not JSON', () => {
  // `body` on a notification that is not ours is ordinary prose. Finding it
  // unparseable must not stop this reading the fields beside it.
  const payload = { notification: {}, data: { body: 'Your payout has landed', offer_id: 41 } };

  expect(pushDataFromTaskPayload(payload)).toEqual({
    body: 'Your payout has landed',
    offer_id: 41,
  });
});

it('ignores a button press, which is answered elsewhere', () => {
  // notify-kit's `onBackgroundEvent` already answers the call notification's
  // Accept and Decline. A second answer from here is the double-accept
  // `claimAnswer` exists to catch — and it would cost a real fare.
  const response = {
    actionIdentifier: 'offer.accept',
    notification: { request: { content: { data: { offer_id: 41 } } } },
  };

  expect(pushDataFromTaskPayload(response)).toBeNull();
});

it.each([null, undefined, 'a string', 42, { notification: {} }, { data: null }, { data: 7 }])(
  'yields null for %p rather than throwing',
  (payload) => {
    // A headless task that throws is a crash in a process the driver cannot
    // see, on a push from a server that may be newer than this build.
    expect(pushDataFromTaskPayload(payload)).toBeNull();
  },
);

it('composes with the router, which is the only thing that reads it', () => {
  // The pair is what actually runs. Asserting them together is what stops a
  // parser that is right about shapes and wrong about the field names.
  const payload = { notification: null, data: { dataString: JSON.stringify({ offer_id: '41' }) } };

  expect(intentFrom(pushDataFromTaskPayload(payload))).toEqual({
    kind: 'open_offer',
    offerId: 41,
  });
});

it('carries a withdrawal through to the router', () => {
  const payload = {
    notification: null,
    data: { dataString: JSON.stringify({ offer_id: 41, withdrawn: true }) },
  };

  expect(intentFrom(pushDataFromTaskPayload(payload))).toEqual({
    kind: 'withdraw_offer',
    offerId: 41,
  });
});
