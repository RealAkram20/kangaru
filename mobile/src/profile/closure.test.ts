import type { DriverClosureRequest } from '../api/endpoints';
import { askedOn, closureRowValue, closureStage, declineNotice } from './closure';

/**
 * Reading a closure request (ADR-0043).
 *
 * The properties worth defending, in the order a mistake would cost:
 *
 * 1. **A declined request lets the driver ask again.** Treating it as an open
 *    one would leave somebody the office refused with no way forward at all,
 *    and no explanation on the screen either.
 * 2. **The office's reason is shown.** §4 makes it required of them precisely
 *    so a refusal is actionable; swallowing it here would waste the rule.
 * 3. **Only a pending request speaks on the Profile row.** A status nobody
 *    asked for is noise on the screen a driver opens for other reasons.
 */
function request(overrides: Partial<DriverClosureRequest> = {}): DriverClosureRequest {
  return {
    id: 3,
    status: 'pending',
    status_label: 'Waiting for the office',
    reason: null,
    decline_reason: null,
    requested_at: '2026-08-15T09:00:00+00:00',
    reviewed_at: null,
    closed_at: null,
    ...overrides,
  };
}

describe('closureStage', () => {
  it('treats a driver who has never asked as free to ask', () => {
    expect(closureStage(null)).toBe('none');
    expect(closureStage(undefined)).toBe('none');
  });

  it('holds a pending request open', () => {
    expect(closureStage(request())).toBe('pending');
  });

  /**
   * The one that matters most. Mutation check — return `'pending'` for
   * anything that is not `none` and this fails: a driver the office refused
   * would be shown a withdraw button for a request nobody is holding, and no
   * way to ask again.
   */
  it('lets a declined or withdrawn request be asked again', () => {
    expect(closureStage(request({ status: 'declined' }))).toBe('none');
    expect(closureStage(request({ status: 'withdrawn' }))).toBe('none');
  });

  it('names a confirmed closure rather than offering to close it twice', () => {
    expect(closureStage(request({ status: 'confirmed' }))).toBe('closed');
  });
});

describe('declineNotice', () => {
  it('says nothing at all until the office has refused one', () => {
    expect(declineNotice(null)).toBeNull();
    expect(declineNotice(request())).toBeNull();
    expect(declineNotice(request({ status: 'withdrawn' }))).toBeNull();
  });

  it('carries the office s own words, which is the point of requiring them', () => {
    const notice = declineNotice(
      request({ status: 'declined', decline_reason: 'Settle your balance first.' }),
    );

    expect(notice).toContain('Settle your balance first.');
  });

  /**
   * The server requires a reason, so this branch should be unreachable — and
   * is written anyway, because "the server validates it" is a claim about
   * today's rules and a driver staring at a blank refusal is a dead end.
   */
  it('still says the request was refused when the reason is somehow empty', () => {
    const notice = declineNotice(request({ status: 'declined', decline_reason: '   ' }));

    expect(notice).not.toBeNull();
    expect(notice).toContain('did not close your account');
  });
});

describe('askedOn', () => {
  it('dates the request, so waiting can be judged', () => {
    expect(askedOn(request())).toBe(
      'Asked on 15 Aug 2026. You can keep working until the office answers.',
    );
  });

  /**
   * Degrades to the sentence, never to a placeholder. Mutation check — return
   * an em dash or "Invalid Date" and this fails.
   */
  it('drops the date rather than printing a broken one', () => {
    expect(askedOn(request({ requested_at: null }))).not.toContain('Asked on');
    expect(askedOn(request({ requested_at: 'not a date' }))).not.toContain('Invalid');
    expect(askedOn(request({ requested_at: 'not a date' }))).toContain('keep working');
  });
});

describe('closureRowValue', () => {
  it('says nothing on the row until something is waiting', () => {
    expect(closureRowValue(null)).toBeNull();
    expect(closureRowValue(request({ status: 'declined' }))).toBeNull();
    expect(closureRowValue(request({ status: 'confirmed' }))).toBeNull();
  });

  it('answers did that go through, without costing a tap', () => {
    expect(closureRowValue(request())).toBe('Waiting for the office');
  });
});
