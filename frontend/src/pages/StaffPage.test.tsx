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
    phone: '+256700111222',
    role: 'corporate_employee',
    role_label: 'Corporate Employee',
    capabilities: [],
    books_without_approval: false,
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

/** A staff list from a platform where mail is switched on, so an invitation can be sent. */
function staffListThatCanInvite(people: StaffUser[]) {
  get.mockResolvedValue(apiOk(people, { assignable_roles: ASSIGNABLE, can_invite: true }))
}

/** The switch catalogue as the server serves it (App\Enums\ClientCapability). */
const CAPABILITIES = [
  { slug: 'approves_bookings', label: 'Approves bookings', description: 'Can approve or reject transport requests.' },
  { slug: 'sees_finance', label: 'Sees invoices and reports', description: 'Can open invoices and run reports.' },
  { slug: 'manages_staff', label: 'Manages staff', description: 'Can add and suspend colleagues.' },
] as const

function staffListWithSwitches(people: StaffUser[]) {
  get.mockResolvedValue(apiOk(people, { assignable_roles: ASSIGNABLE, capabilities: CAPABILITIES }))
}

/** The client's own circuits, as `meta.routes` serves them (ADR-0045 §8). */
const ROUTES = [
  { id: 7, name: 'Monday ATM run' },
  { id: 9, name: 'Friday cash run' },
]

function staffListWithRoutes(people: StaffUser[]) {
  get.mockResolvedValue(apiOk(people, { assignable_roles: ASSIGNABLE, routes: ROUTES }))
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
    // The work number a booking raised for this person is dispatched
    // against. Collected here so it is checked once, rather than retyped
    // from memory on every booking.
    await user.type(within(dialog).getByLabelText(/^Phone/), '+256700333444')
    await user.type(within(dialog).getByLabelText(/^Initial password/), 'correct-horse-battery')
    await user.click(within(dialog).getByRole('button', { name: /create account/i }))

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/users', {
        name: 'Peter Ochieng',
        email: 'peter@centenary-bank.test',
        phone: '+256700333444',
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
        phone: '+256700111222',
        role: 'corporate_employee',
      }),
    )
  })

  /**
   * The client's own access control (App\Enums\ClientCapability): switches a
   * Corporate Admin sets per person, offered from the server's catalogue and
   * saved whole, so a switch turned off reaches the server as absent from
   * the list rather than as an absent field.
   */
  it("shows what each colleague can also do, from the server's own words", async () => {
    staffListWithSwitches([
      person({ capabilities: ['sees_finance'], books_without_approval: true }),
      person({ id: 3, name: 'Grace Amongin', email: 'grace@centenary-bank.test' }),
    ])
    renderAs(<StaffPage />)

    expect(await screen.findByText('Sees invoices and reports')).toBeInTheDocument()
    expect(screen.getByText('No approval')).toBeInTheDocument()
    // Grace has no switches: a dash in that cell (the Routes column has
    // one too, she rides none), and none of the switch names.
    const grace = screen.getByText('Grace Amongin').closest('tr') as HTMLElement
    expect(within(grace).getAllByText('—').length).toBeGreaterThan(1)
    expect(within(grace).queryByText(/Sees invoices|Approves|Manages|No approval/)).toBeNull()
  })

  it("offers the switches for a client's person and saves the whole panel", async () => {
    const user = userEvent.setup()
    staffListWithSwitches([person({ capabilities: ['sees_finance'] })])
    renderAs(<StaffPage />)

    await user.click(await screen.findByRole('button', { name: /^edit$/i }))
    const dialog = screen.getByRole('dialog')

    // Pre-ticked from the record; the hint is the server's description.
    expect(within(dialog).getByLabelText(/Sees invoices and reports/)).toBeChecked()
    expect(within(dialog).getByText('Can open invoices and run reports.')).toBeInTheDocument()

    await user.click(within(dialog).getByLabelText(/Approves bookings/))
    await user.click(within(dialog).getByLabelText(/Sees invoices and reports/))
    await user.click(within(dialog).getByLabelText(/Book without approval/))
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/users/2', {
        name: 'Brian Okello',
        email: 'brian@centenary-bank.test',
        phone: '+256700111222',
        role: 'corporate_employee',
        capabilities: ['approves_bookings'],
        books_without_approval: true,
      }),
    )
  })

  /**
   * The roster (ADR-0045 §8), set where the colleague is set.
   *
   * It is a roster and not a permission — nothing authorises off it — but it
   * belongs here for a plain reason: adding a new starter to four circuits
   * meant opening four routes, so nobody did, and the feature went unused.
   */
  it('assigns the routes a colleague rides, and saves the roster whole', async () => {
    const user = userEvent.setup()
    staffListWithRoutes([person({ route_ids: [7] })])
    renderAs(<StaffPage />)

    await user.click(await screen.findByRole('button', { name: /^edit$/i }))
    const dialog = screen.getByRole('dialog')

    // Pre-ticked from the record, and named from the server's own list.
    expect(within(dialog).getByLabelText('Monday ATM run')).toBeChecked()
    expect(within(dialog).getByLabelText('Friday cash run')).not.toBeChecked()

    await user.click(within(dialog).getByLabelText('Friday cash run'))
    await user.click(within(dialog).getByLabelText('Monday ATM run'))
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }))

    // Taken off Monday, put on Friday — and sent as the full list, because
    // an absent field would read as "leave them where they were".
    await waitFor(() => expect(patch).toHaveBeenCalled())
    expect(patch.mock.calls[0][1]).toMatchObject({ route_ids: [9] })
  })

  it('offers no routes to put a platform account on, having none', async () => {
    const user = userEvent.setup()
    // `meta.routes` is empty for an actor with no tenant: routes belong to
    // a client, and Shanitah's own staff belong to none.
    staffList([person()])
    renderAs(<StaffPage />)

    await user.click(await screen.findByRole('button', { name: /^edit$/i }))
    const dialog = screen.getByRole('dialog')

    expect(within(dialog).queryByText('Routes')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(patch).toHaveBeenCalled())
    expect(patch.mock.calls[0][1]).not.toHaveProperty('route_ids')
  })

  it('offers no switches when the server served no catalogue', async () => {
    const user = userEvent.setup()
    staffList([person()])
    renderAs(<StaffPage />)

    await user.click(await screen.findByRole('button', { name: /^edit$/i }))
    const dialog = screen.getByRole('dialog')

    expect(within(dialog).queryByText('Can also')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(patch).toHaveBeenCalled())
    expect(patch.mock.calls[0][1]).not.toHaveProperty('capabilities')
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

  it('shows a locked door, not an error, to an account without staff management', async () => {
    // The route stopped gating on a role slug when head office began
    // composing roles that carry `staff.manage` — no slug list can know their
    // names, and every one of them would have been turned away from the
    // screen built for it. So the page is reachable by anybody and answers
    // for itself, exactly as the role catalogue beside it does.
    //
    // A refusal is not a failure: somebody who simply may not be here should
    // not read a red banner about a request they did not knowingly make.
    get.mockRejectedValue(
      apiFailure(403, 'FORBIDDEN', 'You do not have permission to perform this action.'),
    )

    renderAs(<StaffPage />)

    expect(
      await screen.findByText(/staff administration is not available to your account/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('offers no way to invite when the platform cannot send email', async () => {
    // `can_invite` is false whenever mail is off — which is production's state
    // today. The option is not rendered at all rather than shown and refused
    // on save: an Invite button that silently created an account nobody could
    // sign into is the hole the invitations table was built to close.
    staffList([person()])

    const user = userEvent.setup()
    renderAs(<StaffPage />)

    await user.click(await screen.findByRole('button', { name: /add colleague/i }))

    const dialog = screen.getByRole('dialog')

    expect(within(dialog).queryByLabelText(/email them a link/i)).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText(/^Initial password/)).toBeInTheDocument()
  })

  it('sends an invitation instead of a password when the administrator chooses one', async () => {
    staffListThatCanInvite([person()])

    const user = userEvent.setup()
    renderAs(<StaffPage />)

    await user.click(await screen.findByRole('button', { name: /add colleague/i }))

    const dialog = screen.getByRole('dialog')

    await user.type(within(dialog).getByLabelText(/^Full name/), 'Grace Nakimuli')
    await user.type(within(dialog).getByLabelText(/^Work email/), 'grace@centenary-bank.test')
    await user.type(within(dialog).getByLabelText(/^Phone/), '+256700000301')
    await user.click(within(dialog).getByLabelText(/email them a link/i))

    // The password field goes with the choice — there is nothing to type, so
    // leaving an empty box on screen would be a control that does nothing.
    expect(within(dialog).queryByLabelText(/^Initial password/)).not.toBeInTheDocument()

    // And the dialog's own sentence follows it. Found in a browser, not by a
    // test: with the box ticked the dialog still read "They sign in with the
    // password you set here", promising a password nobody was going to set.
    expect(within(dialog).getByText(/email with a link to set their own password/i)).toBeInTheDocument()
    expect(within(dialog).queryByText(/password you set here/i)).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /create account/i }))

    const payload = post.mock.calls[0][1] as Record<string, unknown>

    // The assertion that matters is the *absence*. The server drops the
    // requirement for an invite but still holds a present password to the
    // length floor, so sending an empty string would be refused for a field
    // the administrator never filled in.
    expect(payload.invite).toBe(true)
    expect(payload).not.toHaveProperty('password')
  })

  it('still reports a real failure as an error', async () => {
    // The other half, and the reason the branch above is on the code rather
    // than on the status: a server that fell over is not a locked door, and
    // rendering one would hide an outage behind a permissions message.
    get.mockRejectedValue(apiFailure(500, 'SERVER_ERROR', 'Something went wrong.'))

    renderAs(<StaffPage />)

    expect(await screen.findByText('Staff administration')).toBeInTheDocument()
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
  })
})
