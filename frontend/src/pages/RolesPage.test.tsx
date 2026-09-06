import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, renderAs, makeUser } from '../test/harness'
import type { PermissionCatalogue, Role, RolesMeta } from '../types/role'
import { RolesPage } from './RolesPage'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)
const patch = vi.mocked(apiClient.patch)
const destroy = vi.mocked(apiClient.delete)

/** A slice of App\Enums\Permission, grouped the way Permission::group() does. */
const CATALOGUE: PermissionCatalogue = {
  Administration: [
    { value: 'staff.view', label: 'See the staff list' },
    { value: 'roles.manage', label: 'Create and edit roles' },
  ],
  Billing: [
    { value: 'invoices.view', label: 'See invoices' },
    { value: 'invoices.create', label: 'Issue an invoice' },
  ],
  Trips: [{ value: 'trips.view.all', label: 'See every trip' }],
}

const EVERYTHING = [
  'staff.view',
  'roles.manage',
  'invoices.view',
  'invoices.create',
  'trips.view.all',
]

function role(overrides: Partial<Role> = {}): Role {
  return {
    slug: 'dispatcher',
    name: 'Dispatcher',
    description: 'Assigns drivers and vehicles.',
    is_system: true,
    audience: 'fleet',
    audience_label: 'Fleet',
    requires_mfa: false,
    permissions: ['trips.view.all'],
    users_count: 3,
    created_at: '2026-07-01T08:00:00.000000Z',
    ...overrides,
  }
}

function catalogue(roles: Role[], meta: Partial<RolesMeta> = {}) {
  get.mockResolvedValue(
    apiOk(roles, {
      catalogue: CATALOGUE,
      grantable: EVERYTHING,
      can_manage: true,
      mfa_enforced: true,
      can_manage_mfa: true,
      ...meta,
    }),
  )
}

/** Opens the create dialog and returns it, so assertions stay scoped to it. */
async function openNewRole(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /new role/i }))
  return screen.getByRole('dialog')
}

beforeEach(() => {
  vi.clearAllMocks()
  catalogue([role()])
  post.mockResolvedValue(apiOk({}))
  patch.mockResolvedValue(apiOk({}))
  destroy.mockResolvedValue(apiOk({}))
})

describe('RolesPage', () => {
  it('lists the catalogue with what each role grants and who holds it', async () => {
    catalogue([
      role(),
      role({
        slug: 'regional_auditor',
        name: 'Regional Auditor',
        is_system: false,
    requires_mfa: false,
        users_count: 0,
      }),
    ])

    renderAs(<RolesPage />)

    expect(await screen.findByText('Dispatcher')).toBeInTheDocument()
    expect(screen.getByText('Regional Auditor')).toBeInTheDocument()

    // Built-in and custom are told apart on the row, because what you may
    // do to them differs — one cannot be renamed or deleted.
    expect(screen.getByText('Built in')).toBeInTheDocument()
    expect(screen.getByText('Custom')).toBeInTheDocument()
    expect(screen.getByText('2 roles · 1 custom')).toBeInTheDocument()
  })

  it('offers no delete on a built-in role', async () => {
    catalogue([role(), role({ slug: 'temp', name: 'Temp', is_system: false, users_count: 0 })])

    renderAs(<RolesPage />)

    await screen.findByText('Dispatcher')

    const builtIn = screen.getByText('Dispatcher').closest('tr')
    const custom = screen.getByText('Temp').closest('tr')

    // Seeders, tests and every existing users.role value refer to a system
    // role by slug. The server refuses too; not offering the button is the
    // difference between a rule and a trap.
    expect(within(builtIn as HTMLElement).queryByRole('button', { name: /delete/i })).toBeNull()
    expect(
      within(custom as HTMLElement).getByRole('button', { name: /delete/i }),
    ).toBeInTheDocument()
  })

  it('creates a custom role from the permissions the server said were grantable', async () => {
    const user = userEvent.setup()
    renderAs(<RolesPage />)

    const dialog = await openNewRole(user)

    await user.type(within(dialog).getByLabelText(/^Name/), 'Regional Auditor')
    await user.type(within(dialog).getByLabelText(/^Key/), 'regional_auditor')
    await user.click(within(dialog).getByLabelText(/See every trip/))
    await user.click(within(dialog).getByLabelText(/See invoices/))

    expect(within(dialog).getByText('2 selected')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /create role/i }))

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/roles', {
        name: 'Regional Auditor',
        slug: 'regional_auditor',
        description: null,
        permissions: ['trips.view.all', 'invoices.view'],
      }),
    )
  })

  it('omits the key entirely when it is left blank, rather than sending an empty one', async () => {
    const user = userEvent.setup()
    renderAs(<RolesPage />)

    const dialog = await openNewRole(user)

    await user.type(within(dialog).getByLabelText(/^Name/), 'Read Only Ops')
    await user.click(within(dialog).getByLabelText(/See every trip/))
    await user.click(within(dialog).getByRole('button', { name: /create role/i }))

    // The server derives the slug from the name. An empty string would fail
    // its `^[a-z][a-z0-9_]*$` pattern and 422 on a field the user never
    // filled in.
    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(post.mock.calls[0][1]).not.toHaveProperty('slug')
  })

  /**
   * ADR-0004's escalation rule, at the point a role is *defined*: nobody may
   * put a permission into a role that they do not hold themselves. The
   * server enforces it and 422s; this asserts the UI never offers the
   * choice in the first place.
   */
  it('disables permissions the signed-in user does not hold themselves', async () => {
    const user = userEvent.setup()
    // A curator who can compose roles but cannot issue invoices.
    catalogue([role()], { grantable: ['roles.manage', 'staff.view', 'trips.view.all'] })

    renderAs(<RolesPage />)

    const dialog = await openNewRole(user)

    const grantable = within(dialog).getByLabelText(/See every trip/)
    const beyond = within(dialog).getByLabelText(/Issue an invoice/)

    expect(grantable).toBeEnabled()
    expect(beyond).toBeDisabled()
    expect(within(dialog).getAllByText('You do not hold this permission yourself').length).toBe(2)

    // And clicking it changes nothing — no silent selection that would 422
    // once they had composed the whole role.
    await user.click(beyond)
    expect(within(dialog).getByText('0 selected')).toBeInTheDocument()
  })

  it('will not let a built-in role be renamed, but will let its permissions change', async () => {
    const user = userEvent.setup()
    renderAs(<RolesPage />)

    await user.click(await screen.findByRole('button', { name: /edit/i }))
    const dialog = screen.getByRole('dialog')

    // Renaming would orphan every account holding the slug, so the field is
    // closed rather than offered and refused.
    expect(within(dialog).getByLabelText(/^Name/)).toBeDisabled()
    expect(within(dialog).getByText(/cannot be renamed/i)).toBeInTheDocument()

    await user.click(within(dialog).getByLabelText(/See invoices/))
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }))

    // No `name` in the payload: it cannot change, so it is not sent.
    //
    // `requires_mfa` is sent because this fixture's actor can manage it
    // (ADR-0061 §5). An actor who cannot omits the key entirely rather than
    // sending the role's current value back — see the test below, which is
    // the half that matters: a payload echoing a value you may not change is
    // one server-side bug away from changing it.
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/roles/dispatcher', {
        description: 'Assigns drivers and vehicles.',
        permissions: ['trips.view.all', 'invoices.view'],
        requires_mfa: false,
      }),
    )
  })

  /**
   * ADR-0061 §4. The count is the safety of this feature: without it the
   * switch is a trap that fires later, on somebody else, at a moment nobody
   * connects to this action. It appears only when it would actually affect
   * people — a role with nobody unenrolled gets the plain sentence.
   */
  it('names how many people the switch would ask to enrol, before it is thrown', async () => {
    const user = userEvent.setup()
    catalogue([role({ requires_mfa: false, unenrolled_count: 3, users_count: 3 })])

    renderAs(<RolesPage />)
    await user.click((await screen.findAllByRole('button', { name: /edit|view/i }))[0])
    const dialog = await screen.findByRole('dialog')

    // Off: no warning, because switching it off asks nobody to do anything.
    expect(within(dialog).queryByText(/have not set one up/i)).not.toBeInTheDocument()

    await user.click(within(dialog).getByLabelText(/second factor/i))

    expect(await within(dialog).findByText(/3 of these accounts have not set one up/i)).toBeInTheDocument()
  })

  /**
   * A control that looks live and does nothing is worse than one that is
   * absent. When the platform switch is off, the per-role toggle still saves
   * — the role setting is real — but the hint says it changes nothing yet.
   */
  it('says the per-role switch is inert while the platform switch is off', async () => {
    const user = userEvent.setup()
    catalogue([role({ requires_mfa: true, unenrolled_count: 3 })], { mfa_enforced: false })

    renderAs(<RolesPage />)
    await user.click((await screen.findAllByRole('button', { name: /edit|view/i }))[0])
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText(/inert/i)).toBeInTheDocument()
  })

  /**
   * ADR-0061 §5. The console holds no copy of the rule — it reads
   * `meta.can_manage_mfa` — and when it cannot manage the switch it omits the
   * key rather than echoing the current value back. An echoed value is one
   * server-side bug away from being a write.
   */
  it('omits the second-factor field entirely when this actor may not change it', async () => {
    const user = userEvent.setup()
    catalogue([role()], { can_manage_mfa: false })
    patch.mockResolvedValue(apiOk({}))

    renderAs(<RolesPage />)

    await user.click((await screen.findAllByRole('button', { name: /edit|view/i }))[0])
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).queryByLabelText(/second factor/i)).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(patch).toHaveBeenCalled())
    expect(patch.mock.calls[0][1]).not.toHaveProperty('requires_mfa')
  })

  it('shows the server refusal against the permissions field, not as a bare failure', async () => {
    const user = userEvent.setup()
    patch.mockRejectedValue(
      apiFailure(422, 'VALIDATION_FAILED', 'The given data was invalid.', {
        permissions: [
          'You cannot remove role management from your own role. Ask another Super Admin to do it.',
        ],
      }),
    )

    renderAs(<RolesPage />)

    await user.click(await screen.findByRole('button', { name: /edit/i }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }))

    expect(
      await within(dialog).findByText(/cannot remove role management from your own role/i),
    ).toBeInTheDocument()
  })

  /**
   * The 409 the server raises rather than orphaning accounts. Deleting a
   * role somebody holds leaves them resolving to no permissions, which
   * fails closed — a silent, total loss of access.
   */
  it('keeps a role that is still held, and says how many hold it', async () => {
    const user = userEvent.setup()
    catalogue([role({ slug: 'temp_staff', name: 'Temp Staff', is_system: false, users_count: 2 })])
    destroy.mockRejectedValue(
      apiFailure(
        409,
        'ROLE_IN_USE',
        'This role cannot be deleted because 2 account(s) still hold it. Move them to another role first.',
      ),
    )

    renderAs(<RolesPage />)

    await user.click(await screen.findByRole('button', { name: /delete/i }))
    await user.click(screen.getByRole('button', { name: /delete role/i }))

    expect(await screen.findByText(/2 account\(s\) still hold it/)).toBeInTheDocument()
    // Still on screen: the dialog does not close on a refusal, because the
    // refusal is the thing the user needs to read.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('deletes an unused custom role and reloads the catalogue', async () => {
    const user = userEvent.setup()
    catalogue([role({ slug: 'unused', name: 'Unused', is_system: false, users_count: 0 })])

    renderAs(<RolesPage />)

    await user.click(await screen.findByRole('button', { name: /delete/i }))
    await user.click(screen.getByRole('button', { name: /delete role/i }))

    await waitFor(() => expect(destroy).toHaveBeenCalledWith('/roles/unused'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  /**
   * A Corporate Admin holds `staff.view`, so RolePolicy::viewAny lets them
   * read the catalogue they assign from — but not author it. The page is
   * driven by `meta.can_manage` rather than by any client-side role list.
   */
  it('renders read-only for someone who may read the catalogue but not write it', async () => {
    const user = userEvent.setup()
    catalogue([role()], { can_manage: false,
    mfa_enforced: true,
    can_manage_mfa: true, grantable: ['staff.view', 'trips.view.all'] })

    renderAs(<RolesPage />, makeUser({ role: 'corporate_admin' }))

    await screen.findByText('Dispatcher')

    expect(screen.queryByRole('button', { name: /new role/i })).toBeNull()
    expect(screen.getByText('Read only')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /view/i }))
    const dialog = screen.getByRole('dialog')

    expect(within(dialog).getByLabelText(/^Name/)).toBeDisabled()
    expect(within(dialog).getByLabelText(/See every trip/)).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: /save changes/i })).toBeNull()
    expect(within(dialog).getByRole('button', { name: /^done$/i })).toBeInTheDocument()

    // A reader is not composing anything, so the escalation notice is
    // answering a question they did not ask — and it would cost them the
    // permission key, which is the part actually worth reading. Counted in
    // the same terms: nothing has been "selected".
    expect(within(dialog).queryByText('You do not hold this permission yourself')).toBeNull()
    expect(within(dialog).getByText('invoices.create')).toBeInTheDocument()
    expect(within(dialog).getByText('1 granted')).toBeInTheDocument()
  })

  /**
   * The reason /roles is not behind RequireNavAccess: access is decided by
   * whether the API answers, so a *custom* role holding `roles.manage` —
   * which no slug list can know about — reaches the editor built for it.
   */
  it('filters the catalogue to one kind of account', async () => {
    // The audience is what keeps a client's role out of a fleet's picker.
    // Before the column, the only thing separating them was whether the
    // permission sets happened to be subsets of one another — a coincidence
    // rather than a boundary, and one that stops holding the moment head
    // office composes the roles it was asked for.
    catalogue([
      role({ slug: 'dispatcher', name: 'Dispatcher', audience: 'fleet', audience_label: 'Fleet' }),
      role({
        slug: 'corporate_admin',
        name: 'Corporate Admin',
        audience: 'client',
        audience_label: 'Client',
      }),
    ])

    const user = userEvent.setup()
    renderAs(<RolesPage />)

    expect(await screen.findByText('Dispatcher')).toBeInTheDocument()
    expect(screen.getByText('Corporate Admin')).toBeInTheDocument()

    await user.selectOptions(
      screen.getByLabelText(/filter roles by the kind of account/i),
      'client',
    )

    // Both halves. Asserting only the survivor would pass just as happily
    // against a filter that did nothing.
    expect(screen.getByText('Corporate Admin')).toBeInTheDocument()
    expect(screen.queryByText('Dispatcher')).not.toBeInTheDocument()
  })

  it('offers the audience picker only to head office', async () => {
    // Moving a role between audiences decides what appears in another
    // organisation's picker, so it is head office's call — the same shape the
    // second-factor switch already has. A control that always refused would
    // be a trap rather than a rule, so a fleet sees the answer and not the
    // control.
    catalogue([role()], { can_manage_audience: false })

    const user = userEvent.setup()
    renderAs(<RolesPage />)

    await user.click(await screen.findByRole('button', { name: /^edit$/i }))
    const dialog = screen.getByRole('dialog')

    expect(within(dialog).queryByLabelText(/^For/)).not.toBeInTheDocument()
    // The role's own audience is still stated, because hiding the control is
    // not the same as hiding the fact.
    expect(within(dialog).getByText('Fleet')).toBeInTheDocument()
  })

  it('sends the audience head office chose', async () => {
    catalogue([role()], {
      can_manage_audience: true,
      audiences: [
        { value: 'kangaru', label: 'Kangaru' },
        { value: 'fleet', label: 'Fleet' },
        { value: 'client', label: 'Client' },
      ],
    })

    const user = userEvent.setup()
    renderAs(<RolesPage />)

    const dialog = await openNewRole(user)

    await user.type(within(dialog).getByLabelText(/^Name/), 'Fleet HR')
    await user.selectOptions(within(dialog).getByLabelText(/^For/), 'client')
    await user.click(within(dialog).getByLabelText(/See every trip/))
    await user.click(within(dialog).getByRole('button', { name: /create role/i }))

    await waitFor(() => expect(post).toHaveBeenCalled())

    expect((post.mock.calls[0][1] as Record<string, unknown>).audience).toBe('client')
  })

  it('treats a 403 as an answer rather than a fault', async () => {
    get.mockRejectedValue(
      apiFailure(403, 'FORBIDDEN', 'You do not have permission to perform this action.'),
    )

    renderAs(<RolesPage />, makeUser({ role: 'corporate_employee' }))

    expect(await screen.findByText('Roles are not available to your account')).toBeInTheDocument()
    // Not an error banner: nothing is broken, they simply may not read it.
    expect(screen.queryByText('Role catalogue')).toBeNull()
  })

  it('says so when the catalogue genuinely cannot be loaded', async () => {
    get.mockRejectedValue(apiFailure(500, 'SERVER_ERROR', 'Roles are unavailable right now.'))

    renderAs(<RolesPage />)

    expect(await screen.findByText('Role catalogue')).toBeInTheDocument()
    expect(screen.getByText('Roles are unavailable right now.')).toBeInTheDocument()
  })
})
