import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, renderAs } from '../test/harness'
import { DriverApplicationsPage } from './DriverApplicationsPage'
import type { DriverApplication } from '../types/driverApplication'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)

function application(overrides: Partial<DriverApplication> = {}): DriverApplication {
  return {
    id: 7,
    name: 'Musa Kiwanuka',
    phone: '0772 123 456',
    email: 'musa@example.com',
    status: 'pending',
    status_label: 'Awaiting review',
    terms_accepted_at: '2026-08-14T09:00:00.000000Z',
    reviewed_at: null,
    reviewed_by_user_id: null,
    rejection_reason: null,
    driver_id: null,
    created_at: '2026-08-14T09:00:00.000000Z',
    ...overrides,
  }
}

const listOf = (...rows: DriverApplication[]) => apiOk({ driver_applications: rows })

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * ADR-0027's consequence, on a screen: "somebody has to read it — an
 * application nobody reviews is worse than no form, because the applicant
 * believes they have applied."
 *
 * So the first thing asserted is that the queue opens on the people still
 * waiting, and the rest is about not letting a reviewer do damage: no
 * approval without the licence details, and no second decision on a row
 * somebody already decided.
 */
describe('DriverApplicationsPage', () => {
  it('opens on the people still waiting, not on everything ever submitted', async () => {
    get.mockResolvedValue(listOf(application()))

    renderAs(<DriverApplicationsPage />)

    expect(await screen.findByText('Musa Kiwanuka')).toBeVisible()

    // Mutation check — default the filter to 'all' and this fails.
    expect(get).toHaveBeenCalledWith('/driver-applications', { params: { status: 'pending' } })
  })

  it('shows the phone number, because it is the only way anyone hears back', async () => {
    // ADR-0027 §6 gives an applicant no way to check their own status, so
    // this column is the whole feedback channel.
    get.mockResolvedValue(listOf(application()))

    renderAs(<DriverApplicationsPage />)

    expect(await screen.findByText('0772 123 456')).toBeVisible()
  })

  it('approves with the licence details the applicant could not be trusted for', async () => {
    get.mockResolvedValue(listOf(application()))
    post.mockResolvedValue(apiOk({}))

    renderAs(<DriverApplicationsPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))
    await userEvent.type(screen.getByLabelText(/licence number/i), 'UG-DL-2026-0001')
    await userEvent.type(screen.getByLabelText(/licence expiry/i), '2029-06-30')
    await userEvent.click(screen.getByRole('button', { name: /approve and create sign-in/i }))

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/driver-applications/7/approve', {
        license_number: 'UG-DL-2026-0001',
        license_expiry: '2029-06-30',
      }),
    )
  })

  it('surfaces the 409 when somebody else already decided the row', async () => {
    get.mockResolvedValue(listOf(application()))
    post.mockRejectedValue(
      apiFailure(409, 'DRIVER_APPLICATION_CLOSED', "Musa Kiwanuka's application was already approved."),
    )

    renderAs(<DriverApplicationsPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))
    await userEvent.type(screen.getByLabelText(/licence number/i), 'UG-DL-2026-0001')
    await userEvent.type(screen.getByLabelText(/licence expiry/i), '2029-06-30')
    await userEvent.click(screen.getByRole('button', { name: /approve and create sign-in/i }))

    // A conflict has no field to hang off, so it has to be said out loud —
    // otherwise the dialog just sits there and the reviewer clicks again.
    expect(await screen.findByText(/already approved/i)).toBeVisible()
  })

  it('requires a reason to reject, and sends it', async () => {
    get.mockResolvedValue(listOf(application()))
    post.mockResolvedValue(apiOk({}))

    renderAs(<DriverApplicationsPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))
    await userEvent.click(screen.getByRole('button', { name: /reject instead/i }))
    await userEvent.type(screen.getByLabelText(/reason/i), 'Licence expired last month.')
    await userEvent.click(screen.getByRole('button', { name: /reject application/i }))

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/driver-applications/7/reject', {
        reason: 'Licence expired last month.',
      }),
    )
  })

  /**
   * ADR-0027 §4 makes a decision final. Offering a Review button on a decided
   * row would be offering a control whose only outcome is a 409.
   */
  it('offers no second decision on a row that already has one', async () => {
    get.mockResolvedValue(
      listOf(
        application({
          status: 'approved',
          status_label: 'Approved',
          driver_id: 12,
          reviewed_at: '2026-08-14T10:00:00.000000Z',
        }),
      ),
    )

    renderAs(<DriverApplicationsPage />)

    expect(await screen.findByText('Approved')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull()
  })

  it('says the queue is empty rather than showing a bare table', async () => {
    get.mockResolvedValue(listOf())

    renderAs(<DriverApplicationsPage />)

    expect(await screen.findByText(/the queue is empty/i)).toBeVisible()
  })
})
