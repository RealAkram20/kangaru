import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PasswordMeter } from './PasswordMeter'
import { MIN_PASSWORD_LENGTH, STRENGTH_SEGMENTS } from '../../auth/passwordStrength'

/**
 * The console's password meter.
 *
 * The scoring is pinned in `auth/passwordStrength.test.ts`; what is pinned
 * here is the half a unit test of the scorer cannot see — that the scale
 * reaches the screen, that a screen reader is told what the bar shows, and
 * that nothing is said at all before somebody has typed.
 */
describe('PasswordMeter', () => {
  it('says nothing at all about an empty box', () => {
    // A meter reading "Too short" against a field nobody has touched is a
    // scolding, not a guide. Asserted as an absence because an absence is
    // what regresses silently.
    const { container } = render(<PasswordMeter password="" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders the four rules it grades, so the scale is never hidden', () => {
    render(<PasswordMeter password="kimberley" />)

    // Counted, not merely found. An assertion that "6 characters or more" is
    // on screen passes just as happily when the other three rules have been
    // dropped — and a bar scored out of four against one visible rule is the
    // hidden standard this component exists to remove.
    expect(screen.getAllByRole('listitem')).toHaveLength(STRENGTH_SEGMENTS)

    expect(screen.getByText(`${MIN_PASSWORD_LENGTH} characters or more`)).toBeInTheDocument()
    expect(screen.getByText('Upper and lower case')).toBeInTheDocument()
    expect(screen.getByText('A number')).toBeInTheDocument()
    expect(screen.getByText('A symbol')).toBeInTheDocument()
  })

  it('says met or not in words, never in colour alone', () => {
    // `docs/screen-rules.md` §6. Nine lower-case letters: long enough to send,
    // and nothing else met.
    render(<PasswordMeter password="kimberley" />)

    const rules = screen.getAllByRole('listitem')

    expect(rules[0]).toHaveTextContent(`Met: ${MIN_PASSWORD_LENGTH} characters or more`)
    expect(rules[1]).toHaveTextContent('Not yet: Upper and lower case')
    expect(rules[2]).toHaveTextContent('Not yet: A number')
    expect(rules[3]).toHaveTextContent('Not yet: A symbol')
  })

  it('tells a screen reader the count as well as the word', () => {
    // The segments are `aria-hidden`, so "2 of 4" is the thing a sighted user
    // reads off the bar and a blind one would otherwise never get.
    render(<PasswordMeter password="Kimberley" />)

    expect(screen.getByText(`Password strength: Fair, 2 of ${STRENGTH_SEGMENTS}.`)).toBeVisible()
  })

  it('fills every segment for a password meeting every rule', () => {
    const { container } = render(<PasswordMeter password="Kim27!ne" />)

    expect(screen.getByText('Strong')).toBeInTheDocument()

    // The bar itself, counted: four boxes drawn, four filled. The regression
    // this replaces filled two of four for exactly this password.
    const segments = [...container.querySelectorAll('span')].filter(
      (node) => node.style.height === '4px',
    )

    expect(segments).toHaveLength(STRENGTH_SEGMENTS)
    expect(
      segments.filter((node) => node.style.background !== 'var(--surface-sunken)'),
    ).toHaveLength(STRENGTH_SEGMENTS)
  })

  it('announces its advice politely, because it changes on every keystroke', () => {
    // An assertive region would interrupt the typing it is describing.
    render(<PasswordMeter password="Password1234!" />)

    const hint = screen.getByText('That contains one of the first passwords anyone would guess.')

    expect(hint).toHaveAttribute('aria-live', 'polite')
  })

  it('is silent once the checklist is saying it for itself', () => {
    // A meter that always has something to say is one people stop reading.
    render(<PasswordMeter password="Kim27!ne" />)

    expect(screen.queryByText(/to go\.|guess|optional/)).not.toBeInTheDocument()
  })
})
