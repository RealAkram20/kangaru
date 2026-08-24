import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Operator } from '../../types/operator'
import { apiFailure, apiOk, makeUser, renderAs } from '../../test/harness'
import { EditFleetDialog } from './EditFleetDialog'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() },
}))

const { apiClient } = await import('../../lib/apiClient')
const get = vi.mocked(apiClient.get)
const patch = vi.mocked(apiClient.patch)
const put = vi.mocked(apiClient.put)

const PLANS = [
  { id: 1, slug: 'free', name: 'Free', description: null, is_default: true, price_minor: 0, currency: 'UGX', period: 'none', driver_limit: 2, vehicle_limit: 2, staff_limit: 2 },
  { id: 2, slug: 'founding-fleet', name: 'Founding fleet', description: null, is_default: false, price_minor: 0, currency: 'UGX', period: 'none', driver_limit: null, vehicle_limit: null, staff_limit: null },
]

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
  get.mockResolvedValue(apiOk(PLANS))
})

function open() {
  const onDone = vi.fn()
  renderAs(<EditFleetDialog fleet={FLEET} onClose={vi.fn()} onDone={onDone} />, HEAD_OFFICE)
  return onDone
}

it('opens on what the fleet actually holds, rather than on an empty form', async () => {
  open()

  expect(await screen.findByLabelText(/fleet name/i)).toHaveValue(FLEET.name)
  await waitFor(() => expect(screen.getByLabelText(/plan/i)).toHaveValue('1'))
})

it('offers nothing to save until something has actually changed', async () => {
  open()

  const save = await screen.findByRole('button', { name: /save changes/i })
  expect(save).toBeDisabled()

  await userEvent.type(screen.getByLabelText(/fleet name/i), 'x')

  await waitFor(() => expect(save).toBeEnabled())
})

it('sends only the name when only the name moved', async () => {
  patch.mockResolvedValue(apiOk({ ...FLEET, name: 'Nanyanzi Transport Ltd' }))
  open()

  const name = await screen.findByLabelText(/fleet name/i)
  await userEvent.clear(name)
  await userEvent.type(name, 'Nanyanzi Transport Ltd')
  await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1))
  // The exact body: a payload carrying `plan_id` would be the unguarded plan
  // move `UpdateOperatorRequest` no longer accepts.
  expect(patch).toHaveBeenCalledWith('/operators/2', { name: 'Nanyanzi Transport Ltd' })
  expect(put).not.toHaveBeenCalled()
})

/**
 * The plan is the commercial relationship, so it moves through the one route
 * that runs `PlanAllowance` (ADR-0058 §4) — never through the PATCH, which
 * would skip the downgrade refusal.
 */
it('moves the plan through its own guarded route, never the PATCH', async () => {
  put.mockResolvedValue(apiOk({ ...FLEET, plan: { id: 2, name: 'Founding fleet', is_default: false } }))
  open()

  await waitFor(() => expect(screen.getByLabelText(/plan/i)).toHaveValue('1'))
  await userEvent.selectOptions(screen.getByLabelText(/plan/i), '2')
  await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

  await waitFor(() => expect(put).toHaveBeenCalledWith('/operators/2/plan', { plan_id: 2 }))
  expect(patch).not.toHaveBeenCalled()
})

/**
 * ADR-0058 §4: a move to a plan smaller than the fleet's usage is refused and
 * the refusal names the figures. That considered 422 has to arrive under the
 * picker that caused it, not as a banner nobody can act on.
 */
it('puts a refused downgrade under the plan field, naming the figures', async () => {
  put.mockRejectedValue(
    apiFailure(422, 'VALIDATION_FAILED', 'The given data was invalid.', {
      plan_id: ['Free allows 2 drivers, and this fleet has 19.'],
    }),
  )
  open()

  await waitFor(() => expect(screen.getByLabelText(/plan/i)).toHaveValue('1'))
  await userEvent.selectOptions(screen.getByLabelText(/plan/i), '2')
  await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

  expect(await screen.findByText(/allows 2 drivers, and this fleet has 19/i)).toBeInTheDocument()
})

/**
 * Asserted as absences because an absence is what regresses silently. The
 * slug names the fleet in URLs and an invoice series; the status is the
 * record page's confirmed suspend/reinstate, and a dropdown here would let
 * that decision skip its confirmation.
 */
it('offers no control over the slug or the status', async () => {
  open()

  await screen.findByLabelText(/fleet name/i)
  expect(screen.queryByLabelText(/slug/i)).toBeNull()
  expect(screen.queryByLabelText(/status/i)).toBeNull()
  expect(screen.queryByRole('button', { name: /suspend/i })).toBeNull()
})
