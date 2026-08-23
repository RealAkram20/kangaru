import type { DrainOutcome } from './outbox';
import { fruitlessRun, isStalled, FRUITLESS_DRAINS_BEFORE_STALLED } from './stall';

/**
 * The signal behind the banner's wording.
 *
 * The bug it exists to prevent, in one sentence: **"Sending 3 updates…" over a
 * queue that had not moved and an API that was down.** The count climbed from
 * one to three between two of the owner's screenshots a minute apart, and a
 * driver reading "Sending" concludes the office has their work.
 */

function outcome(overrides: Partial<DrainOutcome> = {}): DrainOutcome {
  return { completed: 0, parked: 0, deferred: 0, paused: false, ...overrides };
}

it('starts counting when a pass leaves everything behind', () => {
  expect(fruitlessRun(0, outcome({ deferred: 3 }))).toBe(1);
  expect(fruitlessRun(1, outcome({ deferred: 3 }))).toBe(2);
});

it('resets the moment anything gets through', () => {
  // One item completing proves the office is there, whatever else is stuck.
  expect(fruitlessRun(9, outcome({ completed: 1, deferred: 2 }))).toBe(0);
});

it('does not call an idle queue a stalled one', () => {
  // Nothing pending, nothing deferred: a drain with no work to do. Without
  // this the banner would appear over every screen in the app the moment the
  // fifteen-second tick found an empty outbox.
  expect(fruitlessRun(5, outcome())).toBe(0);
});

it('says nothing about the office when the session is what expired', () => {
  // The outbox pauses on a 401. "Can't reach the office" is the wrong sentence
  // for a session that needs signing in again, and it has its own path through
  // `onSessionExpired`.
  expect(fruitlessRun(5, outcome({ paused: true, deferred: 4 }))).toBe(0);
});

it('waits for a run, not a single pass', () => {
  // One slow post, or one item waiting out its backoff, must not change the
  // wording — the queue is working exactly as designed in both cases.
  expect(isStalled(1)).toBe(false);
  expect(isStalled(FRUITLESS_DRAINS_BEFORE_STALLED)).toBe(true);
});

it('reaches the threshold in about half a minute of trying', () => {
  // At the 15s outbox tick. Long enough not to fire on a blip, short enough
  // that a driver is not told their work is going out for minutes while it is
  // not — which is what the owner's handset did.
  let run = 0;

  run = fruitlessRun(run, outcome({ deferred: 3 }));
  expect(isStalled(run)).toBe(false);

  run = fruitlessRun(run, outcome({ deferred: 3 }));
  expect(isStalled(run)).toBe(true);
});
