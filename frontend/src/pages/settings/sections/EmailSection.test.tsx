import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { apiOk, makeUser, renderAs } from '../../../test/harness'
import { EmailSection } from './EmailSection'

vi.mock('../../../lib/apiClient', () => ({ apiClient: { get: vi.fn(), put: vi.fn() } }))

const { apiClient } = await import('../../../lib/apiClient')
const get = vi.mocked(apiClient.get)
const put = vi.mocked(apiClient.put)

const HEAD_OFFICE = makeUser({
  role: 'super_admin',
  access_level: 'kangaru',
  tenant_id: null,
})

const SECTION = {
  id: 'email-notifications',
  group: 'email-notifications',
  label: 'Which emails',
  icon: 'bell',
  title: 'Which emails go out',
  description: 'Switch off the ones your office does not want.',
} as const

function listing() {
  get.mockResolvedValue(
    apiOk([
      { type: 'booking.approved', label: 'Booking approved', required: false, enabled: true },
      { type: 'trip.completed', label: 'Trip completed', required: false, enabled: false },
      { type: 'account.password_changed', label: 'Password changed', required: true, enabled: true },
    ]),
  )
}

function render() {
  return renderAs(
    <EmailSection settings={{} as never} onSaved={() => {}} section={SECTION as never} />,
    HEAD_OFFICE,
  )
}

beforeEach(() => vi.clearAllMocks())

it('separates what can be switched from what is always sent', async () => {
  listing()
  render()

  expect(await screen.findByLabelText('Booking approved')).toBeEnabled()

  /*
   * Required emails are listed and locked, never hidden. Somebody looking for
   * "why did nobody get the password reset email" has to find it here and see
   * that it cannot be moved; a hidden row leaves them hunting for a control
   * that does not exist.
   */
  expect(screen.getByLabelText('Password changed')).toBeDisabled()
  expect(screen.getByText('Always sent')).toBeInTheDocument()
})

it('saves one switch per click, with no Save button to forget', async () => {
  listing()
  put.mockResolvedValue(apiOk(null))

  render()

  await userEvent.click(await screen.findByLabelText('Booking approved'))

  expect(put).toHaveBeenCalledWith('/settings/email', {
    type: 'booking.approved',
    enabled: false,
  })

  // No batch to lose, so a Save button would only add a step and a way to walk
  // away from a decision the user thinks they made.
  expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
})

it('puts the switch back when the server refuses', async () => {
  listing()
  // The real envelope shape. `apiError` requires `success: false` and a
  // string `code` before it will trust a server message, which is what stops
  // a proxy's HTML error page being rendered as if it came from us.
  put.mockRejectedValue({
    isAxiosError: true,
    response: {
      status: 422,
      data: {
        success: false,
        code: 'VALIDATION_FAILED',
        message: 'The given data was invalid.',
        errors: { type: ['That email cannot be switched off.'] },
      },
    },
  })

  render()

  const control = await screen.findByLabelText('Booking approved')
  await userEvent.click(control)

  /*
   * The switch moves before the request so it answers the click immediately,
   * which matters on the connections PRODUCT.md describes. That optimism is
   * only honest if it is taken back on failure: a control left in a position
   * the server rejected is a screen telling the user something untrue.
   */
  expect(await screen.findByRole('alert')).toHaveTextContent('That email cannot be switched off.')
  expect(control).toBeChecked()
})

it('says so when the list cannot be loaded', async () => {
  get.mockRejectedValue({
    isAxiosError: true,
    response: {
      status: 403,
      data: {
        success: false,
        code: 'FORBIDDEN',
        message: 'This action is unauthorized.',
        errors: {},
      },
    },
  })

  render()

  expect(await screen.findByRole('alert')).toHaveTextContent('This action is unauthorized.')
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
})
