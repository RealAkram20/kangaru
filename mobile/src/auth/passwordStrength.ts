/**
 * A password strength estimate for the driver app.
 *
 * **Ported from `frontend/src/auth/passwordStrength.ts`, not reinvented.** The
 * two apps are separate packages and cannot import from one another — the same
 * reason `api/endpoints.ts` hand-transcribes the contract — so this is a
 * deliberate second copy with a test that pins the behaviours it shares. If you
 * change the philosophy here, change it there.
 *
 * The floors now agree everywhere, not just at the doors this app can reach:
 * `App\Support\Auth\PasswordPolicy` holds the single number every request
 * class on the server validates against, and both apps mirror it. The copy
 * stays a copy for the packaging reason above.
 *
 * Deliberately a **guide, not a gate**. The server's only hard rule is the
 * length; there is no complexity requirement anywhere in the platform, and a
 * form that refused a long passphrase for having no digit would teach drivers
 * to write "Password1!" — which every cracking dictionary already holds. So
 * length is weighted above character variety, and obvious junk is called out by
 * name rather than scored.
 *
 * **The meter has to be readable as a rule, not as a mood.** Every segment is
 * earned by one stated thing, the things are the same four lengths plus one
 * variety step, and the hint always names the single next one. A driver who
 * watches the bar move should be able to say why it moved — which is the whole
 * difference between a meter that teaches and a meter that decorates.
 *
 * Not zxcvbn: ~400KB of frequency tables is a heavy thing to add to a bundle
 * that goes onto fleet handsets over Ugandan mobile data, and `quality-control`
 * makes a new dependency an owner's decision. If real scoring is ever needed,
 * that is the way in.
 */

import { MINIMUM_PASSWORD_LENGTH } from './passwordRules';

export type StrengthLevel = 'too-short' | 'weak' | 'fair' | 'good' | 'strong';

export type PasswordRequirementKey = 'length' | 'case' | 'number' | 'symbol';

export type PasswordRequirement = {
  key: PasswordRequirementKey;
  label: string;
  met: boolean;
};

export type PasswordStrength = {
  level: StrengthLevel;
  /** 0–`STRENGTH_SEGMENTS`, for the meter's filled segments. */
  score: number;
  label: string;
  /**
   * The four things the meter grades, each with whether it is met.
   *
   * **Rendered, not merely computed.** This is the fix for a meter that read
   * "Fair" against a password holding a capital, a lowercase, a digit and a
   * symbol at the stated minimum length — every rule the app names — and then
   * asked for four more characters without saying why. A bar whose scale is
   * invisible is a bar that grades against a standard the driver was never
   * told, which is not a guide, it is a verdict.
   */
  requirements: PasswordRequirement[];
  /** Said only when the checklist cannot say it. Null the rest of the time. */
  hint: string | null;
};

/**
 * How many segments the bar draws, and the ceiling on `score`.
 *
 * Exported so `PasswordMeter` draws exactly as many boxes as the scoring can
 * fill. The two used to be separate fours, and a fifth point would have
 * silently rendered as a bar that was already full.
 */
export const STRENGTH_SEGMENTS = 4;

/*
 * **The floor is `passwordRules.MINIMUM_PASSWORD_LENGTH`, imported rather than
 * restated.** That module already owns the number and already has a mutation
 * test on it; a second constant here would be a second place for the server's
 * `PasswordPolicy::rule()` to be answered differently — and the two would only
 * disagree on the day somebody changed one of them, which is the day it
 * matters. The first draft of this file did declare its own, and it was wrong
 * to.
 */

/**
 * The four lengths that each earn a segment, derived from the floor so they
 * cannot drift from it: the minimum, then every four characters after.
 *
 * **This is the second road to a full bar, and it exists for the passphrase.**
 * "my blue kettle sings" holds no capital, no digit and no punctuation, and it
 * is stronger than anything eight characters long can be. A meter that graded
 * it on the checklist alone would tell a driver to ruin it.
 */
const LENGTH_STEPS = [
  MINIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH + 4,
  MINIMUM_PASSWORD_LENGTH + 8,
  MINIMUM_PASSWORD_LENGTH + 12,
];

const HAS_LOWER = /[a-z]/;
const HAS_UPPER = /[A-Z]/;
const HAS_NUMBER = /[0-9]/;
const HAS_SYMBOL = /[^A-Za-z0-9]/;

/**
 * The four things the meter grades, in the order they are read.
 *
 * **One segment each, and that is the whole scale.** The previous version
 * awarded a single segment for character variety however varied, and put the
 * top of the bar at twenty characters — a number no screen in this app
 * mentions. The result was that a password meeting every stated rule read
 * "Fair" and was told to grow, while the driver had no way to learn what the
 * remaining two segments wanted. Requirements a driver can see beat a scale
 * they cannot.
 */
function requirementsFor(password: string): PasswordRequirement[] {
  return [
    {
      key: 'length',
      label: `${MINIMUM_PASSWORD_LENGTH} characters or more`,
      met: password.length >= MINIMUM_PASSWORD_LENGTH,
    },
    {
      key: 'case',
      label: 'Upper and lower case',
      met: HAS_LOWER.test(password) && HAS_UPPER.test(password),
    },
    { key: 'number', label: 'A number', met: HAS_NUMBER.test(password) },
    { key: 'symbol', label: 'A symbol', met: HAS_SYMBOL.test(password) },
  ];
}

/**
 * Words that look varied but are not, matched anywhere in the password rather
 * than only at its start.
 *
 * Unanchored on purpose. "Kangaru2024!" was already caught; "myKangaru2024"
 * was not, and it is the same guess with a run-up — anybody writing a
 * dictionary for this platform writes the platform's name into it first.
 */
const OBVIOUS = /(password|passw0rd|welcome|qwerty|letmein|admin|kampala|kangaru|abc123|1234)/i;

/** One character, over and over. Thirty of them are still one guess. */
const ONE_CHARACTER_REPEATED = /^(.)\1+$/;

/** A block of two to four characters, over and over: "abab", "123123". */
const SHORT_BLOCK_REPEATED = /^(.{2,4}?)\1+$/;

const LABELS: Record<StrengthLevel, string> = {
  'too-short': 'Too short',
  weak: 'Weak',
  fair: 'Fair',
  good: 'Good',
  strong: 'Strong',
};

/**
 * A straight run along the keyboard or the alphabet — "12345678", "abcdefgh",
 * and the same backwards.
 *
 * Case-folded, because "AbCdEf" is the same run with the shift key involved.
 * Guessed by every list that starts at "123456", and at exactly the floor
 * length it is the single likeliest thing a hurried driver types.
 */
function isSequentialRun(password: string): boolean {
  if (password.length < 4) {
    return false;
  }

  // `charCodeAt` rather than indexing the array, so `noUncheckedIndexedAccess`
  // has nothing to complain about and there is no `!` in a security check.
  const folded = password.toLowerCase();
  const step = folded.charCodeAt(1) - folded.charCodeAt(0);

  if (step !== 1 && step !== -1) {
    return false;
  }

  for (let index = 2; index < folded.length; index += 1) {
    if (folded.charCodeAt(index) - folded.charCodeAt(index - 1) !== step) {
      return false;
    }
  }

  return true;
}

/**
 * A password whose length is a lie about how hard it is to guess, and the
 * sentence that says which lie it is.
 *
 * Returned together rather than checked twice: the thing that caps the score
 * and the thing that explains the cap must be the same finding, or the bar and
 * the sentence under it end up disagreeing.
 */
function predictable(password: string): string | null {
  if (ONE_CHARACTER_REPEATED.test(password)) {
    return 'One character repeated is one character to guess.';
  }

  if (SHORT_BLOCK_REPEATED.test(password)) {
    return 'A repeated pattern is only as hard to guess as the part that repeats.';
  }

  if (isSequentialRun(password)) {
    return 'Keys in order are the first thing anyone tries.';
  }

  if (OBVIOUS.test(password)) {
    return 'That contains one of the first passwords anyone would guess.';
  }

  return null;
}

export function passwordStrength(password: string): PasswordStrength {
  const requirements = requirementsFor(password);

  if (password.length === 0) {
    return { level: 'too-short', score: 0, label: '', requirements, hint: null };
  }

  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    const missing = MINIMUM_PASSWORD_LENGTH - password.length;

    return {
      level: 'too-short',
      score: 0,
      label: LABELS['too-short'],
      requirements,
      // Counts down rather than restating the rule. "3 more characters" is
      // something a driver can act on without re-counting what they typed.
      hint: `${missing} more character${missing === 1 ? '' : 's'} to go.`,
    };
  }

  /*
   * **Two roads to a full bar, and the score is whichever is further along.**
   *
   * The checklist is the one a driver can act on: four named things, one
   * segment each, all of them visible. Meeting every rule the app states must
   * fill the bar — anything else grades against a standard the screen never
   * mentions, which is what the previous version did and what this exists to
   * fix.
   *
   * Length is the other, and it is not decoration: "my blue kettle sings" has
   * no capital, no digit and no punctuation, and is stronger than any eight
   * characters can be. Scoring it on the checklist alone would tell a driver
   * to wreck a good passphrase to satisfy a tick.
   *
   * Both count upwards only, so the bar cannot fall while somebody is typing.
   */
  const met = requirements.filter((requirement) => requirement.met).length;
  const byLength = LENGTH_STEPS.filter((step) => password.length >= step).length;

  const warning = predictable(password);

  // A predictable password scores one whatever the two roads earned. Not zero:
  // zero is what "too short" means, and the form will still accept this.
  const score = warning !== null ? 1 : Math.min(STRENGTH_SEGMENTS, Math.max(met, byLength));

  const level: StrengthLevel =
    score >= 4 ? 'strong' : score === 3 ? 'good' : score === 2 ? 'fair' : 'weak';

  return {
    level,
    score,
    label: LABELS[level],
    requirements,
    hint: warning ?? carriedByLength(score, met),
  };
}

/**
 * The one thing the checklist cannot say for itself.
 *
 * A full bar over three unticked boxes reads as a bug. It is not — length
 * carried it — but the driver cannot know that from the ticks, so the sentence
 * exists for exactly that case and no other. Silence everywhere else: the
 * checklist is already saying what is missing, and a meter that also nags is
 * one people stop reading.
 */
function carriedByLength(score: number, met: number): string | null {
  return score >= STRENGTH_SEGMENTS && met < STRENGTH_SEGMENTS
    ? 'Long enough that the rest is optional.'
    : null;
}
