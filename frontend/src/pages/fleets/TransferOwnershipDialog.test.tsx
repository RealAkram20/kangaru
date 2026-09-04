import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Operator } from '../../types/operator'
import { apiFailure, apiOk, makeUser, renderAs } from '../../test/harness'
import { TransferOwnershipDialog } from './TransferOwnershipDialog'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

const { apiClient } = await import('../../lib/apiClient')
const put = vi.mocked(apiClient.put)

const HEAD_OFFICE = makeUser({ role: 'super_admin', access_level: 'kangaru', tenant_id: null })

const FLEET: Operator = {
  id: 2,
  name: 'Susan Nanyanzi',
  slug: 'susan-nanyanzi',
  status: 'active',
  is_active: true,
  plan: { id: 1, name: 'Free', is_default: true },
  created_at: '2026-08-22T00:00:00.000000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
})

function open() {
  const onDone = vi.fn()
  renderAs(<TransferOwnershipDialog fleet={FLEET} onClose={vi.fn()} onDone={onDone} />, HEAD_OFFICE)
  return onDone
}

it('sends the proposal to the transfer route, and hands back the pending fleet', async () => {
  const pending = {
    ...FLEET,
    pending_owner: { name: 'Grace Auma', email: 'grace@fleet.test', expires_at: '2026-08-31T00:00:00Z' },
  }
  put.mockResolvedValue(apiOk(pending))
  const onDone = open()

  await userEvent.type(screen.getByLabelText(/new owner/i), 'Grace Auma')
  await userEvent.type(screen.getByLabelText(/email/i), 'grace@fleet.test')
  await userEvent.click(screen.getByRole('button', { name: /send invitation/i }))

  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/operators/2/owner', {
      name: 'Grace Auma',
      email: 'grace@fleet.test',
    }),
  )
  expect(onDone).toHaveBeenCalledWith(pending)
})

/**
 * An address that already signs in is refused under the field — handing a
 * fleet to an existing account is an act the platform does not offer, and
 * the refusal has to land where the address was typed.
 */
it('puts a taken address under the field that caused it', async () => {
  put.mockRejectedValue(
    apiFailure(422, 'VALIDATION_FAILED', 'The given data was invalid.', {
      email: ['The email has already been taken.'],
    }),
  )
  const onDone = open()

  await userEvent.type(screen.getByLabelText(/new owner/i), 'The Same Person')
  await userEvent.type(screen.getByLabelText(/email/i), 'sitting@fleet.test')
  await userEvent.click(screen.getByRole('button', { name: /send invitation/i }))

  expect(await screen.findByText(/already been taken/i)).toBeInTheDocument()
  expect(onDone).not.toHaveBeenCalled()
})
