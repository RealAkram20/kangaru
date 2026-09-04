import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { apiOk, makeUser, renderAs } from '../test/harness'
import type { Company } from '../types/company'
import { CorporateClientsPage } from './CorporateClientsPage'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)

function client(overrides: Partial<Company> = {}): Company {
  return {
    id: 7,
    tenant_id: 3,
    legal_name: 'Centenary Rural Development Bank Limited',
    trading_name: 'Centenary Bank',
    registration_number: 'UG-1993-0042',
    industry: 'Banking',
    billing_email: 'accounts@centenary.test',
    phone: null,
    address_line1: null,
    address_line2: null,
    city: 'Kampala',
    country: 'Uganda',
    credit_limit_minor: 0,
    status: 'active',
    created_at: '2026-08-01T00:00:00.000000Z',
    updated_at: '2026-08-01T00:00:00.000000Z',
    ...overrides,
  }
}

const ACCOUNTS = [
  {
    id: 21,
    name: 'Achen Brenda',
    email: 'brenda@centenary.test',
    role: 'corporate_admin',
    role_label: 'Corporate Admin',
    status: 'active' as const,
    created_at: '2026-08-01T00:00:00.000000Z',
    tenant_id: 3,
  },
]

function load(rows: Company[] = [client()]) {
  get.mockImplementation((url: string) => {
    if (url.includes('/accounts')) return Promise.resolve(apiOk(ACCOUNTS))
    return Promise.resolve(apiOk(rows))
  })
}

const headOffice = () => makeUser({ role: 'super_admin', access_level: 'kangaru', tenant_id: null })

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * The gap ADR-0062 left open, and the reason Log in as is on this row.
 *
 * Head office reads the directory and not the operations, so a client ringing
 * about a booking it cannot see could be answered only by an engineer with
 * database access. ADR-0056 is the way in, and until this the console offered
 * it at a fleet and nowhere else — half of the one sentence the ADR quotes the
 * owner on: *"can log in as to any fleet, corporate client, walk-in client and
 * drivers."*
 */
it('offers a way into a client, through a named person and a reason', async () => {
  load()
  post.mockResolvedValue(apiOk({ id: 1 }))

  const user = userEvent.setup()
  renderAs(<CorporateClientsPage />, headOffice())

  await user.click(await screen.findByRole('button', { name: 'Log in as' }))

  const dialog = await screen.findByRole('dialog')

  // Named after the client, not "this organisation" — a support agent with
  // several tabs open should be able to tell whose account they are about to
  // hold from the heading alone.
  expect(within(dialog).getByText(/Centenary Bank/)).toBeInTheDocument()

  // The roster comes from this client's own endpoint, not from /users.
  await waitFor(() => expect(get).toHaveBeenCalledWith('/companies/7/accounts'))
  expect(await within(dialog).findByRole('option', { name: /Achen Brenda/ })).toBeInTheDocument()
})

/**
 * Both halves are required by the server and neither has a safe default, so
 * neither may be skipped by pressing the button early. The reason especially:
 * `BeginImpersonationRequest` calls it the first question an auditor asks a
 * support log, and a nullable field there would be null on every row inside a
 * month.
 */
it('will not start a session with nobody named', async () => {
  load()

  const user = userEvent.setup()
  renderAs(<CorporateClientsPage />, headOffice())

  await user.click(await screen.findByRole('button', { name: 'Log in as' }))
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByRole('option', { name: /Achen Brenda/ })

  expect(within(dialog).getByRole('button', { name: /Start 30-minute session/ })).toBeDisabled()
  expect(post).not.toHaveBeenCalled()
})

it('sends the subject and the reason, and says what is being recorded', async () => {
  load()
  post.mockResolvedValue(apiOk({ id: 1 }))

  const user = userEvent.setup()
  renderAs(<CorporateClientsPage />, headOffice())

  await user.click(await screen.findByRole('button', { name: 'Log in as' }))
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByRole('option', { name: /Achen Brenda/ })

  await user.selectOptions(within(dialog).getByLabelText(/Act as/), '21')
  await user.type(within(dialog).getByLabelText(/Reason/), 'Ticket 4021 — cannot see their March invoice')

  // Said once, where somebody is already looking, rather than in a paragraph
  // nobody reads twice.
  expect(within(dialog).getByText(/audit log against both names/i)).toBeInTheDocument()

  await user.click(within(dialog).getByRole('button', { name: /Start 30-minute session/ }))

  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/support/act-as', {
      subject_id: 21,
      reason: 'Ticket 4021 — cannot see their March invoice',
    }),
  )
})

/**
 * ADR-0062 §3 creates the client's first administrator in the same transaction
 * as the client, so this state is unreachable through onboarding. It is
 * rendered anyway: an unreachable state that renders nothing is how a support
 * agent ends up staring at a dialog that does not work.
 */
it('says so plainly when a client has nobody to become', async () => {
  get.mockImplementation((url: string) => {
    if (url.includes('/accounts')) return Promise.resolve(apiOk([]))
    return Promise.resolve(apiOk([client()]))
  })

  const user = userEvent.setup()
  renderAs(<CorporateClientsPage />, headOffice())

  await user.click(await screen.findByRole('button', { name: 'Log in as' }))
  const dialog = await screen.findByRole('dialog')

  expect(await within(dialog).findByText("Nobody to become here")).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: /Start 30-minute session/ })).toBeDisabled()
})
