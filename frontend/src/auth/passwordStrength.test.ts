import { describe, expect, it } from 'vitest'
import { MIN_PASSWORD_LENGTH, passwordStrength } from './passwordStrength'

describe('passwordStrength', () => {
  it('says nothing at all about an empty box', () => {
    // A meter that shouts "Too short" before a key is pressed is a form
    // telling somebody off for not having started.
    expect(passwordStrength('')).toMatchObject({ score: 0, label: '', hint: null })
  })

  it('marks anything under the server floor as too short, and says the number', () => {
    const result = passwordStrength('short1')

    expect(result.level).toBe('too-short')
    expect(result.score).toBe(0)
    expect(result.hint).toContain(String(MIN_PASSWORD_LENGTH))
  })

  it('rates length above character variety', () => {
    // A long passphrase beats a short scramble, which is the opposite of
    // what "must contain a symbol" rules produce.
    const passphrase = passwordStrength('correct horse battery staple')
    const scramble = passwordStrength('P@s5w!r')

    expect(passphrase.level).toBe('strong')
    expect(scramble.level).toBe('too-short')
  })

  it('refuses to be impressed by the obvious guesses', () => {
    for (const guess of ['password123', 'Password1!', 'kangaruride', 'qwerty12345']) {
      const result = passwordStrength(guess)
      expect(result.score, guess).toBe(1)
      expect(result.hint, guess).toMatch(/guess/i)
    }
  })

  it('does not reward one character typed twelve times', () => {
    expect(passwordStrength('aaaaaaaaaaaa').score).toBe(1)
  })

  it('climbs with length and then with variety', () => {
    const eight = passwordStrength('abcdefgh').score
    const twelve = passwordStrength('abcdefghijkl').score
    const mixed = passwordStrength('abcdefghijkL9').score

    expect(twelve).toBeGreaterThan(eight)
    expect(mixed).toBeGreaterThan(twelve)
  })

  it('never returns a score outside the meter it feeds', () => {
    const samples = ['', 'a', 'abcdefgh', 'correct horse battery staple', '!'.repeat(64)]

    for (const sample of samples) {
      const { score } = passwordStrength(sample)
      expect(score, sample).toBeGreaterThanOrEqual(0)
      expect(score, sample).toBeLessThanOrEqual(4)
    }
  })
})
