import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, makeUser, renderAs } from '../test/harness'
import { ProfilePage } from './ProfilePage'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

const { apiClient } = await import('../lib/apiClient')
const patch = vi.mocked(apiClient.patch)
const post = vi.mocked(apiClient.post)

beforeEach(() => {
  vi.clearAllMocks()
})

async function fillPassword(current = 'password', next = 'a-much-longer-one') {
  await userEvent.type(screen.getByLabelText(/Current password/i), current)
  await userEvent.type(screen.getByLabelText(/^New password/i), next)
  await userEvent.type(screen.getByLabelText(/Confirm new password/i), next)
  await userEvent.click(screen.getByRole('button', { name: /Change password/i }))
}

describe('ProfilePage — password', () => {
  it('sends the change with its confirmation', async () => {
    patch.mockResolvedValue(apiOk(null))

    renderAs(<ProfilePage />)
    await fillPassword()

    // The current password is sent even though the caller is signed in: a
    // bearer token proves a session, not ownership of the account.
    expect(patch).toHaveBeenCalledWith('/auth/password', {
      current_password: 'password',
      password: 'a-much-longer-one',
      password_confirmation: 'a-much-longer-one',
    })
  })

  /**
   * The endpoint revokes every token including the caller's. Leaving the
   * form looking usable would mean the next click 401s and bounces the user
   * to /login with no explanation — an app that logged them out for no
   * reason.
   */
  it('tells the user they have been signed out everywhere', async () => {
    patch.mockResolvedValue(apiOk(null))

    renderAs(<ProfilePage />)
    await fillPassword()

    expect(await screen.findByText(/Password changed/i)).toBeVisible()
    expect(screen.getByText(/signed out on every device/i)).toBeVisible()
    expect(screen.getByRole('button', { name: /Sign in again/i })).toBeVisible()

    // And the form is gone, rather than inviting a second submission on a
    // token that no longer works.
    expect(screen.queryByLabelText(/Current password/i)).toBeNull()
  })

  it('puts a wrong current password on the field that was wrong', async () => {
    patch.mockRejectedValue(
      apiFailure(422, 'INVALID_CREDENTIALS', 'Your current password is incorrect.', {
        current_password: ['Your current password is incorrect.'],
      }),
    )

    renderAs(<ProfilePage />)
    await fillPassword('wrong-one')

    expect(await screen.findByText('Your current password is incorrect.')).toBeVisible()
    // Still on the form — this is a correctable mistake, not a dead end.
    expect(screen.getByLabelText(/Current password/i)).toBeVisible()
  })
})

describe('ProfilePage — two-factor', () => {
  const enrolled = makeUser({ role: 'finance', tenant_id: null, mfa_enabled: true })

  it('shows a privileged user their factor is on, and offers new codes', async () => {
    renderAs(<ProfilePage />, enrolled)

    expect(screen.getByText('On')).toBeVisible()
    expect(screen.getByRole('button', { name: /Generate new recovery codes/i })).toBeVisible()
  })

  it('shows the new codes once, with the warning', async () => {
    post.mockResolvedValue(apiOk({ recovery_codes: ['AAAAA-11111', 'BBBBB-22222'] }))

    renderAs(<ProfilePage />, enrolled)
    await userEvent.click(screen.getByRole('button', { name: /Generate new recovery codes/i }))

    expect(await screen.findByText('AAAAA-11111')).toBeVisible()
    expect(screen.getByText(/shown once/i)).toBeVisible()
    // The blunt part matters: no administrator can restore the account.
    expect(screen.getByText(/no administrator can restore this account/i)).toBeVisible()
  })

  it('says so plainly when the request fails', async () => {
    post.mockRejectedValue(apiFailure(403, 'MFA_ENROLMENT_REQUIRED', 'Set up two-factor first.'))

    renderAs(<ProfilePage />, enrolled)
    await userEvent.click(screen.getByRole('button', { name: /Generate new recovery codes/i }))

    expect(await screen.findByText('Set up two-factor first.')).toBeVisible()
  })

  /**
   * No "turn it on" button for a role that does not require a factor, and
   * that is a limitation rather than an omission: `AuthService::login` only
   * issues a challenge when the *role* requires one, so an unprivileged
   * user who enrolled would hold an authenticator nothing ever asks for.
   */
  it('offers an unprivileged user no way to enable a factor that would be ignored', async () => {
    renderAs(<ProfilePage />, makeUser({ role: 'corporate_admin', mfa_enabled: false }))

    expect(screen.getByText('Off')).toBeVisible()
    expect(screen.queryByRole('button', { name: /Set up|Turn on|Enable/i })).toBeNull()
    expect(screen.getByText(/not yet offered for other roles/i)).toBeVisible()
  })
})
