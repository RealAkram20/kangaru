/**
 * The password rules, mirrored from `ChangePasswordRequest`.
 *
 * A deliberate duplication, and a narrow one: `['required', 'string',
 * 'confirmed', Password::min(12), 'different:current_password']`. The server
 * remains the authority — a 422 is handled like any other refusal — but these
 * three checks are cheap to make locally and expensive to learn remotely,
 * because the round trip that teaches them also happens to be the one that
 * signs the driver out of every device they own.
 *
 * Only rules that cannot drift silently are mirrored. Nothing here guesses at
 * complexity requirements the server does not impose: inventing a stricter
 * rule than the backend holds would reject passwords the platform accepts,
 * and the driver would have no way to tell which of the two was wrong.
 */

/** `Password::min(12)`. */
export const MINIMUM_PASSWORD_LENGTH = 12;

export type PasswordProblem =
  | 'current_missing'
  | 'too_short'
  | 'same_as_current'
  | 'confirmation_mismatch';

/**
 * The first problem with what the driver has typed, or null when it is ready
 * to send.
 *
 * One problem at a time rather than a list. Three messages under three fields
 * on a phone screen is a wall; the next one appears as soon as the first is
 * fixed.
 */
export function passwordProblem(input: {
  current: string;
  next: string;
  confirmation: string;
}): PasswordProblem | null {
  if (input.current.length === 0) {
    return 'current_missing';
  }

  if (input.next.length < MINIMUM_PASSWORD_LENGTH) {
    return 'too_short';
  }

  // `different:current_password` on the server. Checked here because the
  // server's refusal costs a round trip on a connection this screen may
  // barely have.
  if (input.next === input.current) {
    return 'same_as_current';
  }

  if (input.next !== input.confirmation) {
    return 'confirmation_mismatch';
  }

  return null;
}

export function passwordProblemMessage(problem: PasswordProblem): string {
  switch (problem) {
    case 'current_missing':
      return 'Enter your current password.';
    case 'too_short':
      return `Your new password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`;
    case 'same_as_current':
      return 'Your new password must be different from your current one.';
    case 'confirmation_mismatch':
      return 'The two new passwords do not match.';
  }
}
