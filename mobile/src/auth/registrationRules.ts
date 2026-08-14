import { MINIMUM_PASSWORD_LENGTH } from './passwordRules';

/**
 * What the sign-up form checks before it will spend a request.
 *
 * The same narrow mirror `passwordRules` describes: the server stays the
 * authority and a 422 is handled like any other refusal, but these checks are
 * cheap locally and expensive remotely — this screen is the one a driver
 * reaches on whatever signal they have while standing outside a depot, and
 * every avoidable round trip is one they may not get back.
 *
 * Nothing here invents a rule the backend does not hold. Guessing at a
 * stricter one would reject credentials the platform accepts, and leave the
 * driver with no way to tell which of the two was wrong.
 */

/** `min:9` on the phone field, matching the customer register contract. */
export const MINIMUM_PHONE_DIGITS = 9;

export type RegistrationField =
  | 'name'
  | 'phone'
  | 'email'
  | 'password'
  | 'confirmation'
  | 'terms';

export type RegistrationProblem =
  | 'name_missing'
  | 'phone_missing'
  | 'phone_too_short'
  | 'email_missing'
  | 'email_malformed'
  | 'password_too_short'
  | 'confirmation_mismatch'
  | 'terms_not_accepted';

export type RegistrationInput = {
  name: string;
  phone: string;
  email: string;
  password: string;
  confirmation: string;
  acceptedTerms: boolean;
};

/**
 * Deliberately permissive.
 *
 * Its whole job is catching the typo — a missing `@`, a trailing comma — not
 * adjudicating RFC 5322, which no regex does correctly and which the server
 * checks anyway. A stricter pattern here would eventually refuse somebody's
 * real address, and they would have no recourse at all.
 */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The first problem with the form, or null when it is ready to send.
 *
 * One at a time, in the order the fields are read, so that fixing it moves the
 * driver down the screen rather than scattering six messages across a form
 * that is already taller than the phone. The field comes back with the problem
 * because the screen focuses it — telling somebody something is wrong without
 * showing them where is only half an error message.
 */
export function registrationProblem(
  input: RegistrationInput,
): { field: RegistrationField; problem: RegistrationProblem } | null {
  if (input.name.trim().length === 0) {
    return { field: 'name', problem: 'name_missing' };
  }

  const digits = input.phone.replace(/\D/g, '');

  if (digits.length === 0) {
    return { field: 'phone', problem: 'phone_missing' };
  }

  if (digits.length < MINIMUM_PHONE_DIGITS) {
    return { field: 'phone', problem: 'phone_too_short' };
  }

  if (input.email.trim().length === 0) {
    return { field: 'email', problem: 'email_missing' };
  }

  if (!LOOKS_LIKE_EMAIL.test(input.email.trim())) {
    return { field: 'email', problem: 'email_malformed' };
  }

  if (input.password.length < MINIMUM_PASSWORD_LENGTH) {
    return { field: 'password', problem: 'password_too_short' };
  }

  if (input.password !== input.confirmation) {
    return { field: 'confirmation', problem: 'confirmation_mismatch' };
  }

  // Last, and not first, even though it is the cheapest thing to check.
  //
  // Somebody who has filled nothing in has not declined the terms, they have
  // not reached them yet; leading with a consent complaint over an empty form
  // reads as an accusation. By the time this fires, every other field is good
  // and the tick genuinely is the only thing left.
  if (!input.acceptedTerms) {
    return { field: 'terms', problem: 'terms_not_accepted' };
  }

  return null;
}

export function registrationProblemMessage(problem: RegistrationProblem): string {
  switch (problem) {
    case 'name_missing':
      return 'Enter your full name, as it appears on your licence.';
    case 'phone_missing':
      return 'Enter the phone number dispatch should call.';
    case 'phone_too_short':
      return `That number looks too short — it needs at least ${MINIMUM_PHONE_DIGITS} digits.`;
    case 'email_missing':
      return 'Enter your email address. You sign in with it.';
    case 'email_malformed':
      return 'That does not look like an email address. Check it and try again.';
    case 'password_too_short':
      return `Your password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`;
    case 'confirmation_mismatch':
      return 'The two passwords do not match.';
    case 'terms_not_accepted':
      return 'Please accept the Terms and Conditions and Privacy Policy to continue.';
  }
}