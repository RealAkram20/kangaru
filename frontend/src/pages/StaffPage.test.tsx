import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, makeUser, renderAs } from '../test/harness'
import type { AssignableRole, StaffUser } from '../types/staff'
import { StaffPage } from './StaffPage'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)
const patch = vi.mocked(apiClient.patch)

function person(overrides: Partial<StaffUser> = {}): StaffUser {
  return {
    id: 2,
    tenant_id: 1,
    name: 'Brian Okello',
    email: 'brian@centenary-bank.test',
    role: 'corporate_employee',
    role_label: 'Corporate Employee',
    status: 'active',
    status_label: 'Active',
    is_active: true,
    deactivated_at: null,
    created_at: '2026-07-01T08:00:00.000000Z',
    ...overrides,
  }
}

/**
 * What a Corporate Admin is sent. Deliberately short of the full ten:
 * `meta.assignable_roles` is the escalation rule already applied, so Super
 * Admin never arrives rather than arriving and being hidden.
 */
const ASSIGNABLE: AssignableRole[] = [
  { value: 'corporate_employee', label: 'Corporate Employee' },
  { value: 'corporate_admin', label: 'Corporate Admin' },
]

function staffList(people: StaffUser[], roles: AssignableRole[] = ASSIGNABLE) {
  get.mockResolvedValue(apiOk(people, { assignable_roles: roles }))
}

beforeEach(() => {
  vi.clearAllMocks()
  staffList([person()])
  post.mockResolvedValue(apiOk({}))
  patch.mockResolvedValue(apiOk({}))
})

describe('StaffPage', () => {
  it('lists colleagues with the role and status the server labelled them', async () => {
    staffList([
      person(),
      person({
        id: 3,
        name: 'Grace Auma',
        email: 'grace@centenary-bank.test',
        status: 'suspended',
        status_label: 'Suspended',
        is_active: false,
        deactivated_at: '2026-07-20T09:00:00.000000Z',
      }),
    ])

    renderAs(<StaffPage />)

    expect(await screen.findByText('Brian Okello')).toBeInTheDocument()
    expect(screen.getByText('Grace Auma')).toBeInTheDocument()
    // Labels come from the server, not from a client-side map of slugs.
    expect(screen.getAllByText('Corporate Employee').length).toBeGreaterThan(0)
    expect(screen.getByText('2 accounts')).toBeInTheDocument()

    // Scoped to the row: "Suspended" is also a column heading, for the date
    // an account was suspended on.
    const grace = screen.getByText('Grace Auma').closest('tr') as HTMLElement
    expect(within(grace).getByText('Suspended')).toBeInTheDocument()
  })

  /**
   * ADR-0004's escalation rule, as the staff page sees it: the client holds
   * no copy of who may assign what. A role the server did not send is not
   * merely hidden — it was never there to hide.
   */
  it('offers only the roles the server said this administrator may assign', async () => {
    const user = userEvent.setup()
    renderAs(<StaffPage />)

    await user.click(await screen.findByRole('button', { name: /add colleague/i }))
    const dialog = screen.getByRole('dialog')

    const options = within(dialog)
      .getAllByRole('option')
      .map((o) => o.textContent)

    expect(options).toEqual(['Corporate Employee', 'Corporate Admin'])
    expect(options).not.toContain('Super Admin')
  })

  it('creates a colleague with the initial password, and edits without one', async () => {
    const user = userEvent.setup()
    renderAs(<StaffPage />)

    await user.click(await screen.findByRole('button', { name: /add colleague/i }))
    let dialog = screen.getByRole('dialog')

    await user.type(within(dialog).getByLabelText(/^Full name/), 'Peter Ochieng')
    await user.type(within(dialog).getByLabelText(/^Work email/), 'peter@centenary-bank.test')
    await user.type(within(dialog).getByLabelText(/^Initial password/), 'correct-horse-battery')
    await user.click(within(dialog).getByRole('button', { name: /create account/i }))

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/users', {
        name: 'Peter Ochieng',
        email: 'peter@centenary-bank.test',
        role: 'corporate_employee',
        password: 'correct-horse-battery',
      }),
    )

    await user.click(await screen.findByRole('button', { name: /^edit$/i }))
    dialog = screen.getByRole('dialog')

    // No password field on an existing account: this module deliberately
    // offers no way for an administrator to set somebody else's, that being
    // the one act an audit trail cannot tell apart from impersonation.
    expect(within(dialog).queryByLabelText(/password/i)).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/users/2', {
        name: 'Brian Okello',
        email: 'brian@centenary-bank.test',
        role: 'corporate_employee',
      }),
    )
  })

  /**
   * The server refuses both of these on your own account — you cannot change
   * your own role or lock yourself out. Offering buttons that always fail
   * would be worse than offering none.
   */
  it('offers no actions on your own account', async () => {
    staffList([person({ id: 1, name: 'Ada Nakato', email: 'ada@centenary-bank.test' }), person()])

    renderAs(<StaffPage />, makeUser({ id: 1 }))

    await screen.findByText('Ada Nakato')

    const mine = screen.getByText('Ada Nakato').closest('tr') as HTMLElement
    const theirs = screen.getByText('Brian Okello').closest('tr') as HTMLElement

    expect(within(mine).getByText('You')).toBeInTheDocument()
    expect(within(mine).queryByRole('button')).toBeNull()
    expect(within(theirs).getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    expect(within(theirs).getByRole('button', { name: /suspend/i })).toBeInTheDocument()
  })

  it('suspends, and re-reads rather than guessing the new state', async () => {
    const user = userEvent.setup()
    renderAs(<StaffPage />)

    await screen.findByText('Brian Okello')
    // Not 1: the harness renders in StrictMode exactly as main.tsx does, so
    // the load effect really does run twice on mount. Counting from here
    // rather than from zero is what makes this assert the reload.
    const callsBefore = get.mock.calls.length

    await user.click(screen.getByRole('button', { name: /suspend/i }))

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/users/2', { status: 'suspended' }))
    // Not optimistic: suspension revokes tokens server-side, so the row is
    // re-read rather than assumed.
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(callsBefore))
  })

  it('restores a suspended account', async () => {
    const user = userEvent.setup()
    staffList([person({ status: 'suspended', status_label: 'Suspended', is_active: false })])

    renderAs(<StaffPage />)

    await user.click(await screen.findByRole('button', { name: /restore/i }))
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/users/2', { status: 'active' }))
  })

  it('filters on name, email and role without asking the server again', async () => {
    const user = userEvent.setup()
    staffList([person(), person({ id: 3, name: 'Grace Auma', email: 'grace@centenary-bank.test' })])

    renderAs(<StaffPage />)

    await screen.findByText('Brian Okello')
    const callsBefore = get.mock.calls.length

    await user.type(screen.getByPlaceholderText(/filter by name, email or role/i), 'grace')

    expect(screen.queryByText('Brian Okello')).toBeNull()
    expect(screen.getByText('Grace Auma')).toBeInTheDocument()
    // The whole list is already in memory; a round trip per keystroke would
    // be latency for nothing.
    expect(get).toHaveBeenCalledTimes(callsBefore)
  })

  it('shows an onboarding prompt when the tenant has no staff at all', async () => {
    staffList([])

    renderAs(<StaffPage />)

    // "Nobody matches your filter" would be a lie here — there is nothing to
    // match, and the useful thing to say is how to start.
    expect(await screen.findByText('No staff yet')).toBeInTheDocument()
    expect(screen.getByText('Add a colleague to get started.')).toBeInTheDocument()
  })

  it('says the filter matched nothing, rather than that there is nobody', async () => {
    const user = userEvent.setup()

    renderAs(<StaffPage />)

    await screen.findByText('Brian Okello')
    await user.type(screen.getByPlaceholderText(/filter by name/i), 'zzz')

    expect(screen.getByText('Nobody matches your filter')).toBeInTheDocument()
    expect(screen.queryByText('No staff yet')).toBeNull()
  })

  it('shows the server refusal against the field it belongs to', async () => {
    const user = userEvent.setup()
    post.mockRejectedValue(
      apiFailure(422, 'VALIDATION_FAILED', 'The given data was invalid.', {
        email: ['Somebody in your organisation already uses this email address.'],
      }),
    )

    renderAs(<StaffPage />)

    await user.click(await screen.findByRole('button', { name: /add colleague/i }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /create account/i }))

    expect(await within(dialog).findByText(/already uses this email address/i)).toBeInTheDocument()
    // Still open — the message is the thing the user needs to act on.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('says so when the staff list cannot be loaded', async () => {
    get.mockRejectedValue(
      apiFailure(403, 'FORBIDDEN', 'You do not have permission to perform this action.'),
    )

    renderAs(<StaffPage />)

    expect(await screen.findByText('Staff administration')).toBeInTheDocument()
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument()
  })
})
