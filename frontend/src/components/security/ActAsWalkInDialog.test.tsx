import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { ActAsWalkInDialog } from './ActAsWalkInDialog'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
  clearStoredCustomerToken: vi.fn(),
}))

const { apiClient, clearStoredCustomerToken } = await import('../../lib/apiClient')
const post = vi.mocked(apiClient.post)
const clearCustomerToken = vi.mocked(clearStoredCustomerToken)

const WALK_IN = { id: 12, name: 'Achen Brenda' }

beforeEach(() => {
  vi.clearAllMocks()
  // `window.location.assign` is a navigation jsdom refuses to perform; the
  // dialog's last act is one, so it is replaced rather than asserted around.
  Object.defineProperty(window, 'location', {
    value: { assign: vi.fn(), pathname: '/customers' },
    writable: true,
  })
})

/**
 * ADR-0066 §2 gives support full reach minus the identity acts, which is a
 * materially different thing to start than a session against a dispatcher.
 * The reach is stated here or it is stated nowhere in the console.
 */
it('says what the session will let the agent do before they start it', async () => {
  render(<ActAsWalkInDialog customer={WALK_IN} onClose={() => {}} />)

  expect(screen.getByText(/cancel it, and place an\s+order for them/i)).toBeInTheDocument()
  expect(screen.getByText(/cannot change their password/i)).toBeInTheDocument()
  expect(screen.getByText(/emailed that\s+you opened their account/i)).toBeInTheDocument()
})

/**
 * No roster and no picker. A walk-in *is* the person, so the question the
 * corporate dialog asks — which of these people — has one answer here, and a
 * picker with one option is a question that should not have been asked.
 */
it('asks only for a reason, because there is nobody to choose', () => {
  render(<ActAsWalkInDialog customer={WALK_IN} onClose={() => {}} />)

  expect(screen.getByRole('heading', { name: /Log in as Achen Brenda/ })).toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.getByLabelText(/Reason/)).toBeInTheDocument()
})

it('will not start until the reason is a real one', async () => {
  const user = userEvent.setup()
  render(<ActAsWalkInDialog customer={WALK_IN} onClose={() => {}} />)

  const start = screen.getByRole('button', { name: /Start 30-minute session/ })
  expect(start).toBeDisabled()

  // The server's own floor is eight characters — "a ticket number and what you
  // are trying to see" — so the button matches it rather than inventing one.
  await user.type(screen.getByLabelText(/Reason/), 'help')
  expect(start).toBeDisabled()

  await user.type(screen.getByLabelText(/Reason/), ' with ride KR-4021')
  expect(start).toBeEnabled()
})

it('names the walk-in table, and lands the agent on the order flow', async () => {
  post.mockResolvedValue({ data: { data: { id: 1 } } } as never)

  const user = userEvent.setup()
  render(<ActAsWalkInDialog customer={WALK_IN} onClose={() => {}} />)

  await user.type(screen.getByLabelText(/Reason/), 'Ticket 918 — their car never arrived')
  await user.click(screen.getByRole('button', { name: /Start 30-minute session/ }))

  // `subject_type`, and it is not decoration: the two id spaces overlap, so
  // without it the server would resolve user 12 and the agent would become
  // somebody they never named.
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/support/act-as', {
      subject_type: 'customer',
      subject_id: 12,
      reason: 'Ticket 918 — their car never arrived',
    }),
  )

  // The order flow, not /dashboard. The staff console answers 403 for
  // everything but the banner while this session is live (ADR-0066 §5).
  expect(window.location.assign).toHaveBeenCalledWith('/order')
})

/**
 * `apiClient` prefers a stored customer token over the staff one on
 * `/customer/*`, which is right — a real walk-in on this browser must never be
 * displaced. It has the wrong effect here: the agent would be served as
 * whichever customer last signed in on this machine, with the banner naming
 * somebody else entirely.
 */
it('clears a stale walk-in session on this browser before it hands over', async () => {
  post.mockResolvedValue({ data: { data: { id: 1 } } } as never)

  const user = userEvent.setup()
  render(<ActAsWalkInDialog customer={WALK_IN} onClose={() => {}} />)

  await user.type(screen.getByLabelText(/Reason/), 'Ticket 918 — their car never arrived')
  await user.click(screen.getByRole('button', { name: /Start 30-minute session/ }))

  await waitFor(() => expect(clearCustomerToken).toHaveBeenCalled())
})

it('keeps the agent on the dialog when the server refuses', async () => {
  // Shaped as axios shapes it, envelope and all. `apiError` reads `code` and
  // `success: false` and falls back to its own sentence otherwise, so a
  // loosely-shaped mock would have asserted the fallback and proved nothing
  // about the server's message reaching the screen.
  post.mockRejectedValue({
    isAxiosError: true,
    response: {
      status: 422,
      data: {
        success: false,
        code: 'VALIDATION_FAILED',
        message: 'End the session you already have open before starting another.',
        errors: {},
      },
    },
  })

  const user = userEvent.setup()
  render(<ActAsWalkInDialog customer={WALK_IN} onClose={() => {}} />)

  await user.type(screen.getByLabelText(/Reason/), 'Ticket 918 — their car never arrived')
  await user.click(screen.getByRole('button', { name: /Start 30-minute session/ }))

  expect(await screen.findByText(/already have open/)).toBeInTheDocument()
  expect(window.location.assign).not.toHaveBeenCalled()
  expect(clearCustomerToken).not.toHaveBeenCalled()
})
