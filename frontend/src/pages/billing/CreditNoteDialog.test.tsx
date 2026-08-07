import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, renderAs } from '../../test/harness'
import type { Invoice } from '../../types/billing'
import { CreditNoteDialog } from './CreditNoteDialog'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

const { apiClient } = await import('../../lib/apiClient')
const post = vi.mocked(apiClient.post)

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    uuid: '0197f0e0-1111-7000-8000-000000000001',
    invoice_number: 'INV-2026-000001',
    trip_id: 12,
    rate_card_version_id: 4,
    currency: 'UGX',
    total_minor: 198_000,
    credited_minor: 10_000,
    balance_minor: 188_000,
    issued_at: '2026-07-20T08:00:00.000000Z',
    issued_by_user_id: 1,
    notes: null,
    lines: [
      {
        id: 501,
        line_number: 1,
        type: 'distance',
        type_label: 'Distance',
        description: '42 km at 500 per km',
        quantity: '42.00',
        unit_amount_minor: 500,
        amount_minor: 21_000,
        currency: 'UGX',
        inputs: {
          rate_card_version_id: 4,
          vehicle_category: 'sedan',
          zone: null,
          zone_id: null,
          distance_km: '42.00',
          waiting_minutes: null,
          multiplier_bp: 10_000,
          rounding_mode: 'half_up',
        },
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  post.mockResolvedValue(apiOk({ uuid: 'cn-1', credit_note_number: 'CN-2026-000001' }))
})

/**
 * The credit note dialog — the only path in this platform that changes what
 * a client owes (AGENTS.md: corrections are credit notes, "never silent
 * edits to issued invoices").
 *
 * This is the highest-consequence screen in the frontend, so the tests are
 * about refusing to send bad money rather than about layout.
 */
describe('CreditNoteDialog', () => {
  const noop = () => {}

  it('will not submit without a reason, a description and an amount', async () => {
    const user = userEvent.setup()
    renderAs(<CreditNoteDialog invoice={invoice()} onClose={noop} onIssued={noop} />)

    const issue = screen.getByRole('button', { name: /issue credit note/i })
    expect(issue).toBeDisabled()

    // A credit without a stated reason is precisely the audit finding the
    // credit-note mechanism exists to prevent.
    await user.type(screen.getByLabelText(/^reason/i), 'Client disputed the waiting charge.')
    expect(issue).toBeDisabled()

    await user.type(screen.getByLabelText(/what is being credited/i), 'Waiting time correction')
    expect(issue).toBeDisabled()

    await user.type(screen.getByLabelText(/^amount/i), '5000')
    expect(issue).toBeEnabled()
  })

  it('refuses an amount larger than the invoice has left, before any round trip', async () => {
    const user = userEvent.setup()
    renderAs(<CreditNoteDialog invoice={invoice()} onClose={noop} onIssued={noop} />)

    await user.type(screen.getByLabelText(/^reason/i), 'Overcharged.')
    await user.type(screen.getByLabelText(/what is being credited/i), 'Correction')
    await user.type(screen.getByLabelText(/^amount/i), '188001')

    // 198,000 invoiced less 10,000 already credited leaves 188,000. This
    // guard is a courtesy — CreditNoteService checks the running total
    // under the invoice's row lock — but it catches the typo without a
    // round trip and explains the arithmetic.
    expect(await screen.findByText('More than the invoice has left')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /issue credit note/i })).toBeDisabled()
    expect(post).not.toHaveBeenCalled()
  })

  it('allows crediting exactly the remaining balance', async () => {
    const user = userEvent.setup()
    renderAs(<CreditNoteDialog invoice={invoice()} onClose={noop} onIssued={noop} />)

    await user.type(screen.getByLabelText(/^reason/i), 'Settled in full.')
    await user.type(screen.getByLabelText(/what is being credited/i), 'Settlement')
    await user.type(screen.getByLabelText(/^amount/i), '188000')

    // The boundary is inclusive: the invariant is that credits may not
    // *exceed* the invoice, so crediting it to zero is legitimate.
    expect(screen.queryByText('More than the invoice has left')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /issue credit note/i })).toBeEnabled()
  })

  it('sends the amount as whole shillings with an idempotency key', async () => {
    const user = userEvent.setup()
    renderAs(<CreditNoteDialog invoice={invoice()} onClose={noop} onIssued={noop} />)

    await user.type(screen.getByLabelText(/^reason/i), 'Client disputed the waiting charge.')
    await user.type(screen.getByLabelText(/what is being credited/i), 'Waiting time correction')
    await user.type(screen.getByLabelText(/^amount/i), '5000')
    await user.click(screen.getByRole('button', { name: /issue credit note/i }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))

    const [url, body, config] = post.mock.calls[0]

    expect(url).toBe('/invoices/0197f0e0-1111-7000-8000-000000000001/credit-notes')
    // UGX is zero-decimal, so the figure typed is the figure stored. No
    // multiply-by-100 anywhere, which is the classic money bug.
    expect(body).toEqual({
      reason: 'Client disputed the waiting charge.',
      lines: [{ description: 'Waiting time correction', amount_minor: 5000 }],
    })
    expect((config as { headers: Record<string, string> }).headers['Idempotency-Key']).toMatch(
      /^[0-9a-f-]{36}$/i,
    )
  })

  it('reuses the same idempotency key when a failed attempt is retried', async () => {
    const user = userEvent.setup()
    post.mockRejectedValueOnce(apiFailure(500, 'SERVER_ERROR', 'The billing service is unavailable.'))

    renderAs(<CreditNoteDialog invoice={invoice()} onClose={noop} onIssued={noop} />)

    await user.type(screen.getByLabelText(/^reason/i), 'Client disputed the waiting charge.')
    await user.type(screen.getByLabelText(/what is being credited/i), 'Waiting time correction')
    await user.type(screen.getByLabelText(/^amount/i), '5000')

    await user.click(screen.getByRole('button', { name: /issue credit note/i }))
    await screen.findByText('The billing service is unavailable.')

    await user.click(screen.getByRole('button', { name: /issue credit note/i }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))

    // A key identifies one intended mutation. Minting a new one per click
    // would turn a retry after a dropped response into a second credit —
    // which the server refuses, but for the wrong reason.
    const key = (call: number) =>
      (post.mock.calls[call][2] as { headers: Record<string, string> }).headers['Idempotency-Key']

    expect(key(0)).toBe(key(1))
  })

  it('attaches the invoice line\'s own id when one is chosen', async () => {
    const user = userEvent.setup()
    renderAs(<CreditNoteDialog invoice={invoice()} onClose={noop} onIssued={noop} />)

    await user.type(screen.getByLabelText(/^reason/i), 'Distance was overstated.')
    await user.type(screen.getByLabelText(/what is being credited/i), 'Distance correction')
    await user.type(screen.getByLabelText(/^amount/i), '1000')
    await user.selectOptions(screen.getByLabelText(/against a specific line/i), '501')
    await user.click(screen.getByRole('button', { name: /issue credit note/i }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))

    // The line's `id`, not its `line_number` — the server validates against
    // `invoice_lines.id`, and sending 1 for line_number 1 would resolve to
    // a different line or another invoice's.
    expect(post.mock.calls[0][1]).toEqual({
      reason: 'Distance was overstated.',
      lines: [{ description: 'Distance correction', amount_minor: 1000, invoice_line_id: 501 }],
    })
  })

  it('surfaces the server\'s refusal when a colleague credited the invoice first', async () => {
    const user = userEvent.setup()
    post.mockRejectedValue(
      apiFailure(
        422,
        'CREDIT_NOTE_EXCEEDS_INVOICE',
        'This invoice has 2,000 left to credit. Another credit note was issued while this one was open.',
      ),
    )

    renderAs(<CreditNoteDialog invoice={invoice()} onClose={noop} onIssued={noop} />)

    await user.type(screen.getByLabelText(/^reason/i), 'Correction.')
    await user.type(screen.getByLabelText(/what is being credited/i), 'Correction')
    await user.type(screen.getByLabelText(/^amount/i), '5000')
    await user.click(screen.getByRole('button', { name: /issue credit note/i }))

    // The dialog's own guard cannot see a note a colleague is issuing right
    // now, so this 422 is genuinely reachable and must be shown rather than
    // swallowed.
    expect(
      await screen.findByText(/another credit note was issued while this one was open/i),
    ).toBeInTheDocument()
  })

  it('warns that a credit note cannot be undone', async () => {
    renderAs(<CreditNoteDialog invoice={invoice()} onClose={noop} onIssued={noop} />)

    // Append-only by design: a note issued in error stays on the record and
    // the record shows both. The user is told before, not after.
    expect(screen.getByText('A credit note is permanent')).toBeInTheDocument()
  })

  it('states what is left to credit', async () => {
    renderAs(<CreditNoteDialog invoice={invoice()} onClose={noop} onIssued={noop} />)

    expect(screen.getByText(/UGX 198,000/)).toBeInTheDocument()
    expect(screen.getByText(/UGX 188,000 outstanding/)).toBeInTheDocument()
  })
})
