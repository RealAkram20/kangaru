import * as Sentry from '@sentry/react-native';

import { annotate, registerNavigationForTracing, startTracing, traced } from './tracing';

/**
 * ADR-0054 §4 — the two properties every traced call site in this app depends
 * on without saying so.
 *
 * **One: tracing never changes an answer.** `drain()` returns an outcome the
 * sync banner renders and `goOnline()` returns a boolean that decides whether
 * a driver is told the OS refused. A wrapper that altered either — or that
 * swallowed a rejection on the way past — would be a monitoring tool causing
 * the fault it is there to report.
 *
 * **Two: none of it needs a DSN.** Development has none and the Jest
 * environment has none, so every call site runs the unconfigured path on
 * every developer machine. `sentryProbe.test.ts` already proves the SDK
 * imports here; these prove it is safe to *call*.
 *
 * The real SDK, not a mock, for the reason the backend's `TraceTest` gives:
 * a mock would only prove the helper was called. What is worth defending is
 * that a driver's tap survives being measured.
 */

it('returns the value and runs the work once with no client configured', async () => {
  let calls = 0;

  const result = await traced('outbox.drain', 'send what the driver did offline', async () => {
    calls++;

    return { completed: 2, parked: 0, deferred: 1, paused: false };
  });

  expect(result).toEqual({ completed: 2, parked: 0, deferred: 1, paused: false });
  // Once. A helper that ran the callable twice would send every queued
  // transition twice, which is the single thing the outbox exists to prevent.
  expect(calls).toBe(1);
});

it('lets a rejection through untouched', async () => {
  await expect(
    traced('duty.go_online', 'start reporting position', async () => {
      throw new Error('the OS said no');
    }),
  ).rejects.toThrow('the OS said no');
});

it('passes the operation and name to the SDK', async () => {
  const startSpan = jest.spyOn(Sentry, 'startSpan');

  await traced('outbox.drain', 'send what the driver did offline', async () => null);

  expect(startSpan).toHaveBeenCalledWith(
    { op: 'outbox.drain', name: 'send what the driver did offline' },
    expect.any(Function),
  );

  startSpan.mockRestore();
});

it('annotates nothing, and does not throw, with no span open', () => {
  // The path every call takes in development and in nine sampled
  // transactions out of ten. Reaching the end is the assertion.
  expect(() => annotate({ refused: false, heartbeat_seconds: 15 })).not.toThrow();
});

it('adds the navigation integration without a client', () => {
  // `Sentry.init` never ran here, so there is no client to add it to. The SDK
  // warns and returns; what matters is that `index.ts` calling this on a
  // developer's machine does not take the app down before React mounts.
  expect(() => startTracing()).not.toThrow();
});

it('survives a navigation container that is not ready', () => {
  // `RootNavigator` calls this from `onReady`, so in the app the ref is
  // populated. A null one is what a re-created Android activity can hand over
  // — the SDK warns rather than throwing, and the app must not care.
  expect(() => registerNavigationForTracing({ current: null })).not.toThrow();
});
