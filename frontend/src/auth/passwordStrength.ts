/**
 * A password strength estimate for the sign-up form.
 *
 * Deliberately a *guide*, not a gate: the only hard rule is the server's
 * `min:8`, and a form that refuses a long passphrase because it has no
 * digit teaches people to write "Password1!" — which every cracking
 * dictionary already holds. So length is weighted above character
 * variety, and the obvious junk is called out by name rather than scored.
 *
 * Not zxcvbn: that library is ~400KB of frequency tables, which is a
 * heavy thing to put in the public bundle for a meter. If real strength
 * scoring becomes a requirement (it is not today — nothing here protects
 * money), zxcvbn behind a dynamic import is the way in.
 */

export type StrengthLevel = 'too-short' | 'weak' | 'fair' | 'good' | 'strong'

export interface PasswordStrength {
  level: StrengthLevel
  /** 0–4, for the meter's filled segments. */
  score: number
  label: string
  /** The single most useful next improvement, or null when there is none. */
  hint: string | null
}

/** The server's floor. Below this the form cannot submit at all. */
export const MIN_PASSWORD_LENGTH = 8

/**
 * Patterns that look varied but are not. Checked against the whole
 * password, case-insensitively, so "Password123" scores as the guess it is.
 */
const OBVIOUS = /^(password|passw0rd|welcome|qwerty|letmein|admin|kampala|kangaru|abc123|1234)/i

const LABELS: Record<StrengthLevel, string> = {
  'too-short': 'Too short',
  weak: 'Weak',
  fair: 'Fair',
  good: 'Good',
  strong: 'Strong',
}

export function passwordStrength(password: string): PasswordStrength {
  if (password.length === 0) {
    return { level: 'too-short', score: 0, label: '', hint: null }
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      level: 'too-short',
      score: 0,
      label: LABELS['too-short'],
      hint: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    }
  }

  /*
   * Length alone must be able to reach the top of the meter. A long
   * passphrase is stronger than a short scramble, and a meter that caps
   * "correct horse battery staple" below "P@ssw0rd!" is teaching the
   * wrong lesson — which is the entire reason this is not a rules list.
   */
  let score = 1
  if (password.length >= 12) score += 1
  if (password.length >= 16) score += 1
  if (password.length >= 20) score += 1

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) =>
    re.test(password),
  ).length
  if (classes >= 3) score += 1

  // One character repeated, or a single class of exactly the minimum
  // length, is not worth the score the rules above just gave it.
  if (/^(.)\1+$/.test(password)) score = 1
  if (OBVIOUS.test(password)) score = 1

  score = Math.min(4, Math.max(1, score))

  const level: StrengthLevel = score >= 4 ? 'strong' : score === 3 ? 'good' : score === 2 ? 'fair' : 'weak'

  let hint: string | null = null
  if (score < 4) {
    hint =
      password.length < 12
        ? 'Longer is stronger — try a short phrase you will remember.'
        : classes < 3
          ? 'Mix in capitals, numbers or punctuation.'
          : null
  }
  if (OBVIOUS.test(password)) hint = 'That is one of the first passwords anyone would guess.'

  return { level, score, label: LABELS[level], hint }
}
