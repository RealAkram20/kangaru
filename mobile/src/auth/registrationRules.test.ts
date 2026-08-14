import { MINIMUM_PASSWORD_LENGTH } from './passwordRules';
import {
  MINIMUM_PHONE_DIGITS,
  registrationProblem,
  registrationProblemMessage,
  type RegistrationProblem,
} from './registrationRules';

/**
 * Sign-up is the one screen a driver reaches before they have an account, and
 * therefore before they have anything to fall back on. Every rule mirrored
 * here saves a round trip made on whatever signal they have while standing
 * outside a depot; every rule invented here would lock them out of a platform
 * that would have accepted them.
 */
const VALID = {
  name: 'Shanitah Nabbosa',
  phone: '0772 123 456',
  email: 'shanitah@example.com',
  password: 'a-password-i-chose',
  confirmation: 'a-password-i-chose',
  acceptedTerms: true,
};

describe('registrationProblem', () => {
  it('passes a well-formed application', () => {
    expect(registrationProblem(VALID)).toBeNull();
  });

  it('names the field as well as the problem, because the screen focuses it', () => {
    expect(registrationProblem({ ...VALID, name: '   ' })).toEqual({
      field: 'name',
      problem: 'name_missing',
    });
  });

  /**
   * Whitespace is not a name. Mutation check — drop the `.trim()` and this
   * fails, because three spaces has a non-zero length.
   */
  it('does not accept whitespace as a name', () => {
    expect(registrationProblem({ ...VALID, name: '   ' })?.problem).toBe('name_missing');
  });

  /**
   * `min:9`, counted in digits rather than characters, because the number a
   * driver writes down carries spaces and often a `+256`. Mutation check —
   * compare `input.phone.length` instead of the stripped digits and this fails:
   * "07 7" is four digits inside eight characters and would pass.
   */
  it('counts phone digits, not the punctuation around them', () => {
    expect(registrationProblem({ ...VALID, phone: '07 7' })?.problem).toBe('phone_too_short');
    expect(registrationProblem({ ...VALID, phone: '+256 772 123 456' })).toBeNull();
  });

  it('enforces the documented phone minimum exactly', () => {
    const short = '7'.repeat(MINIMUM_PHONE_DIGITS - 1);
    const exact = '7'.repeat(MINIMUM_PHONE_DIGITS);

    expect(registrationProblem({ ...VALID, phone: short })?.problem).toBe('phone_too_short');
    expect(registrationProblem({ ...VALID, phone: exact })).toBeNull();
  });

  it('separates an empty phone from a short one, so the message can differ', () => {
    expect(registrationProblem({ ...VALID, phone: '' })?.problem).toBe('phone_missing');
  });

  /**
   * The check is meant to catch a typo, not to adjudicate RFC 5322. Mutation
   * check — a pattern that demands a known TLD, or forbids `+` tags, breaks the
   * second case and would refuse an address the server accepts.
   */
  it('rejects obvious nonsense and accepts unusual but legal addresses', () => {
    expect(registrationProblem({ ...VALID, email: 'shanitah.example.com' })?.problem).toBe(
      'email_malformed',
    );
    expect(registrationProblem({ ...VALID, email: 'shanitah+boda@sub.example.co.ug' })).toBeNull();
  });

  it('enforces the same twelve-character minimum the server does', () => {
    const eleven = 'a'.repeat(MINIMUM_PASSWORD_LENGTH - 1);
    const twelve = 'a'.repeat(MINIMUM_PASSWORD_LENGTH);

    expect(
      registrationProblem({ ...VALID, password: eleven, confirmation: eleven })?.problem,
    ).toBe('password_too_short');
    expect(registrationProblem({ ...VALID, password: twelve, confirmation: twelve })).toBeNull();
  });

  /**
   * The dangerous one. A typo that reached the server would set a password the
   * driver does not know — and ADR-0016 offers no self-service reset, so the
   * account they just created is one they can never open.
   *
   * Mutation check — remove the branch and this fails.
   */
  it('refuses a mistyped confirmation', () => {
    expect(registrationProblem({ ...VALID, confirmation: 'a-password-i-chsoe' })?.problem).toBe(
      'confirmation_mismatch',
    );
  });

  it('will not submit without consent', () => {
    expect(registrationProblem({ ...VALID, acceptedTerms: false })?.problem).toBe(
      'terms_not_accepted',
    );
  });

  /**
   * Order is the design, not an accident of the `if` chain.
   *
   * An empty form complains about the first field, never about the unticked
   * box at the bottom — somebody who has filled in nothing has not declined
   * the terms, they have not reached them. Mutation check — move the consent
   * check to the top and this fails.
   */
  it('reports the earliest problem, and never leads with consent', () => {
    const empty = {
      name: '',
      phone: '',
      email: '',
      password: '',
      confirmation: '',
      acceptedTerms: false,
    };

    expect(registrationProblem(empty)).toEqual({ field: 'name', problem: 'name_missing' });
  });
});

describe('registrationProblemMessage', () => {
  it('quotes the actual minimums rather than numbers that could drift', () => {
    expect(registrationProblemMessage('password_too_short')).toContain(
      String(MINIMUM_PASSWORD_LENGTH),
    );
    expect(registrationProblemMessage('phone_too_short')).toContain(String(MINIMUM_PHONE_DIGITS));
  });

  it('has a sentence for every problem it can report', () => {
    const all: RegistrationProblem[] = [
      'name_missing',
      'phone_missing',
      'phone_too_short',
      'email_missing',
      'email_malformed',
      'password_too_short',
      'confirmation_mismatch',
      'terms_not_accepted',
    ];

    all.forEach((problem) => {
      expect(registrationProblemMessage(problem).length).toBeGreaterThan(0);
    });
  });
});