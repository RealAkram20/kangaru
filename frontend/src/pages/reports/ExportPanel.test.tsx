import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, renderAs } from '../../test/harness'
import type { TripReportFilters } from '../../types/report'
import { ExportPanel } from './ExportPanel'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

const { apiClient } = await import('../../lib/apiClient')
const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)

const FILTERS: TripReportFilters = {
  from: '2026-08-01',
  to: '2026-08-31',
  vehicle_id: '',
  driver_id: '',
  group_by: 'month',
}

const NAME_A_CLIENT =
  'Choose the client this financial report is for. A total across every client is a ' +
  "different figure from any one client's, so it is not produced here."

beforeEach(() => {
  vi.clearAllMocks()
  // The panel lists existing exports on mount; every test here is about what
  // happens when one is *requested*, so the listing is simply empty.
  get.mockResolvedValue(apiOk([]))
})

describe('ExportPanel', () => {
  /**
   * ADR-0007 rule 2 applies to the export as much as to the report on screen
   * — `POST /reports/exports` answers the same `422` to a platform user who
   * has not named a client, because an exported PDF of a cross-client total
   * is the same figure that must not be produced.
   *
   * This is a regression guard with a specific history. The report panel was
   * taught to read `errors.tenant_id` and the export panel directly beneath
   * it was not, so one card explained the refusal while the other printed
   * Laravel's "The given data was invalid." — inches apart, on the same
   * screen, about the same decision. Tests were green throughout; only
   * opening the page showed it.
   */
  it('shows the field explanation when an export is refused for naming no client', async () => {
    post.mockRejectedValue(
      apiFailure(422, 'VALIDATION_FAILED', 'The given data was invalid.', {
        tenant_id: [NAME_A_CLIENT],
      }),
    )

    renderAs(<ExportPanel filters={FILTERS} report="financial" />)

    await userEvent.click(await screen.findByRole('button', { name: 'CSV' }))

    expect(await screen.findByText(/Choose the client this financial report is for/)).toBeVisible()
    expect(screen.queryByText('The given data was invalid.')).toBeNull()
  })

  /**
   * The fallback has to survive the fix. REPORT_TOO_LARGE carries no field
   * errors and its envelope message already names the trip count and says
   * how to narrow the range, so it must still be shown verbatim — preferring
   * field errors must not mean discarding the message when there are none.
   */
  it('shows the envelope message when the failure carries no field errors', async () => {
    post.mockRejectedValue(
      apiFailure(
        422,
        'REPORT_TOO_LARGE',
        'This report covers 48,000 trips. Narrow the date range and try again.',
        {},
      ),
    )

    renderAs(<ExportPanel filters={FILTERS} report="trips" />)

    await userEvent.click(await screen.findByRole('button', { name: 'CSV' }))

    expect(await screen.findByText(/This report covers 48,000 trips\./)).toBeVisible()
  })

  it('raises no banner when the export is accepted', async () => {
    post.mockResolvedValue(apiOk(null))

    renderAs(<ExportPanel filters={FILTERS} report="financial" />)

    await userEvent.click(await screen.findByRole('button', { name: 'CSV' }))

    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(screen.queryByText('Export problem')).toBeNull()
  })
})
