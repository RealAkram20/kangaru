import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiOk, renderAs } from '../../test/harness'
import { DriverDocumentsDialog } from './DriverDocumentsDialog'
import type { Driver } from '../../types/driver'
import type { DriverDocumentSlot } from '../../types/driverDocument'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

const { apiClient } = await import('../../lib/apiClient')
const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)

function driver(): Driver {
  return {
    id: 3,
    name: 'Ada Nakato',
    phone: '+256700999888',
    email: null,
    license_number: 'DL-99881',
    license_expiry: '2028-01-01',
    status: 'active',
    account: null,
    created_at: '2026-01-01T00:00:00.000000Z',
    updated_at: '2026-01-01T00:00:00.000000Z',
  }
}

function slot(overrides: Partial<DriverDocumentSlot> = {}): DriverDocumentSlot {
  return {
    type: 'driving_licence',
    type_label: 'Driving licence',
    hint: 'Both sides if the details are split across them.',
    requires_expiry: true,
    document: {
      id: 11,
      driver_id: 3,
      type: 'driving_licence',
      type_label: 'Driving licence',
      status: 'pending',
      status_label: 'Waiting for the office',
      compliance_state: 'pending',
      expires_at: '2028-03-14',
      expired: false,
      original_name: 'licence.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 240_000,
      uploaded_at: '2026-08-15T10:00:00+03:00',
      rejection_reason: null,
      reviewed_at: null,
      file_url: '/api/v1/drivers/3/documents/11/file',
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * The office half of ADR-0033, and the reason it ships in the same change as
 * the feature.
 *
 * ADR-0029 created an obligation for the office and gave it no screen; ten
 * months later nothing had ever recorded a settlement. A verification queue
 * with no surface would repeat that exactly — drivers uploading licences
 * nobody could accept, and an app permanently reading "waiting for the
 * office".
 */
describe('DriverDocumentsDialog', () => {
  it('shows every type, including the ones never sent', async () => {
    get.mockResolvedValue(
      apiOk([
        slot(),
        slot({
          type: 'identity_document',
          type_label: 'Identity document',
          requires_expiry: false,
          hint: 'A national ID, passport, or whatever your country issues.',
          document: null,
        }),
      ]),
    )

    renderAs(<DriverDocumentsDialog driver={driver()} onClose={() => {}} />, {
      permissions: ['drivers.manage'],
    })

    // "What is this person missing" is the question a reviewer arrives with,
    // and the uploaded subset cannot answer it.
    expect(await screen.findByText('Identity document')).toBeInTheDocument()
    expect(screen.getByText('Not sent')).toBeInTheDocument()
  })

  it('reads compliance_state, so a lapsed licence is not shown as in order', async () => {
    // The stored status still says `verified` because nothing wrote to the
    // row. A screen reading `status` would tell an office that an expired
    // licence is fine — which is what ADR-0033 exists to stop.
    get.mockResolvedValue(
      apiOk([
        slot({
          document: {
            ...slot().document!,
            status: 'verified',
            status_label: 'Verified',
            compliance_state: 'expired',
            expired: true,
            expires_at: '2026-07-01',
          },
        }),
      ]),
    )

    renderAs(<DriverDocumentsDialog driver={driver()} onClose={() => {}} />, {
      permissions: ['drivers.manage'],
    })

    expect(await screen.findByText('Expired')).toBeInTheDocument()
    expect(screen.queryByText('Verified')).not.toBeInTheDocument()
  })

  it('records a verification against the driver in the path', async () => {
    get.mockResolvedValue(apiOk([slot()]))
    post.mockResolvedValue(apiOk(null))

    renderAs(<DriverDocumentsDialog driver={driver()} onClose={() => {}} />, {
      permissions: ['drivers.manage'],
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Verify' }))

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/drivers/3/documents/11/verify', undefined),
    )
  })

  it('will not let a rejection go out without a reason', async () => {
    get.mockResolvedValue(apiOk([slot()]))

    renderAs(<DriverDocumentsDialog driver={driver()} onClose={() => {}} />, {
      permissions: ['drivers.manage'],
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }))

    // The server refuses an empty reason. Disabling here means the reviewer
    // learns it from the control rather than from a 422 — and the driver, who
    // sees this sentence and nothing else, is the reason it is required at all.
    const confirm = screen.getAllByRole('button', { name: 'Reject' }).at(-1)!

    expect(confirm).toBeDisabled()

    await userEvent.type(screen.getByLabelText(/Reason/), 'Too dark to read.')

    expect(confirm).toBeEnabled()

    await userEvent.click(confirm)

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/drivers/3/documents/11/reject', {
        reason: 'Too dark to read.',
      }),
    )
  })
})
