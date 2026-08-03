import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type LoginOutcome } from '../auth/AuthContext'
import { render } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { apiFailure } from '../test/harness'
import { LoginPage } from './LoginPage'

/**
 * ADR-0008's two-step login, from the screen's side.
 *
 * Rendered against a hand-built AuthContext rather than `renderAs`, because
 * these tests are *about* `login` and `verifyMfa` — the harness stubs both
 * to resolve instantly, which is exactly what must not happen here.
 */
function renderLogin(overrides: {
  login?: (email: string, password: string) => Promise<LoginOutcome>
  verifyMfa?: (challengeId: string, code: string) => Promise<LoginOutcome>
}) {
  return render(
    <StrictMode>
      <MemoryRouter>
        <AuthContext.Provider
          value={{
            user: null,
            loading: false,
            login: overrides.login ?? (() => Promise.resolve({ status: 'signed-in' })),
            verifyMfa: overrides.verifyMfa ?? (() => Promise.resolve({ status: 'signed-in' })),
            logout: () => Promise.resolve(),
            mustEnrolMfa: false,
            markMfaEnrolled: () => {},
          }}
        >
          <LoginPage />
        </AuthContext.Provider>
      </MemoryRouter>
    </StrictMode>,
  )
}

async function signIn(email = 'finance@kangaruride.test', password = 'password') {
  await userEvent.type(screen.getByLabelText(/Work email/i), email)
  await userEvent.type(screen.getByLabelText(/^Password/i), password)
  await userEvent.click(screen.getByRole('button', { name: /^Sign in$/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('LoginPage', () => {
  it('signs an unprivileged user straight in, with no second step', async () => {
    const login = vi.fn().mockResolvedValue({ status: 'signed-in' } satisfies LoginOutcome)

    renderLogin({ login })
    await signIn('staff@centenary-bank.test')

    expect(login).toHaveBeenCalledWith('staff@centenary-bank.test', 'password')
    // PROJECT.md keeps MFA out of Phase 1 for other roles, and the Bank's
    // acceptance criteria are demonstrated through a Corporate Admin.
    expect(screen.queryByLabelText(/Authentication code/i)).toBeNull()
  })

  it('asks for a code when the password alone was not enough', async () => {
    const login = vi
      .fn()
      .mockResolvedValue({ status: 'mfa-required', challengeId: 'ch_1' } satisfies LoginOutcome)

    renderLogin({ login })
    await signIn()

    expect(await screen.findByLabelText(/Authentication code/i)).toBeVisible()
    expect(screen.getByText(/Two-factor authentication/i)).toBeVisible()
  })

  it('exchanges the code for a session', async () => {
    const verifyMfa = vi.fn().mockResolvedValue({ status: 'signed-in' } satisfies LoginOutcome)

    renderLogin({
      login: () => Promise.resolve({ status: 'mfa-required', challengeId: 'ch_42' }),
      verifyMfa,
    })
    await signIn()

    await userEvent.type(await screen.findByLabelText(/Authentication code/i), '123456')
    await userEvent.click(screen.getByRole('button', { name: /Verify and sign in/i }))

    // The challenge id travels in memory, never in the URL — it is
    // single-use credential material with a five-minute life.
    expect(verifyMfa).toHaveBeenCalledWith('ch_42', '123456')
  })

  /**
   * The server spends a challenge whether or not the code was right,
   * because a challenge surviving a wrong code would turn its five-minute
   * window into an unlimited guessing budget against six digits. So the
   * screen must not offer a retry against a ticket that is already void.
   */
  it('sends the user back to the password after a rejected code', async () => {
    renderLogin({
      login: () => Promise.resolve({ status: 'mfa-required', challengeId: 'ch_9' }),
      verifyMfa: () =>
        Promise.reject(apiFailure(401, 'MFA_CODE_INVALID', 'That code is not correct.')),
    })
    await signIn()

    await userEvent.type(await screen.findByLabelText(/Authentication code/i), '000000')
    await userEvent.click(screen.getByRole('button', { name: /Verify and sign in/i }))

    expect(await screen.findByLabelText(/Work email/i)).toBeVisible()
    expect(screen.queryByLabelText(/Authentication code/i)).toBeNull()
  })

  it('lets the user back out of the code step', async () => {
    renderLogin({ login: () => Promise.resolve({ status: 'mfa-required', challengeId: 'ch_2' }) })
    await signIn()

    await userEvent.click(await screen.findByRole('button', { name: /Back to sign in/i }))

    expect(screen.getByLabelText(/Work email/i)).toBeVisible()
  })

  it('explains a throttled login rather than calling it a typo', async () => {
    renderLogin({
      login: () => Promise.reject(apiFailure(429, 'TOO_MANY_REQUESTS', 'Too many attempts.')),
    })
    await signIn()

    // The pre-existing behaviour, asserted here because the MFA branch
    // restructured this component around it.
    expect(await screen.findByRole('alert')).toHaveTextContent(/wait a minute/i)
  })
})
