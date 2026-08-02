import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, makeUser, renderAs } from '../test/harness'
import type { Invoice } from '../types/billing'
import { InvoicesPage } from './InvoicesPage'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    uuid: 'inv-uuid-1',
    invoice_number: 'INV-2026-000001',
    trip_id: 41,
    rate_card_version_id: 3,
    currency: 'UGX',
    total_minor: 188000,
    credited_minor: 0,
    balance_minor: 188000,
    issued_at: '2026-07-21T08:14:22.000000Z',
    issued_by_user_id: 1,
    notes: null,
    ...overrides,
  }
}

function ledger(invoices: Invoice[], next: string | null = null) {
  get.mockResolvedValue(apiOk(invoices, { cursor: { next } }))
}

beforeEach(() => {
  vi.clearAllMocks()
  ledger([invoice()])
})

describe('InvoicesPage', () => {
  it('shows money as whole shillings, never divided by a hundred', async () => {
    ledger([invoice()])

    renderAs(<InvoicesPage />, makeUser({ role: 'finance' }))

    expect(await screen.findByText('INV-2026-000001')).toBeInTheDocument()
    // UGX is zero-decimal: `*_minor` is already whole shillings, so 188000
    // is UGX 188,000 and never UGX 1,880. This is the assertion that would
    // catch a stray /100 creeping in from a two-decimal-currency habit.
    expect(screen.getAllByText('UGX 188,000').length).toBeGreaterThan(0)
  })

  /**
   * There is no invoice status column and no payments module, so the only
   * distinction the page can honestly draw is how much has been credited
   * back. These three states are that distinction.
   */
  it('distinguishes issued, part-credited and fully credited', async () => {
    ledger([
      invoice(),
      invoice({
        uuid: 'u2',
        invoice_number: 'INV-2026-000002',
        credited_minor: 50000,
        balance_minor: 138000,
      }),
      invoice({
        uuid: 'u3',
        invoice_number: 'INV-2026-000003',
        credited_minor: 188000,
        balance_minor: 0,
      }),
    ])

    renderAs(<InvoicesPage />, makeUser({ role: 'finance' }))

    await screen.findByText('INV-2026-000001')

    const row = (n: string) => screen.getByText(n).closest('tr') as HTMLElement

    expect(within(row('INV-2026-000001')).getByText('Issued')).toBeInTheDocument()
    expect(within(row('INV-2026-000002')).getByText('Part credited')).toBeInTheDocument()
    expect(within(row('INV-2026-000003')).getByText('Fully credited')).toBeInTheDocument()

    // A credit is money going the other way, and is signed accordingly.
    expect(within(row('INV-2026-000002')).getByText('−UGX 50,000')).toBeInTheDocument()
    expect(within(row('INV-2026-000001')).getByText('—')).toBeInTheDocument()
  })

  it('calls the outstanding total what it actually is', async () => {
    ledger([invoice({ credited_minor: 8000, balance_minor: 180000 })])

    renderAs(<InvoicesPage />, makeUser({ role: 'finance' }))

    await screen.findByText('INV-2026-000001')

    // Payments are not built. Presenting issued-less-credited as "unpaid"
    // would misstate the ledger to a finance officer, so the hint says so.
    expect(screen.getByText('Outstanding')).toBeInTheDocument()
    expect(screen.getByText(/payments are not recorded yet/i)).toBeInTheDocument()
  })

  it('asks the server for the filters rather than narrowing what it already has', async () => {
    const user = userEvent.setup()
    renderAs(<InvoicesPage />, makeUser({ role: 'finance' }))

    await screen.findByText('INV-2026-000001')

    await user.type(screen.getByLabelText(/^Invoice number/), 'INV-2026-000009')
    await user.click(screen.getByRole('button', { name: /apply filters/i }))

    // The page holds one cursor page, so filtering locally would report
    // "no matches" for invoices that simply had not been fetched.
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(expect.stringContaining('invoice_number=INV-2026-000009')),
    )
  })

  it('pages with the cursor the server returned, and appends rather than replaces', async () => {
    const user = userEvent.setup()
    ledger([invoice()], 'cursor-two')

    renderAs(<InvoicesPage />, makeUser({ role: 'finance' }))

    await screen.findByText('INV-2026-000001')

    ledger([invoice({ uuid: 'u2', invoice_number: 'INV-2026-000002' })], null)
    await user.click(screen.getByRole('button', { name: /load more/i }))

    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(expect.stringContaining('cursor=cursor-two')),
    )
    // Both pages on screen — a second page that replaced the first would
    // look like the list had shrunk.
    expect(await screen.findByText('INV-2026-000002')).toBeInTheDocument()
    expect(screen.getByText('INV-2026-000001')).toBeInTheDocument()
  })

  it('offers no Load more when the server sent no next cursor', async () => {
    ledger([invoice()], null)

    renderAs(<InvoicesPage />, makeUser({ role: 'finance' }))

    await screen.findByText('INV-2026-000001')
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull()
  })

  it('explains a 403 instead of reporting a fault', async () => {
    get.mockRejectedValue(
      apiFailure(403, 'FORBIDDEN', 'You do not have permission to perform this action.'),
    )

    renderAs(<InvoicesPage />, makeUser({ role: 'corporate_employee' }))

    expect(await screen.findByText('Invoices are not visible to your role')).toBeInTheDocument()
    // Not the red error banner: nothing is broken.
    expect(screen.queryByText('Could not load invoices.')).toBeNull()
  })

  it('says an empty ledger is empty, and where invoices come from', async () => {
    ledger([])

    renderAs(<InvoicesPage />, makeUser({ role: 'finance' }))

    expect(await screen.findByText('No invoices yet')).toBeInTheDocument()
    // Nothing on this page creates one; saying so saves a hunt for a button
    // that does not exist.
    expect(screen.getByText(/raised from a completed trip on the Trips page/i)).toBeInTheDocument()
  })

  it('reports a genuine failure as one', async () => {
    get.mockRejectedValue(apiFailure(500, 'SERVER_ERROR', 'Invoices are unavailable right now.'))

    renderAs(<InvoicesPage />, makeUser({ role: 'finance' }))

    expect(await screen.findByText('Invoices are unavailable right now.')).toBeInTheDocument()
  })
})
