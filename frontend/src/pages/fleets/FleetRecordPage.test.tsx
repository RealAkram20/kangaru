import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { apiOk, makeUser, renderAs } from '../../test/harness'
import type { Operator } from '../../types/operator'
import { FleetRecordPage } from './FleetRecordPage'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useParams: () => ({ id: '1' }),
  useNavigate: () => vi.fn(),
}))

const { apiClient } = await import('../../lib/apiClient')
const get = vi.mocked(apiClient.get)
const patch = vi.mocked(apiClient.patch)

function fleet(overrides: Partial<Operator> = {}): Operator {
  return {
    id: 1,
    name: 'Shanitah General Enterprises Ltd',
    slug: 'shanitah',
    status: 'active',
    is_active: true,
    plan: { id: 2, name: 'Founding fleet', is_default: false },
    users_count: 6,
    drivers_count: 19,
    vehicles_count: 20,
    clients_count: 2,
    created_at: '2026-08-22T05:00:21.000000Z',
    ...overrides,
  }
}

const ACCOUNTS = [
  { id: 3, name: 'Dispatch Desk', email: 'dispatch@kangaruride.test', role: 'dispatcher', role_label: 'Dispatcher', status: 'active' as const, created_at: '2026-01-01T00:00:00.000000Z', tenant_id: null },
]

function load(row: Operator = fleet()) {
  get.mockImplementation((url: string) => {
    if (url.includes('/accounts')) return Promise.resolve(apiOk(ACCOUNTS))
    return Promise.resolve(apiOk(row))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

it('shows what head office is entitled to know, and nothing operational', async () => {
  load()
  renderAs(<FleetRecordPage />, makeUser({ role: 'super_admin', access_level: 'kangaru', tenant_id: null }))

  expect(await screen.findByText('Shanitah General Enterprises Ltd')).toBeInTheDocument()
  expect(screen.getByText('19')).toBeInTheDocument()
  expect(screen.getByText('Founding fleet')).toBeInTheDocument()

  // ADR-0055 §2. Head office counts what a fleet has and reads none of it —
  // the way in is Log in as, which is announced, time-boxed and recorded.
  expect(screen.queryByText(/trip/i)).not.toBeInTheDocument()
  expect(screen.queryByText(/revenue/i)).not.toBeInTheDocument()
})

/**
 * The reason the accounts table exists at all: acting as needs a person to
 * name, and ADR-0059 §5 says a fleet must never have nobody to name.
 */
it('names the people support could act as', async () => {
  load()
  renderAs(<FleetRecordPage />, makeUser({ role: 'super_admin', access_level: 'kangaru', tenant_id: null }))

  expect(await screen.findByText('Dispatch Desk')).toBeInTheDocument()
  expect(screen.getByText('dispatch@kangaruride.test')).toBeInTheDocument()
})

/**
 * Suspending a fleet is commercial, not destructive, and it is irreversible
 * enough from the fleet's side to deserve a confirm rather than a click.
 */
it('asks before suspending, and says what survives it', async () => {
  load()
  patch.mockResolvedValue(apiOk(fleet({ status: 'suspended', is_active: false })))

  renderAs(<FleetRecordPage />, makeUser({ role: 'super_admin', access_level: 'kangaru', tenant_id: null }))
  await screen.findByText('Shanitah General Enterprises Ltd')

  await userEvent.click(screen.getByRole('button', { name: 'Suspend' }))

  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText(/untouched/i)).toBeInTheDocument()
  expect(patch).not.toHaveBeenCalled()

  await userEvent.click(within(dialog).getByRole('button', { name: 'Suspend fleet' }))

  await waitFor(() => expect(patch).toHaveBeenCalledWith('/operators/1', { status: 'suspended' }))
})

it('offers to reinstate a suspended fleet rather than suspending it twice', async () => {
  load(fleet({ status: 'suspended', is_active: false }))
  renderAs(<FleetRecordPage />, makeUser({ role: 'super_admin', access_level: 'kangaru', tenant_id: null }))

  await screen.findByText('Shanitah General Enterprises Ltd')
  expect(screen.getByRole('button', { name: 'Reinstate' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument()
})
