import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { apiOk, makeUser, renderAs } from '../../test/harness'
import { OurFleets } from './OurFleets'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

const { apiClient } = await import('../../lib/apiClient')
const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)
const del = vi.mocked(apiClient.delete)

const CLIENT = makeUser({ role: 'corporate_admin', access_level: 'client', tenant_id: 3 })

function contracts(rows: unknown[]) {
  get.mockResolvedValue(apiOk(rows))
}

beforeEach(() => vi.clearAllMocks())

/**
 * ADR-0060 §5. This screen is the safety catch: without the client answering
 * here, any fleet knowing a registration number could attach itself to another
 * fleet's client and begin reading their bookings.
 */
it('names the fleet asking, because you cannot answer somebody anonymous', async () => {
  contracts([
    { id: 1, status: 'active', started_on: '2026-03-01', ended_on: null, fleet: { id: 1, name: 'Shanitah General Enterprises Ltd' } },
    { id: 2, status: 'requested', started_on: null, ended_on: null, fleet: { id: 2, name: 'Rival Transport Ltd' } },
  ])

  renderAs(<OurFleets />, CLIENT)

  expect(await screen.findByText('Rival Transport Ltd')).toBeInTheDocument()
  expect(screen.getByText('Asked to serve you')).toBeInTheDocument()
  expect(screen.getByText('Serving you')).toBeInTheDocument()
})

it('offers Accept only on a request, never on a fleet already serving', async () => {
  contracts([
    { id: 1, status: 'active', started_on: '2026-03-01', ended_on: null, fleet: { id: 1, name: 'Shanitah' } },
    { id: 2, status: 'requested', started_on: null, ended_on: null, fleet: { id: 2, name: 'Rival' } },
  ])

  renderAs(<OurFleets />, CLIENT)
  await screen.findByText('Rival')

  expect(screen.getAllByRole('button', { name: 'Accept' })).toHaveLength(1)
})

it('accepts a fleet, which is the client s decision to make', async () => {
  contracts([{ id: 2, status: 'requested', started_on: null, ended_on: null, fleet: { id: 2, name: 'Rival' } }])
  post.mockResolvedValue(apiOk({}))

  renderAs(<OurFleets />, CLIENT)
  await userEvent.click(await screen.findByRole('button', { name: 'Accept' }))

  await waitFor(() => expect(post).toHaveBeenCalledWith('/contracts/2/approval'))
})

/**
 * Ending a contract is not destroying a relationship: ADR-0060 §7 keeps the
 * row because the trips and invoices it explains are still the client's.
 */
it('asks before ending, and says the history survives', async () => {
  contracts([{ id: 1, status: 'active', started_on: '2026-03-01', ended_on: null, fleet: { id: 1, name: 'Shanitah' } }])
  del.mockResolvedValue(apiOk({}))

  renderAs(<OurFleets />, CLIENT)
  await userEvent.click(await screen.findByRole('button', { name: 'End' }))

  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText(/stay on your record/i)).toBeInTheDocument()
  expect(del).not.toHaveBeenCalled()

  await userEvent.click(within(dialog).getByRole('button', { name: 'End contract' }))
  await waitFor(() => expect(del).toHaveBeenCalledWith('/contracts/1'))
})

it('calls declining a request what it is, rather than ending it', async () => {
  contracts([{ id: 2, status: 'requested', started_on: null, ended_on: null, fleet: { id: 2, name: 'Rival' } }])

  renderAs(<OurFleets />, CLIENT)
  await userEvent.click(await screen.findByRole('button', { name: 'Decline' }))

  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText(/can ask again later/i)).toBeInTheDocument()
})
