import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, renderAs } from '../../test/harness'
import { FinancialReport } from './FinancialReport'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

const { apiClient } = await import('../../lib/apiClient')
const get = vi.mocked(apiClient.get)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('FinancialReport', () => {
  /**
   * ADR-0007 rule 2: a platform user who has not named a client gets a 422
   * rather than a total spanning every client.
   *
   * The refusal is deliberate, so the screen has to read like one. The
   * explanation arrives in `errors.tenant_id`; the envelope's own `message`
   * is Laravel's "The given data was invalid.", and rendering that turns a
   * considered decision into what looks like a broken page — worse than the
   * blank table this replaced, and against AGENTS.md's rule that an error
   * says what to do next.
   */
  it('shows the field explanation when a client has not been chosen', async () => {
    get.mockRejectedValue(
      apiFailure(422, 'VALIDATION_FAILED', 'The given data was invalid.', {
        tenant_id: [
          'Choose the client this financial report is for. A total across every client is a ' +
            "different figure from any one client's, so it is not produced here.",
        ],
      }),
    )

    renderAs(<FinancialReport from="" to="" groupBy="month" client="" reloadToken={0} />)

    expect(await screen.findByText(/Choose the client this financial report is for/)).toBeVisible()
    expect(screen.queryByText('The given data was invalid.')).toBeNull()
  })

  /**
   * The fallback still has to work: a failure with no field errors — a
   * network drop, a 500 — has nothing better to show than the envelope
   * message, and must not render blank.
   */
  it('falls back to the envelope message when there is no field error', async () => {
    get.mockRejectedValue(apiFailure(500, 'SERVER_ERROR', 'Something went wrong on our end.', {}))

    renderAs(<FinancialReport from="" to="" groupBy="month" client="" reloadToken={0} />)

    expect(await screen.findByText('Something went wrong on our end.')).toBeVisible()
  })

  it('renders the report when the request succeeds', async () => {
    get.mockResolvedValue(
      apiOk([], {
        summary: {
          invoiced_minor: 250000,
          credited_minor: 0,
          outstanding_minor: 250000,
          invoices: 1,
          credit_notes: 0,
          payments_recorded: false,
          periods: 1,
        },
      }),
    )

    renderAs(<FinancialReport from="" to="" groupBy="month" client="" reloadToken={0} />)

    // Not the error card — the point is that the new message handling did
    // not turn every successful load into a failure.
    expect(await screen.findByText(/Invoiced/i)).toBeVisible()
    expect(screen.queryByText('Report problem')).toBeNull()
  })
})
