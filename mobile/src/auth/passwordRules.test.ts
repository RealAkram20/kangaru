import { MINIMUM_PASSWORD_LENGTH, passwordProblem, passwordProblemMessage } from './passwordRules';

/**
 * These rules mirror `ChangePasswordRequest`, and the mirror earns its keep
 * because of what the round trip costs here specifically: a successful
 * `PATCH /auth/password` revokes every token the account holds, so the request
 * that teaches a driver their password was too short is also the one that
 * would have signed them out of the app they are standing in.
 */
const VALID = {
  current: 'issued-by-the-office',
  next: 'my-own-password-now',
  confirmation: 'my-own-password-now',
};

describe('passwordProblem', () => {
  it('passes a well-formed change', () => {
    expect(passwordProblem(VALID)).toBeNull();
  });

  it('needs the current password, because the server re-authenticates', () => {
    expect(passwordProblem({ ...VALID, current: '' })).toBe('current_missing');
  });

  /**
   * `Password::min(12)`. Mutation check — lower `MINIMUM_PASSWORD_LENGTH` or
   * drop the comparison and this fails: an 11-character password is accepted
   * locally, sent, and refused by the server.
   */
  it('enforces the same twelve-character minimum the server does', () => {
    const eleven = 'a'.repeat(MINIMUM_PASSWORD_LENGTH - 1);
    const twelve = 'a'.repeat(MINIMUM_PASSWORD_LENGTH);

    expect(passwordProblem({ ...VALID, next: eleven, confirmation: eleven })).toBe('too_short');
    expect(passwordProblem({ ...VALID, next: twelve, confirmation: twelve })).toBeNull();
  });

  /**
   * `different:current_password`. Mutation check — remove the branch and this
   * fails.
   */
  it('refuses a new password identical to the current one', () => {
    expect(
      passwordProblem({
        current: VALID.current,
        next: VALID.current,
        confirmation: VALID.current,
      }),
    ).toBe('same_as_current');
  });

  /**
   * `confirmed`. The one rule whose absence is genuinely dangerous: a typo
   * that reached the server would set a password the driver does not know,
   * revoke every token, and leave them locked out of an account with no
   * self-service reset (ADR-0016).
   *
   * Mutation check — remove the branch and this fails.
   */
  it('refuses a mistyped confirmation', () => {
    expect(passwordProblem({ ...VALID, confirmation: 'my-own-password-nwo' })).toBe(
      'confirmation_mismatch',
    );
  });

  /**
   * Order matters: an empty form should complain about the field the driver
   * will fill in first, not the last one. Mutation check — reorder the checks
   * so the length test comes first and this fails.
   */
  it('reports the earliest problem, not an arbitrary one', () => {
    expect(passwordProblem({ current: '', next: '', confirmation: '' })).toBe('current_missing');
  });
});

describe('passwordProblemMessage', () => {
  it('says the actual minimum rather than a hardcoded number that could drift', () => {
    expect(passwordProblemMessage('too_short')).toContain(String(MINIMUM_PASSWORD_LENGTH));
  });

  it('has a sentence for every problem it can report', () => {
    (['current_missing', 'too_short', 'same_as_current', 'confirmation_mismatch'] as const).forEach(
      (problem) => {
        expect(passwordProblemMessage(problem).length).toBeGreaterThan(0);
      },
    );
  });
});
