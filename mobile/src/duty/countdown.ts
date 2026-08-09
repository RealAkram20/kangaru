import type { DispatchOffer } from '../api/types';

/**
 * How long a driver has left to answer an offer (ADR-0024 §3).
 *
 * ## Why this is a module and not four lines inside the component
 *
 * Because it is the one piece of the offer screen that can be *wrong* rather
 * than merely ugly, and `jest.setup.ts` records why that matters here: the
 * suites worth trusting in this app are "pure TypeScript over injected
 * ports". A component test would have to render concurrently, await the
 * flush, and drive fake timers through `act` — three things that can fail for
 * reasons having nothing to do with the arithmetic.
 *
 * ## The rule
 *
 * Count from the server's `expires_in_seconds`, **never** from `expires_at`
 * minus the local clock.
 *
 * `expires_at` is an absolute instant, and comparing it against a handset's
 * clock is only as good as that clock. Every phone in an office is
 * NTP-synced; plenty of cheap Android hardware in a taxi is minutes out, and
 * in the wrong direction that shows a driver forty seconds on a
 * fifteen-second offer — or an offer that appears to have expired before it
 * arrived. `expires_in_seconds` is a *duration* the server measured against
 * one clock, so it carries no such assumption.
 *
 * Elapsed time since arrival is measured locally, which is safe: a device's
 * clock may be wrong about *when* it is, but it counts seconds correctly, and
 * a fifteen-second window leaves no room for drift to matter.
 */
export function secondsRemaining(
  offer: Pick<DispatchOffer, 'expires_in_seconds'>,
  elapsedSeconds: number,
): number {
  // Clamped at both ends. Zero is the floor because a negative countdown
  // tells a driver the platform has lost track of the job rather than that
  // the job is gone — and the list is what removes an expired offer, since
  // the server simply stops returning it.
  //
  // The server's own number is clamped too: it is `max(0, …)` server-side,
  // but a client that trusts a remote number to be in range is a client that
  // renders "-3s" the day somebody changes the resource.
  return Math.max(0, Math.max(0, offer.expires_in_seconds) - Math.max(0, elapsedSeconds));
}

/**
 * Whether the clock is close enough to worry a driver.
 *
 * Drives the colour change and nothing else. Five seconds is roughly the
 * point at which "I'll finish this sentence first" stops being an option.
 */
export function isRunningOut(remainingSeconds: number): boolean {
  return remainingSeconds <= 5;
}