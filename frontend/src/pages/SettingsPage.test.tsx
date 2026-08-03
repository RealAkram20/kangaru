import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, makeUser, renderAs } from '../test/harness'
import { SettingsPage } from './SettingsPage'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const { apiClient } = await import('../lib/apiClient')
const patch = vi.mocked(apiClient.patch)
const post = vi.mocked(apiClient.post)
const destroy = vi.mocked(apiClient.delete)

beforeEach(() => {
  vi.clearAllMocks()
})

async function fillPassword(current = 'password', next = 'a-much-longer-one') {
  await userEvent.type(screen.getByLabelText(/Current password/i), current)
  await userEvent.type(screen.getByLabelText(/^New password/i), next)
  await userEvent.type(screen.getByLabelText(/Confirm new password/i), next)
  await userEvent.click(screen.getByRole('button', { name: /Change password/i }))
}

describe('SettingsPage — password', () => {
  it('sends the change with its confirmation', async () => {
    patch.mockResolvedValue(apiOk(null))

    renderAs(<SettingsPage />)
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

    renderAs(<SettingsPage />)
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

    renderAs(<SettingsPage />)
    await fillPassword('wrong-one')

    expect(await screen.findByText('Your current password is incorrect.')).toBeVisible()
    // Still on the form — this is a correctable mistake, not a dead end.
    expect(screen.getByLabelText(/Current password/i)).toBeVisible()
  })
})

describe('SettingsPage — two-factor', () => {
  // A Finance officer: the factor is on because the role demands it, and
  // `mfa_required` is the server saying so — the field the page decides
  // "turn off" on, never the role slug.
  const enrolled = makeUser({
    role: 'finance',
    tenant_id: null,
    mfa_enabled: true,
    mfa_required: true,
    mfa_recovery_codes_remaining: 10,
    mfa_recovery_codes_low: false,
  })

  it('shows a privileged user their factor is on, and offers new codes', async () => {
    renderAs(<SettingsPage />, enrolled)

    expect(screen.getByText('On')).toBeVisible()
    expect(screen.getByRole('button', { name: /Generate new recovery codes/i })).toBeVisible()
  })

  it('shows the new codes once, with the warning', async () => {
    post.mockResolvedValue(apiOk({ recovery_codes: ['AAAAA-11111', 'BBBBB-22222'] }))

    renderAs(<SettingsPage />, enrolled)
    await userEvent.click(screen.getByRole('button', { name: /Generate new recovery codes/i }))

    expect(await screen.findByText('AAAAA-11111')).toBeVisible()
    expect(screen.getByText(/shown once/i)).toBeVisible()
    // The blunt part matters: no administrator can restore the account.
    expect(screen.getByText(/no administrator can restore this account/i)).toBeVisible()
  })

  it('says so plainly when the request fails', async () => {
    post.mockRejectedValue(apiFailure(403, 'MFA_ENROLMENT_REQUIRED', 'Set up two-factor first.'))

    renderAs(<SettingsPage />, enrolled)
    await userEvent.click(screen.getByRole('button', { name: /Generate new recovery codes/i }))

    expect(await screen.findByText('Set up two-factor first.')).toBeVisible()
  })

  /**
   * A required factor may not be removed — ADR-0010 decision 2 is about
   * voluntary factors only. The page must not even offer the control:
   * a button that always 403s is a lie with a click target.
   */
  it('offers a required role no way to turn its factor off', () => {
    renderAs(<SettingsPage />, enrolled)

    expect(screen.queryByRole('button', { name: /Turn off/i })).toBeNull()
    expect(screen.getByText(/required for your role and cannot be turned off/i)).toBeVisible()
  })

  it('relays the server verdict when recovery codes run low', () => {
    renderAs(
      <SettingsPage />,
      makeUser({
        role: 'corporate_admin',
        mfa_enabled: true,
        mfa_required: false,
        mfa_recovery_codes_remaining: 2,
        mfa_recovery_codes_low: true,
      }),
    )

    expect(screen.getByText(/Recovery codes running low/i)).toBeVisible()
    expect(screen.getByText(/Only 2 recovery codes left/i)).toBeVisible()
  })
})

describe('SettingsPage — voluntary two-factor (ADR-0010)', () => {
  const voluntary = makeUser({
    role: 'corporate_admin',
    mfa_enabled: true,
    mfa_required: false,
    mfa_recovery_codes_remaining: 10,
    mfa_recovery_codes_low: false,
  })

  /**
   * The old page refused to offer enrolment because login used to challenge
   * on the role, so a voluntary factor was one nothing ever asked for.
   * ADR-0010 decision 1 changed login to honour the factor; the button is
   * the other half of that decision.
   */
  it('offers an unprivileged user voluntary enrolment, QR and all', async () => {
    post.mockResolvedValue(
      apiOk({ secret: 'SECRETSECRET', otpauth_uri: 'otpauth://x', qr_svg: '<svg></svg>' }),
    )

    renderAs(<SettingsPage />, makeUser({ role: 'corporate_admin', mfa_enabled: false }))

    expect(screen.getByText('Off')).toBeVisible()
    await userEvent.click(
      screen.getByRole('button', { name: /Turn on two-factor authentication/i }),
    )

    expect(post).toHaveBeenCalledWith('/auth/mfa/enrol')
    expect(await screen.findByRole('img', { name: /QR code/i })).toBeVisible()
  })

  it('turns a voluntary factor off with a code, and re-reads the account', async () => {
    destroy.mockResolvedValue(apiOk(null))
    const refreshUser = vi.fn(() => Promise.resolve())

    renderAs(<SettingsPage />, voluntary, { refreshUser })

    await userEvent.click(screen.getByRole('button', { name: /Turn off…/i }))
    await userEvent.type(screen.getByLabelText(/to turn it off/i), '123456')
    await userEvent.click(
      screen.getByRole('button', { name: /Turn off two-factor authentication/i }),
    )

    // Axios spells a DELETE body as `data`; the code is the proof the
    // server demands, so a stolen token alone cannot strip the factor.
    expect(destroy).toHaveBeenCalledWith('/auth/mfa', { data: { code: '123456' } })
    // Re-read, not locally patched: mfa_enabled is the server's fact.
    expect(refreshUser).toHaveBeenCalled()
  })

  it('keeps the factor when the code is refused, and says why', async () => {
    destroy.mockRejectedValue(apiFailure(422, 'MFA_CODE_INVALID', 'That code was not accepted.'))

    renderAs(<SettingsPage />, voluntary)

    await userEvent.click(screen.getByRole('button', { name: /Turn off…/i }))
    await userEvent.type(screen.getByLabelText(/to turn it off/i), '000000')
    await userEvent.click(
      screen.getByRole('button', { name: /Turn off two-factor authentication/i }),
    )

    expect(await screen.findByText('That code was not accepted.')).toBeVisible()
  })
})
