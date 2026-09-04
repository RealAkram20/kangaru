import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { apiFailure, renderAs } from '../test/harness'
import { ForgotPasswordPage } from './ForgotPasswordPage'

vi.mock('../lib/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }))

const { apiClient } = await import('../lib/apiClient')
const post = vi.mocked(apiClient.post)

const navigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')

  return { ...actual, useNavigate: () => navigate }
})

beforeEach(() => vi.clearAllMocks())

/** The 202's envelope, whose message the code step shows verbatim. */
const SENT = {
  data: {
    success: true,
    message: 'If that email belongs to an account, a reset code is on its way. It expires in 15 minutes.',
    data: null,
  },
}

/**
 * `renderAs(..., null)` throughout: a signed-in user is redirected away,
 * and the whole audience of this page is somebody without a session.
 */
function renderForgot(state?: { email: string }) {
  return renderAs(
    <MemoryRouter initialEntries={[{ pathname: '/forgot-password', state }]}>
      <ForgotPasswordPage />
    </MemoryRouter>,
    null,
  )
}

async function requestCode(email = 'ops@shanitah.test') {
  const field = screen.getByLabelText(/Work email/i)
  if (email !== '') await userEvent.type(field, email)
  await userEvent.click(screen.getByRole('button', { name: /Email me a code/i }))
}

it('asks for a code and advances, repeating the server\'s own sentence', async () => {
  post.mockResolvedValue(SENT)

  renderForgot()
  await requestCode()

  expect(post).toHaveBeenCalledWith('/auth/password/forgot', { email: 'ops@shanitah.test' })
  // The sentence is the server's because only the server can word it for
  // both worlds: the email may or may not belong to anybody, and this page
  // must not know which (ADR-0028 §2, the oracle refusal).
  expect(await screen.findByRole('status')).toHaveTextContent(/reset code is on its way/i)
  expect(screen.getByLabelText(/6-digit code/i)).toBeVisible()
})

it('arrives already knowing the email typed on the sign-in page', async () => {
  post.mockResolvedValue(SENT)

  renderForgot({ email: 'finance@shanitah.test' })

  expect(screen.getByLabelText(/Work email/i)).toHaveValue('finance@shanitah.test')

  await requestCode('')
  expect(post).toHaveBeenCalledWith('/auth/password/forgot', { email: 'finance@shanitah.test' })
})

it('refuses two passwords that do not match, without asking the server', async () => {
  post.mockResolvedValue(SENT)

  renderForgot()
  await requestCode()

  await userEvent.type(screen.getByLabelText(/6-digit code/i), '123456')
  await userEvent.type(screen.getByLabelText(/New password/i), 'kampala-1')
  await userEvent.type(screen.getByLabelText(/Confirm password/i), 'kampala-2')
  post.mockClear()
  await userEvent.click(screen.getByRole('button', { name: /Set password/i }))

  expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i)
  expect(post).not.toHaveBeenCalled()
})

it('lands on sign-in once the password is set, never signed in here', async () => {
  post.mockResolvedValue(SENT)

  renderForgot()
  await requestCode()

  await userEvent.type(screen.getByLabelText(/6-digit code/i), '123456')
  await userEvent.type(screen.getByLabelText(/New password/i), 'kampala-9')
  await userEvent.type(screen.getByLabelText(/Confirm password/i), 'kampala-9')
  await userEvent.click(screen.getByRole('button', { name: /Set password/i }))

  expect(post).toHaveBeenLastCalledWith('/auth/password/reset', {
    email: 'ops@shanitah.test',
    code: '123456',
    password: 'kampala-9',
    password_confirmation: 'kampala-9',
  })
  // A reset proves control of an inbox, not a second factor — the roles
  // ADR-0008 gates still owe their code at the door.
  expect(navigate).toHaveBeenCalledWith('/login', { replace: true })
})

it('shows the server\'s sentence for a wrong or spent code, and stays put', async () => {
  post.mockResolvedValue(SENT)

  renderForgot()
  await requestCode()

  post.mockRejectedValue(
    apiFailure(422, 'VALIDATION_FAILED', 'That code did not match, or it has expired. Ask for a new one and try again.'),
  )
  await userEvent.type(screen.getByLabelText(/6-digit code/i), '000000')
  await userEvent.type(screen.getByLabelText(/New password/i), 'kampala-9')
  await userEvent.type(screen.getByLabelText(/Confirm password/i), 'kampala-9')
  await userEvent.click(screen.getByRole('button', { name: /Set password/i }))

  expect(await screen.findByRole('alert')).toHaveTextContent(/did not match, or it has expired/i)
  expect(screen.getByLabelText(/6-digit code/i)).toBeVisible()
  expect(navigate).not.toHaveBeenCalled()
})

it('repeats the server\'s refusal when the owner has the method off', async () => {
  // The 409 backstop for a stale client (the link itself is gated on the
  // public settings, but a bookmark outlives a setting).
  post.mockRejectedValue(
    apiFailure(409, 'AUTH_METHOD_DISABLED', 'Password reset is switched off. Contact your administrator.'),
  )

  renderForgot()
  await requestCode()

  expect(await screen.findByRole('alert')).toHaveTextContent(/switched off/i)
  expect(screen.queryByLabelText(/6-digit code/i)).not.toBeInTheDocument()
})

it('sends a new code from the code step', async () => {
  post.mockResolvedValue(SENT)

  renderForgot()
  await requestCode()

  post.mockClear()
  post.mockResolvedValue(SENT)
  await userEvent.click(screen.getByRole('button', { name: /Send a new code/i }))

  expect(post).toHaveBeenCalledWith('/auth/password/forgot', { email: 'ops@shanitah.test' })
  expect(screen.getByLabelText(/6-digit code/i)).toBeVisible()
})
