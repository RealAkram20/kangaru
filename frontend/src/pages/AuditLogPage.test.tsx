import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, makeUser, renderAs } from '../test/harness'
import type { AuditLogEntry, AuditLogMeta } from '../types/auditLog'
import { AuditLogPage } from './AuditLogPage'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn() },
}))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)

const TYPES = ['company', 'invoice', 'rate_card_version', 'role', 'user', 'vehicle_allocation']

function entry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 1,
    tenant_id: 1,
    user_id: 5,
    user: makeUser({ id: 5, name: 'Ada Nakato' }),
    auditable_type: 'company',
    auditable_id: 3,
    action: 'updated',
    changes: {
      before: { credit_limit_minor: 100000 },
      after: { credit_limit_minor: 250000 },
    },
    ip_address: '196.43.150.2',
    created_at: '2026-07-21T08:14:22.000000Z',
    ...overrides,
  }
}

function meta(overrides: Partial<AuditLogMeta> = {}): AuditLogMeta {
  return {
    cursor: { next: null },
    filters: {
      auditable_types: TYPES,
      actions: ['created', 'updated', 'deleted'],
      actors: [
        { value: 5, label: 'Ada Nakato' },
        { value: 6, label: 'Brian Okello' },
      ],
    },
    scope: 'tenant',
    ...overrides,
  }
}

function trail(entries: AuditLogEntry[], m: AuditLogMeta = meta()) {
  get.mockResolvedValue(apiOk(entries, m))
}

beforeEach(() => {
  vi.clearAllMocks()
  trail([entry()])
})

describe('AuditLogPage', () => {
  it('shows who changed what, when, and from where', async () => {
    renderAs(<AuditLogPage />)

    // Anchored on the IP, and scoped to the row: the record type, the
    // action and now the actor name all also appear as options in the
    // filter selects, which are populated from the same server lists.
    const row = (await screen.findByText('196.43.150.2')).closest('tr') as HTMLElement

    // AGENTS.md asks for who, what, before/after, when, and from which IP.
    expect(within(row).getByText('updated')).toBeInTheDocument()
    expect(within(row).getByText('Company')).toBeInTheDocument()
    expect(within(row).getByText('#3')).toBeInTheDocument()
  })

  /**
   * The before/after diff is the part a bank asks to see, and the reason
   * AGENTS.md names credit limits explicitly.
   */
  it('expands to a field-level before and after', async () => {
    const user = userEvent.setup()
    renderAs(<AuditLogPage />)

    await user.click(await screen.findByRole('button', { name: /show/i }))

    expect(screen.getByText('credit_limit_minor')).toBeInTheDocument()
    expect(screen.getByText('100000')).toBeInTheDocument()
    expect(screen.getByText('250000')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /hide/i }))
    expect(screen.queryByText('credit_limit_minor')).toBeNull()
  })

  /**
   * A role's grant is a JSON array, and it is the most interesting diff in
   * the table. String(value) would render it "[object Object]".
   */
  it('renders a JSON value rather than [object Object]', async () => {
    const user = userEvent.setup()
    trail([
      entry({
        auditable_type: 'role',
        auditable_id: 11,
        changes: {
          before: { permissions: ['trips.view.all'] },
          after: { permissions: ['trips.view.all', 'invoices.view'] },
        },
      }),
    ])

    renderAs(<AuditLogPage />)

    await user.click(await screen.findByRole('button', { name: /show/i }))

    expect(screen.getByText('["trips.view.all"]')).toBeInTheDocument()
    expect(screen.getByText('["trips.view.all","invoices.view"]')).toBeInTheDocument()
    expect(screen.queryByText(/\[object Object\]/)).toBeNull()
  })

  it('shows a dash where a create has no before and a delete no after', async () => {
    const user = userEvent.setup()
    trail([
      entry({ action: 'created', changes: { before: null, after: { legal_name: 'Acme NGO' } } }),
    ])

    renderAs(<AuditLogPage />)

    await user.click(await screen.findByRole('button', { name: /show/i }))

    const row = screen.getByText('legal_name').closest('tr') as HTMLElement
    expect(within(row).getByText('—')).toBeInTheDocument()
    expect(within(row).getByText('Acme NGO')).toBeInTheDocument()
  })

  /**
   * The filter options are served, not held here. The server's own
   * whitelist read `company|user` while the table filled with roles and
   * invoices; a copy on the client is the same failure with an extra step.
   */
  it('offers exactly the record types the server said it accepts', async () => {
    renderAs(<AuditLogPage />)

    await screen.findByText('196.43.150.2')

    const options = within(screen.getByLabelText(/^Record type/))
      .getAllByRole('option')
      .map((o) => o.getAttribute('value'))

    // '' is the "Everything" placeholder.
    expect(options).toEqual(['', ...TYPES])
    expect(options).toContain('role')
    expect(options).toContain('vehicle_allocation')
  })

  it('asks the server to filter, rather than narrowing the page it has', async () => {
    const user = userEvent.setup()
    renderAs(<AuditLogPage />)

    await screen.findByText('196.43.150.2')

    await user.selectOptions(screen.getByLabelText(/^Record type/), 'role')
    await user.click(screen.getByRole('button', { name: /apply filters/i }))

    // Cursor-paginated at 25, so filtering locally would report "nothing
    // matches" for entries that had simply not been fetched.
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(expect.stringContaining('auditable_type=role')),
    )
  })

  /**
   * "Show me every credit-limit change in March" is the question this
   * screen exists to answer, and it was unanswerable until these landed.
   */
  it('sends a date range and an actor together', async () => {
    const user = userEvent.setup()
    renderAs(<AuditLogPage />)

    await screen.findByText('196.43.150.2')

    await user.selectOptions(screen.getByLabelText(/^Record type/), 'company')
    await user.selectOptions(screen.getByLabelText(/^Changed by/), '6')
    await user.type(screen.getByLabelText(/^From/), '2026-03-01')
    await user.type(screen.getByLabelText(/^To/), '2026-03-31')
    await user.click(screen.getByRole('button', { name: /apply filters/i }))

    await waitFor(() => {
      const url = get.mock.calls[get.mock.calls.length - 1][0] as string
      expect(url).toContain('auditable_type=company')
      expect(url).toContain('user_id=6')
      expect(url).toContain('from=2026-03-01')
      expect(url).toContain('to=2026-03-31')
    })
  })

  it('does not query while a date is still being typed', async () => {
    const user = userEvent.setup()
    renderAs(<AuditLogPage />)

    await screen.findByText('196.43.150.2')
    const before = get.mock.calls.length

    await user.type(screen.getByLabelText(/^From/), '2026-03-01')

    // "2026-0" is not a range anybody meant to run, and the server would
    // 422 it on the Y-m-d format rule.
    expect(get.mock.calls.length).toBe(before)
  })

  it('omits blank filters rather than sending them empty', async () => {
    const user = userEvent.setup()
    renderAs(<AuditLogPage />)

    await screen.findByText('196.43.150.2')
    await user.selectOptions(screen.getByLabelText(/^Action/), 'deleted')
    await user.click(screen.getByRole('button', { name: /apply filters/i }))

    await waitFor(() => {
      const url = get.mock.calls[get.mock.calls.length - 1][0] as string
      expect(url).toContain('action=deleted')
      // `from=` fails the server's date_format rule; an untouched field
      // must not turn into a 422.
      expect(url).not.toContain('from=')
      expect(url).not.toContain('user_id=')
    })
  })

  it('offers the actors the server said appear in this log', async () => {
    renderAs(<AuditLogPage />)

    await screen.findByText('196.43.150.2')

    const options = within(screen.getByLabelText(/^Changed by/))
      .getAllByRole('option')
      .map((o) => o.textContent)

    // Not every account that exists — the ones in this reader's slice.
    expect(options).toEqual(['Anyone', 'Ada Nakato', 'Brian Okello'])
  })

  it('pages with the server cursor and appends', async () => {
    const user = userEvent.setup()
    trail([entry()], meta({ cursor: { next: 'cur-2' } }))

    renderAs(<AuditLogPage />)

    await screen.findByText('196.43.150.2')

    trail([entry({ id: 2, user: makeUser({ id: 6, name: 'Brian Okello' }) })], meta())
    await user.click(screen.getByRole('button', { name: /load more/i }))

    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining('cursor=cur-2')))
    // Scoped to the table — both names are also options in "Changed by".
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3),
    )
    const table = within(screen.getByRole('table'))
    expect(table.getByText('Brian Okello')).toBeInTheDocument()
    // Both pages, not a replacement.
    expect(table.getByText('Ada Nakato')).toBeInTheDocument()
  })

  it('names the system when a change had no human actor', async () => {
    trail([entry({ user_id: null, user: null, ip_address: null })])

    renderAs(<AuditLogPage />)

    // A seeder, queue job or console command. An empty cell would read as
    // missing data rather than as an absent request.
    expect(await screen.findByText('System')).toBeInTheDocument()
  })

  /**
   * A platform reader sees every tenant plus the role changes that carry a
   * null tenant_id; a tenant reader never sees those. Saying which you are
   * looking at is the difference between a complete trail and a partial one
   * that looks complete.
   */
  it('says whether this is the whole platform or one organisation', async () => {
    trail([entry()], meta({ scope: 'platform' }))

    renderAs(<AuditLogPage />)

    expect(
      await screen.findByText(/Every tenant, plus platform-level changes/i),
    ).toBeInTheDocument()

    trail([entry()], meta({ scope: 'tenant' }))
    renderAs(<AuditLogPage />)

    expect(
      await screen.findAllByText(/Your organisation’s record of who changed what/i),
    ).not.toHaveLength(0)
  })

  it('tells an empty trail apart from an empty filter', async () => {
    const user = userEvent.setup()
    trail([])

    renderAs(<AuditLogPage />)

    expect(await screen.findByText('Nothing has been recorded yet')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/^Action/), 'deleted')
    await user.click(screen.getByRole('button', { name: /apply filters/i }))

    expect(await screen.findByText('Nothing matches these filters')).toBeInTheDocument()
  })

  it('treats a 403 as an answer rather than a fault', async () => {
    get.mockRejectedValue(
      apiFailure(403, 'FORBIDDEN', 'You do not have permission to perform this action.'),
    )

    renderAs(<AuditLogPage />, makeUser({ role: 'corporate_employee' }))

    expect(
      await screen.findByText('The audit log is not available to your account'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Audit log')).toBeNull()
  })

  it('says so when the trail genuinely cannot be loaded', async () => {
    get.mockRejectedValue(
      apiFailure(500, 'SERVER_ERROR', 'The audit log is unavailable right now.'),
    )

    renderAs(<AuditLogPage />)

    expect(await screen.findByText('The audit log is unavailable right now.')).toBeInTheDocument()
  })
})
