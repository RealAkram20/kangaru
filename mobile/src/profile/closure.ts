import type { DriverClosureRequest } from '../api/endpoints';

/**
 * Reading a closure request (ADR-0043).
 *
 * The wording lives here rather than in the screen for the reason
 * `profile/presentation.ts` gives: sentences a driver reads about losing their
 * account are worth pinning in a test, and a screen test that asserts copy is
 * really two tests wearing one coat.
 *
 * **The vocabulary is deliberately not "delete".** ADR-0043's opening
 * constraint is that a hard delete is not available to this platform at any
 * price — trips, ledger entries and invoices survive, because reproducible
 * invoices are what the anchor client is buying. The row a driver looks for
 * still says *Delete account*, because that is the words they arrive with; from
 * there on, every sentence says what actually happens.
 */

/**
 * Where the driver stands, from the latest request the server holds.
 *
 * `null` — never asked — collapses into `none` with a withdrawn or declined
 * request, because all three mean the same thing to the screen: it can ask
 * again. What differs is what is *shown above* the form, which is
 * `declineNotice` below, not this.
 */
export type ClosureStage = 'none' | 'pending' | 'closed';

export function closureStage(request: DriverClosureRequest | null | undefined): ClosureStage {
  if (request === null || request === undefined) {
    return 'none';
  }

  if (request.status === 'pending') {
    return 'pending';
  }

  // A driver whose account is confirmed closed cannot sign in, so in practice
  // nobody reads this branch. It exists anyway: the alternative is a screen
  // that offers to close an account that is already closed, and "unreachable"
  // is a claim about today's auth, not a guarantee.
  return request.status === 'confirmed' ? 'closed' : 'none';
}

/**
 * The office's answer to a refused request, or null.
 *
 * ADR-0043 §4 makes the decline reason **required of the office** — *"settle
 * your balance first"* is an answer a driver can act on, where a bare refusal
 * is how somebody stops using a feature. So this shows the reason whenever
 * there is one, and still says the request was refused when the office somehow
 * left it empty.
 */
export function declineNotice(request: DriverClosureRequest | null | undefined): string | null {
  if (request === null || request === undefined || request.status !== 'declined') {
    return null;
  }

  return request.decline_reason === null || request.decline_reason.trim() === ''
    ? 'The office did not close your account. Ask them why before you try again.'
    : `The office did not close your account: ${request.decline_reason.trim()}`;
}

/**
 * "Asked on 15 Aug 2026", or the sentence without a date.
 *
 * The date is what makes waiting bearable — a driver who cannot see how long
 * it has been has no way to judge whether to ring the office. It degrades to
 * the bare sentence rather than to an em dash: a missing timestamp is not worth
 * a placeholder on a screen about somebody's livelihood.
 */
export function askedOn(request: DriverClosureRequest | null | undefined): string {
  const waiting = 'The office has your request. You can keep working until they answer.';

  if (request === null || request === undefined || request.requested_at === null) {
    return waiting;
  }

  const parsed = new Date(request.requested_at);

  if (Number.isNaN(parsed.getTime())) {
    return waiting;
  }

  const day = parsed.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return `Asked on ${day}. You can keep working until the office answers.`;
}

/**
 * What the Profile row says to the right of *Delete account*.
 *
 * Null while nothing is happening, so the row reads as a destination rather
 * than as a status nobody asked for. A pending request is the one state worth
 * carrying onto the Profile screen: it is the answer to *"did that go
 * through?"*, and making a driver open the screen to find out is the kind of
 * small cruelty this app is trying not to commit.
 */
export function closureRowValue(request: DriverClosureRequest | null | undefined): string | null {
  return closureStage(request) === 'pending' ? 'Waiting for the office' : null;
}
