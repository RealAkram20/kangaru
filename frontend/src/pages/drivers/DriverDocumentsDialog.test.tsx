import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
// `makeUser()`, not a `{ permissions: [...] }` literal. `renderAs` takes a
// whole `User` and this dialog reads no user at all — the authorisation that
// matters is `DriverDocumentPolicy` on the server, which a component test
// cannot exercise. The old literal type-checked only because `tsc --noEmit`
// resolves this project's solution-file tsconfig to nothing; `tsc -b` catches
// it, and that is what CI runs.
import { apiOk, makeUser, renderAs } from '../../test/harness'
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
    // ADR-0048 §7. Both are required on the wire: `DriverResource` sends them
    // unconditionally, so a fixture that omits them is a fixture testing a
    // response shape the server does not produce.
    vehicle_id: null,
    owns_vehicle: false,
    account: null,
    created_at: '2026-01-01T00:00:00.000000Z',
    updated_at: '2026-01-01T00:00:00.000000Z',
  }
}

function slot(overrides: Partial<DriverDocumentSlot> = {}): DriverDocumentSlot {
  return {
    type: 'driving_licence',
    group: 'driver',
    group_label: 'Driver information',
    type_label: 'Driving licence',
    hint: 'Both sides if the details are split across them.',
    requires_expiry: true,
    document: {
      id: 11,
      driver_id: 3,
      driver_application_id: null,
      type: 'driving_licence',
      group: 'driver',
      group_label: 'Driver information',
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

    renderAs(<DriverDocumentsDialog driver={driver()} onClose={() => {}} />, makeUser())

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

    renderAs(<DriverDocumentsDialog driver={driver()} onClose={() => {}} />, makeUser())

    expect(await screen.findByText('Expired')).toBeInTheDocument()
    expect(screen.queryByText('Verified')).not.toBeInTheDocument()
  })

  it('records a verification against the driver in the path', async () => {
    get.mockResolvedValue(apiOk([slot()]))
    post.mockResolvedValue(apiOk(null))

    renderAs(<DriverDocumentsDialog driver={driver()} onClose={() => {}} />, makeUser())

    await userEvent.click(await screen.findByRole('button', { name: 'Verify' }))

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/drivers/3/documents/11/verify', undefined),
    )
  })

  it('will not let a rejection go out without a reason', async () => {
    get.mockResolvedValue(apiOk([slot()]))

    renderAs(<DriverDocumentsDialog driver={driver()} onClose={() => {}} />, makeUser())

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

/**
 * The office's own KYC surface (ADR-0052 §5): filing a document a driver
 * handed over, and reading the set without leaving the dialog.
 */
describe('filing and browsing', () => {
  /** A second, held document so there is a set to browse. */
  function selfie(): DriverDocumentSlot {
    return slot({
      type: 'identity_selfie',
      type_label: 'Selfie',
      group: 'personal',
      group_label: 'Personal information',
      requires_expiry: false,
      document: { ...slot().document!, id: 12, type: 'identity_selfie', type_label: 'Selfie' },
    })
  }

  /** An empty slot — the case the upload button exists for. */
  function empty(): DriverDocumentSlot {
    return slot({
      type: 'vehicle_photo',
      type_label: 'Vehicle photo',
      group: 'vehicle',
      group_label: 'Vehicle information',
      requires_expiry: false,
      document: null,
    })
  }

  it('offers Upload on an empty slot, where there is nothing to replace', async () => {
    get.mockResolvedValue(apiOk([empty()]))

    renderAs(<DriverDocumentsDialog driver={driver()} onClose={() => {}} />, makeUser())

    // The whole point of the endpoint: before it, a driver who handed their
    // papers across the counter had no way onto the platform at all.
    expect(await screen.findByRole('button', { name: 'Upload' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument()
  })

  it('files a document, and says plainly that filing is not verifying', async () => {
    get.mockResolvedValue(apiOk([empty()]))
    post.mockResolvedValue(apiOk({}))

    renderAs(<DriverDocumentsDialog driver={driver()} onClose={() => {}} />, makeUser())

    await userEvent.click(await screen.findByRole('button', { name: 'Upload' }))

    // ADR-0033 §4 survives this surface, and the clerk is told so before they
    // choose a file rather than discovering the row still says "waiting".
    expect(screen.getByText(/does not verify it/i)).toBeInTheDocument()

    const file = new File(['bytes'], 'car.jpg', { type: 'image/jpeg' })

    await userEvent.upload(screen.getByLabelText(/^File$/), file)
    await userEvent.click(screen.getByRole('button', { name: 'File document' }))

    await waitFor(() => expect(post).toHaveBeenCalled())

    const [path, body] = post.mock.calls.at(-1)!

    expect(path).toBe('/drivers/3/documents')
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).get('type')).toBe('vehicle_photo')
    expect((body as FormData).get('file')).toBe(file)
  })

  /**
   * The expiry rule comes from the server's `requires_expiry`, never from a
   * copy of it here — which is how a console ends up asserting a rule the
   * office has since changed. Asked before the upload, so nobody meets it as a
   * 422 on a file they already chose.
   */
  it('will not file a licence without the date the server requires', async () => {
    get.mockResolvedValue(apiOk([slot({ document: null })]))

    renderAs(<DriverDocumentsDialog driver={driver()} onClose={() => {}} />, makeUser())

    await userEvent.click(await screen.findByRole('button', { name: 'Upload' }))
    await userEvent.upload(
      screen.getByLabelText(/^File$/),
      new File(['bytes'], 'licence.pdf', { type: 'application/pdf' }),
    )

    const file = screen.getByRole('button', { name: 'File document' })

    expect(file).toBeDisabled()

    await userEvent.type(screen.getByLabelText(/Expires on/), '2029-04-01')

    expect(file).toBeEnabled()
  })

  it('warns that replacing discards the review, before a file is chosen', async () => {
    get.mockResolvedValue(apiOk([slot()]))

    renderAs(<DriverDocumentsDialog driver={driver()} onClose={() => {}} />, makeUser())

    await userEvent.click(await screen.findByRole('button', { name: 'Replace' }))

    // ADR-0033 §2, said where it can still change the decision.
    expect(screen.getByText(/starts as unchecked/i)).toBeInTheDocument()
  })

  /**
   * Reviewing a driver means comparing a selfie against an identity document.
   * A previewer that has to be closed and reopened between each pair is the
   * friction that makes a reviewer stop comparing.
   */
  it('browses the held documents without closing the previewer', async () => {
    get.mockResolvedValue(apiOk([slot(), selfie(), empty()]))

    renderAs(<DriverDocumentsDialog driver={driver()} onClose={() => {}} />, makeUser())

    await userEvent.click((await screen.findAllByRole('button', { name: 'View' }))[0]!)

    // Two of two, not three: the empty slot is not a document, and an arrow
    // that lands on "Not sent" is an arrow that wasted a click.
    expect(await screen.findByText('1 of 2')).toBeInTheDocument()

    // Null at the ends rather than wrapping — a silent wrap is how somebody
    // reads four of six twice and the last two never.
    expect(screen.getByRole('button', { name: 'Previous document' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Next document' }))

    expect(await screen.findByText('2 of 2')).toBeInTheDocument()

    // Re-queried rather than held from before the click: the previewer is
    // keyed by the document, so moving on **remounts** it — which is the point
    // (zoom and rotation reset to fit) and which detaches the old nodes.
    expect(screen.getByRole('button', { name: 'Next document' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous document' })).toBeEnabled()
  })
})

})

/**
 * The owner's report, 24 August: *"we are still having verify button yet the
 * document is verified"*.
 *
 * Both verdicts rendered on every held row, so a document badged **Verified**
 * sat beside a button whose only effect would be to rewrite the row with what
 * it already said. Read from the outside that is not a spare control — it is
 * the badge appearing to be wrong.
 */
describe('the verdict a document already holds', () => {
  const verified = () =>
    slot({
      document: {
        ...(slot().document as NonNullable<DriverDocumentSlot['document']>),
        status: 'verified',
        status_label: 'Verified',
        compliance_state: 'verified',
      },
    })

  it('offers no Verify on a document that is already verified', async () => {
    get.mockResolvedValue(apiOk([verified()]))

    renderAs(<DriverDocumentsDialog driver={driver()} onClose={() => {}} />, makeUser())

    expect(await screen.findByText('Verified')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^verify$/i })).toBeNull()
  })

  /**
   * The other half, and the reason this is a pair rather than one assertion:
   * hiding both would pass the test above and leave an office that verified a
   * forged licence with no way to say so short of waiting for a replacement.
   *
   * `DriverDocumentService::verify()` clears `rejection_reason` on purpose,
   * *"so a document rejected and later accepted does not carry the old
   * objection"* — reversal is a designed flow, not an edge case.
   */
  it('still offers Reject on a verified document, so a decision can be reversed', async () => {
    get.mockResolvedValue(apiOk([verified()]))

    renderAs(<DriverDocumentsDialog driver={driver()} onClose={() => {}} />, makeUser())

    expect(await screen.findByRole('button', { name: /^reject$/i })).toBeInTheDocument()
  })

  it('offers no Reject on a rejected document, and does offer Verify', async () => {
    get.mockResolvedValue(
      apiOk([
        slot({
          document: {
            ...(slot().document as NonNullable<DriverDocumentSlot['document']>),
            status: 'rejected',
            status_label: 'Rejected',
            compliance_state: 'rejected',
            rejection_reason: 'The photograph is unreadable.',
          },
        }),
      ]),
    )

    renderAs(<DriverDocumentsDialog driver={driver()} onClose={() => {}} />, makeUser())

    expect(await screen.findByRole('button', { name: /^verify$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^reject$/i })).toBeNull()
  })

  /**
   * An expired document is `status: verified` with `compliance_state: expired`,
   * which is why the buttons read `status` and the badge reads
   * `compliance_state`. Verifying it again would not move its expiry date by a
   * day; Replace is what fixes it, and Replace is already on the row.
   */
  it('offers no Verify on an expired document either, because verifying changes nothing', async () => {
    get.mockResolvedValue(
      apiOk([
        slot({
          document: {
            ...(slot().document as NonNullable<DriverDocumentSlot['document']>),
            status: 'verified',
            status_label: 'Verified',
            compliance_state: 'expired',
            expires_at: '2026-01-01',
            expired: true,
          },
        }),
      ]),
    )

    renderAs(<DriverDocumentsDialog driver={driver()} onClose={() => {}} />, makeUser())

    expect(await screen.findByText('Expired')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^verify$/i })).toBeNull()
    expect(screen.getByRole('button', { name: /^replace$/i })).toBeInTheDocument()
  })
})

/**
 * `MediaPreview` has carried an `actions` slot since the applications queue
 * got one, and its docblock argues the case: *"judging a document and acting
 * on it are the same moment."* This dialog never passed it, so the office
 * reviewing six papers opened one, decided, closed it, found the row again and
 * pressed a button — the five steps that slot exists to remove, on the surface
 * where six documents are actually worked through in one sitting.
 */
describe('deciding without closing the document', () => {
  it('carries the verdicts inside the viewer', async () => {
    get.mockResolvedValue(apiOk([slot()]))

    renderAs(<DriverDocumentsDialog driver={driver()} onClose={() => {}} />, makeUser())

    await userEvent.click(await screen.findByRole('button', { name: /^view$/i }))

    // Two of each now — the row's pair and the viewer's — which is itself the
    // assertion: before this the viewer had none.
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^verify$/i })).toHaveLength(2))
    expect(screen.getAllByRole('button', { name: /^reject$/i })).toHaveLength(2)
  })

  it('records the verdict from the viewer against the document on screen', async () => {
    get.mockResolvedValue(apiOk([slot()]))
    post.mockResolvedValue(apiOk({}))

    renderAs(<DriverDocumentsDialog driver={driver()} onClose={() => {}} />, makeUser())

    await userEvent.click(await screen.findByRole('button', { name: /^view$/i }))

    // Scoped to the viewer's own footer, not "the last Verify in the tree".
    // The loose version passed with the actions prop removed entirely - it was
    // clicking the row's button and asserting the row's request. A test that
    // survives the deletion of the thing it is about is not a test.
    const footer = await waitFor(() => {
      const node = window.document.querySelector('.kr-media__footer')
      if (node === null) throw new Error('the viewer footer never rendered')
      return node as HTMLElement
    })

    await userEvent.click(within(footer).getByRole('button', { name: /^verify$/i }))

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/drivers/3/documents/11/verify', undefined),
    )
  })
})
