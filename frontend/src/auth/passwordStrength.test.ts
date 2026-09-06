import { describe, expect, it } from 'vitest'
import { MIN_PASSWORD_LENGTH, passwordStrength, STRENGTH_SEGMENTS } from './passwordStrength'

/**
 * The meter behind every password field in this app.
 *
 * **The scale is the four rules the screen shows, and meeting them fills the
 * bar.** The version this replaces graded against a hidden one: a password
 * holding a capital, a lowercase, a digit and a symbol at the stated minimum
 * length — every rule the platform names — filled two segments of four and was
 * told to grow, with no way to learn what the last two wanted. The driver app
 * fixed that months ago; this file is the fix arriving back on the side it was
 * originally ported from.
 *
 * What survives from the old design, because it was right: **length is a
 * second road to the top**, so a passphrase is never marked down for being a
 * passphrase; and **obvious junk is named rather than scored**, however well
 * it ticks the boxes.
 *
 * These cases deliberately mirror `mobile/src/auth/passwordStrength.test.ts`.
 * The two modules are separate copies for a packaging reason, and mirrored
 * tests are how a copy stays a copy rather than becoming a fork.
 */
function metKeys(password: string): string[] {
  return passwordStrength(password)
    .requirements.filter((requirement) => requirement.met)
    .map((requirement) => requirement.key)
}

describe('passwordStrength', () => {
  // -- The regression this scale exists for -------------------------------

  it('fills the bar for a password meeting every rule the app states', () => {
    const strength = passwordStrength('Kim27!ne')

    expect(strength.score).toBe(STRENGTH_SEGMENTS)
    expect(strength.level).toBe('strong')
    // And nothing nagging underneath it. There is nothing left to ask for.
    expect(strength.hint).toBeNull()
  })

  it('shows the four rules it grades, met or not, so the scale is never hidden', () => {
    expect(metKeys('Kim27!ne')).toEqual(['length', 'case', 'number', 'symbol'])

    // Nine lower-case letters: long enough to send, and nothing else.
    expect(metKeys('kimberley')).toEqual(['length'])
  })

  it('counts the rules met, one segment each', () => {
    expect(passwordStrength('kimberley').score).toBe(1) // length
    expect(passwordStrength('Kimberley').score).toBe(2) // + case
    expect(passwordStrength('Kimberle9').score).toBe(3) // + number
    expect(passwordStrength('Kimberle9!').score).toBe(4) // + symbol
  })

  // -- The floor ----------------------------------------------------------

  /**
   * The number itself, asserted as a literal and only here.
   *
   * The server's `App\Support\Auth\PasswordPolicy::MINIMUM_LENGTH` is six, set
   * by the owner on 24 August 2026 for every door at once. Written out rather
   * than derived: a test phrased in terms of the constant it is checking
   * passes whatever that constant becomes, which is exactly the drift that let
   * `DriversPage` promise twelve and `ProfilePage` promise twelve for doors
   * that held something else.
   */
  it('holds the six the server holds', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(6)
  })

  it('is too short one character below the floor, and not at it', () => {
    const under = 'k'.repeat(MIN_PASSWORD_LENGTH - 1)
    const exact = 'Kim27!ne'.slice(0, MIN_PASSWORD_LENGTH)

    expect(passwordStrength(under).level).toBe('too-short')
    expect(passwordStrength(exact).level).not.toBe('too-short')
  })

  it('says nothing at all about an empty box', () => {
    // A meter that shouts "Too short" before a key is pressed is a form
    // telling somebody off for not having started.
    const strength = passwordStrength('')

    expect(strength.score).toBe(0)
    expect(strength.label).toBe('')
    expect(strength.hint).toBeNull()
  })

  it('counts down the characters still needed, rather than restating the rule', () => {
    // "2 more characters" is actionable without re-counting what you typed.
    expect(passwordStrength('k'.repeat(MIN_PASSWORD_LENGTH - 2)).hint).toBe(
      '2 more characters to go.',
    )
    expect(passwordStrength('k'.repeat(MIN_PASSWORD_LENGTH - 1)).hint).toBe(
      '1 more character to go.',
    )
  })

  it('scores nothing below the floor, whatever else is in there', () => {
    // Every rule met — upper, lower, digit, symbol — and still too short to
    // send. The bar must not reward what the form will refuse.
    const allFourButShort = ('Sh0!' + 'a'.repeat(MIN_PASSWORD_LENGTH)).slice(
      0,
      MIN_PASSWORD_LENGTH - 1,
    )

    expect(allFourButShort).toHaveLength(MIN_PASSWORD_LENGTH - 1)
    expect(passwordStrength(allFourButShort).score).toBe(0)
    expect(passwordStrength(allFourButShort).level).toBe('too-short')
  })

  /**
   * The first segment is an acknowledgement, not an achievement: this is a
   * password the form will accept. Mutation check — start the count at zero
   * and a legal password draws an empty bar, which reads as a refusal.
   */
  it('fills one segment the moment the password is long enough to send', () => {
    expect(passwordStrength('kimberley').score).toBeGreaterThanOrEqual(1)
  })

  // -- The second road, for the passphrase --------------------------------

  it('lets length alone reach the top of the meter', () => {
    const strength = passwordStrength('my blue kettle sings')

    expect(strength.score).toBe(STRENGTH_SEGMENTS)
    expect(strength.level).toBe('strong')
    // Two of the four rules are unticked. A full bar over unticked boxes reads
    // as a bug unless something says why, and this is the only case where the
    // checklist cannot speak for itself.
    expect(strength.hint).toBe('Long enough that the rest is optional.')
  })

  it('never marks a passphrase down for being one', () => {
    // Asserted as a relation rather than as fixed scores: the claim is that
    // length is never *punished*, and fixed numbers would let a rescale pass
    // while inverting it.
    const scramble = passwordStrength('Xf7!qR2$').score
    const passphrase = passwordStrength('my blue kettle sings').score

    expect(passphrase).toBeGreaterThanOrEqual(scramble)
  })

  /**
   * The bar only ever goes up while somebody is typing.
   *
   * A meter that fell as a password grew would be read as a bug, and rightly:
   * both roads are counts of things earned and neither takes one away.
   * Mutation check — make any step subtract and this fails.
   */
  it('never falls as a password gets longer', () => {
    let previous = 0

    for (let length = MIN_PASSWORD_LENGTH; length <= 30; length += 1) {
      const { score } = passwordStrength('my blue kettle sings loudly at dawn'.slice(0, length))

      expect(score, String(length)).toBeGreaterThanOrEqual(previous)
      previous = score
    }
  })

  // -- Junk that ticks every box ------------------------------------------

  it('refuses to be impressed by one character repeated', () => {
    const strength = passwordStrength('k'.repeat(30))

    expect(strength.score).toBe(1)
    expect(strength.level).toBe('weak')
    expect(strength.hint).toBe('One character repeated is one character to guess.')
  })

  it('refuses to be impressed by a short pattern repeated', () => {
    const strength = passwordStrength('abababababab')

    expect(strength.score).toBe(1)
    expect(strength.hint).toBe(
      'A repeated pattern is only as hard to guess as the part that repeats.',
    )
  })

  /**
   * New on this side, and it matters more at six than it did at eight: at
   * exactly the floor, a run along the keyboard is the single likeliest thing
   * a hurried person types, and every guessing list starts at "123456".
   */
  it('names a straight run along the keyboard, forwards or backwards', () => {
    expect(passwordStrength('123456').score).toBe(1)
    expect(passwordStrength('654321').score).toBe(1)
    expect(passwordStrength('abcdefghijkl').hint).toBe(
      'Keys in order are the first thing anyone tries.',
    )
  })

  /**
   * The case that proves the checklist is not the whole story. "Password1234!"
   * ticks every one of the four rules and is the first thing anyone guesses; a
   * meter that only counted ticks would call it Strong.
   */
  it('names the obvious guesses rather than scoring them, however well they tick', () => {
    expect(metKeys('Password1234!')).toEqual(['length', 'case', 'number', 'symbol'])

    const strength = passwordStrength('Password1234!')

    expect(strength.score).toBe(1)
    expect(strength.hint).toBe('That contains one of the first passwords anyone would guess.')
  })

  /**
   * The unanchored match, which this file did not have before the back-port.
   * "Kangaru2024!" was already caught by the anchored version; "myKangaru2024"
   * was not, and it is the same guess with a run-up.
   */
  it("catches the platform's own name wherever it appears, not only at the start", () => {
    expect(passwordStrength('KangaruRide2024').score).toBe(1)
    expect(passwordStrength('myKangaru2024!!').score).toBe(1)
    expect(passwordStrength('kampala is home').score).toBe(1)
  })

  // -- What the bar says out loud -----------------------------------------

  it('gives every level a word, because colour alone carries no meaning', () => {
    // `docs/screen-rules.md` §6. A bar with no label is unreadable to a
    // colour-blind user and to anyone glancing at a screen in the sun.
    for (const sample of ['kimberley', 'Kimberley', 'Kimberle9', 'Kim27!ne']) {
      expect(passwordStrength(sample).label, sample).not.toBe('')
    }
  })

  it('stops advising once the checklist is saying it', () => {
    expect(passwordStrength('Kimberley').hint).toBeNull()
    expect(passwordStrength('Kim27!ne').hint).toBeNull()
  })

  it('never scores above the segments the bar draws, or below one for a legal password', () => {
    const samples = [
      'kimberley',
      'Kim27!ne',
      'Ab3!kettle sings loudly and long enough to run out of segments',
      'kkkkkkkkkkkkkkkk',
      'my blue kettle sings',
    ]

    for (const sample of samples) {
      const { score } = passwordStrength(sample)

      expect(score, sample).toBeGreaterThanOrEqual(1)
      expect(score, sample).toBeLessThanOrEqual(STRENGTH_SEGMENTS)
    }
  })

  it('always grades exactly the four rules, whatever is typed', () => {
    // Counted, not merely present: a scale that quietly dropped a rule would
    // still satisfy an assertion that some requirements came back.
    for (const sample of ['', 'a', 'kimberley', 'Kim27!ne', '!'.repeat(64)]) {
      expect(passwordStrength(sample).requirements, sample).toHaveLength(STRENGTH_SEGMENTS)
    }
  })
})
