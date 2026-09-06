import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { apiOk, makeUser, renderAs } from '../test/harness'
import { DriverContractsPage } from './DriverContractsPage'

vi.mock('../lib/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)

const FLEET = makeUser({ role: 'super_admin', access_level: 'fleet', tenant_id: null })
const HEAD_OFFICE = makeUser({ role: 'super_admin', access_level: 'kangaru', tenant_id: null })

function rows(overrides = {}) {
  get.mockResolvedValue(
    apiOk([
      {
        id: 7,
        status: 'requested',
        fleet_answered_at: null,
        kangaru_answered_at: null,
        refused_reason: null,
        driver: { id: 3, name: 'Joseph Okello', owns_vehicle: false },
        fleet: { id: 1, name: 'Shanitah' },
        ...overrides,
      },
    ]),
  )
}

beforeEach(() => vi.clearAllMocks())

/**
 * A fleet *consents*, head office *accepts*. Different decisions — one about
 * an employee, one about Kangaru's own economy — and calling both "approve"
 * would hide that.
 */
it('asks a fleet to consent, and posts to the consent step', async () => {
  rows()
  post.mockResolvedValue(apiOk({}))

  renderAs(<DriverContractsPage />, FLEET)
  await userEvent.click(await screen.findByRole('button', { name: 'Consent' }))

  await waitFor(() => expect(post).toHaveBeenCalledWith('/walk-in-contracts/7/consent', {}))
})

it('asks head office to accept, and posts to the approval step', async () => {
  rows({ status: 'awaiting_kangaru', fleet_answered_at: '2026-08-23T10:00:00.000000Z' })
  post.mockResolvedValue(apiOk({}))

  renderAs(<DriverContractsPage />, HEAD_OFFICE)
  await userEvent.click(await screen.findByRole('button', { name: 'Accept' }))

  await waitFor(() => expect(post).toHaveBeenCalledWith('/walk-in-contracts/7/approval', {}))
})

/**
 * A driver-partner has no fleet to ask (ADR-0048 §7), so a row naming no fleet
 * is the **waiver** rather than missing data. Saying which stops the office
 * reading a correct row as a broken one.
 */
it('says why a driver-partner has no fleet, rather than showing a blank', async () => {
  rows({ driver: { id: 3, name: 'Grace Nabirye', owns_vehicle: true }, fleet: null })

  renderAs(<DriverContractsPage />, HEAD_OFFICE)

  expect(await screen.findByText(/owns their vehicle/i)).toBeInTheDocument()
})

it('sends the refusal reason, and says it reaches the driver', async () => {
  rows()
  post.mockResolvedValue(apiOk({}))

  renderAs(<DriverContractsPage />, FLEET)
  await userEvent.click(await screen.findByRole('button', { name: 'Refuse' }))

  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText(/shown to the driver/i)).toBeInTheDocument()

  await userEvent.type(within(dialog).getByLabelText(/reason/i), 'Needed on corporate work.')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Refuse' }))

  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/walk-in-contracts/7/refusal', {
      reason: 'Needed on corporate work.',
    }),
  )
})

it('sends null rather than an empty string when no reason is given', async () => {
  rows()
  post.mockResolvedValue(apiOk({}))

  renderAs(<DriverContractsPage />, FLEET)
  await userEvent.click(await screen.findByRole('button', { name: 'Refuse' }))

  const dialog = await screen.findByRole('dialog')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Refuse' }))

  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/walk-in-contracts/7/refusal', { reason: null }),
  )
})

it('tells each level what would put something in their empty queue', async () => {
  get.mockResolvedValue(apiOk([]))

  renderAs(<DriverContractsPage />, HEAD_OFFICE)

  expect(await screen.findByText(/once a driver’s fleet has consented/i)).toBeInTheDocument()
})
