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

/**
 * Two endpoints answer through one mock now: the queue, and the documents the
 * decision dialog loads for whichever application was opened.
 *
 * Routed by URL rather than by call order. `mockResolvedValueOnce` chains
 * were the first attempt and they encode *how many times* each screen
 * fetches, so adding a request anywhere silently hands the wrong body to the
 * wrong caller — which is precisely how these tests broke when the documents
 * section arrived.
 */
function answerWith(rows: DriverApplication[], slots: unknown[] = []) {
  get.mockImplementation((url: string) => {
    // The file route before the list route: `/documents/41/file` contains
    // `/documents`, so ordering these the other way hands `MediaPreview` an
    // array of slots where it asked for a blob, and the previewer renders its
    // "could not be loaded" state instead of the document.
    if (url.endsWith('/file')) {
      return Promise.resolve({ data: new Blob(['x'], { type: 'image/jpeg' }) })
    }

    return Promise.resolve(url.includes('/documents') ? apiOk(slots) : listOf(...rows))
  })
}

/** One slot with a file in it, in the shape `DriverDocumentSlot` promises. */
function heldSlot(overrides: Record<string, unknown> = {}) {
  return {
    type: 'driving_licence',
    type_label: 'Driving licence',
    group: 'driver',
    group_label: 'Driver',
    hint: '',
    requires_expiry: true,
    document: {
      id: 41,
      driver_id: null,
      driver_application_id: 7,
      type: 'driving_licence',
      type_label: 'Driving licence',
      status: 'pending',
      status_label: 'Awaiting review',
      compliance_state: 'pending',
      mime_type: 'image/jpeg',
      original_name: 'licence.jpg',
      size_bytes: 1024,
      expires_at: '2029-06-30',
    },
    ...overrides,
  }
}

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
    answerWith([application()])

    renderAs(<DriverApplicationsPage />)

    expect(await screen.findByText('Musa Kiwanuka')).toBeVisible()

    // Mutation check — default the filter to 'all' and this fails.
    expect(get).toHaveBeenCalledWith('/driver-applications', { params: { status: 'pending' } })
  })

  it('shows the phone number, because it is the only way anyone hears back', async () => {
    // ADR-0027 §6 gives an applicant no way to check their own status, so
    // this column is the whole feedback channel.
    answerWith([application()])

    renderAs(<DriverApplicationsPage />)

    expect(await screen.findByText('0772 123 456')).toBeVisible()
  })

  /*
    ADR-0048 section 4's uploads, on the screen where they decide.

    The licence-number field's own hint says "From the licence you checked,
    not the applicant's form" — an instruction the console gave with no way to
    follow it, because nothing here could show the licence. These three cover
    the parts that would silently regress: that the documents are fetched for
    the application actually opened, that an empty slot is named rather than
    hidden, and that a broken documents response does not take Approve and
    Reject down with it.
  */
  it('shows the applicant’s documents on the dialog where they are decided', async () => {
    answerWith([application()], [heldSlot()])

    renderAs(<DriverApplicationsPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))

    expect(await screen.findByRole('button', { name: 'View Driving licence' })).toBeVisible()

    // The application actually opened, not a hardcoded id.
    expect(get).toHaveBeenCalledWith('/driver-applications/7/documents')
  })

  it('names a slot the applicant never sent, rather than hiding it', async () => {
    // "What is missing" is the reviewer's question as much as "what is here".
    // A slot dropped from the list reads as a document that does not exist.
    answerWith([application()], [heldSlot({ document: null })])

    renderAs(<DriverApplicationsPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))

    expect(await screen.findByText('Not sent')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'View Driving licence' })).toBeNull()
  })

  it('keeps the decision possible when the documents cannot be read', async () => {
    /*
      The documents are the secondary content of a dialog whose primary job is
      Approve and Reject. Before the boundary check this threw during render
      and unmounted the whole dialog — so a reviewer who could not see the
      papers also lost the ability to decide, which is worse than the fault
      that caused it.
    */
    get.mockImplementation((url: string) =>
      Promise.resolve(url.includes('/documents') ? apiOk({ not: 'a list' }) : listOf(application())),
    )

    renderAs(<DriverApplicationsPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))

    expect(await screen.findByLabelText(/licence number/i)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Approve and create sign-in' })).toBeVisible()
  })

  /*
    ADR-0057, on the screen. The point of the whole change is that refusing
    one document does not refuse the person, so what these assert is that the
    reviewer can act per-document at all, and that a refusal asks for the
    reason the applicant is going to be emailed.
  */
  it('accepts a single document without leaving the dialog', async () => {
    answerWith([application()], [heldSlot()])
    post.mockResolvedValue(apiOk({}))

    renderAs(<DriverApplicationsPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Accept Driving licence' }))

    expect(post).toHaveBeenCalledWith(
      '/driver-applications/7/documents/41/verify',
      {},
    )

    // Still on the decision dialog. A verdict that closed it would make
    // accepting six documents six round trips through the queue.
    expect(screen.getByLabelText(/licence number/i)).toBeVisible()
  })

  it('asks for a reason before refusing, and sends it', async () => {
    answerWith([application()], [heldSlot()])
    post.mockResolvedValue(apiOk({}))

    renderAs(<DriverApplicationsPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Refuse Driving licence' }))

    // The reviewer is told where the words go, because they are going to a
    // person who has to act on them rather than into a file.
    expect(
      await screen.findByText(/the applicant is emailed this reason/i),
    ).toBeVisible()

    await userEvent.type(screen.getByLabelText(/reason/i), 'The bottom is cut off.')
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }))

    expect(post).toHaveBeenCalledWith('/driver-applications/7/documents/41/reject', {
      reason: 'The bottom is cut off.',
    })
  })

  it('offers no verdict on a document already accepted', async () => {
    // Re-running a verdict rewrites the reviewer and timestamp on the row for
    // a decision nobody made, and invites the reviewer to wonder whether the
    // first one registered.
    answerWith(
      [application()],
      [heldSlot({ document: { ...heldSlot().document, status: 'verified', compliance_state: 'verified' } })],
    )

    renderAs(<DriverApplicationsPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))

    expect(await screen.findByRole('button', { name: 'View Driving licence' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Accept Driving licence' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Refuse Driving licence' })).toBeNull()
  })

  /*
    The verdict where the document is.

    Reported from the console: judging a document and acting on it are one
    moment, and closing the previewer to reach a button put four steps
    between them. The browse arrows are already in that footer, so a reviewer
    can work through all six without it closing once.
  */
  it('accepts from inside the preview, without closing it', async () => {
    answerWith([application()], [heldSlot()])
    post.mockResolvedValue(apiOk({}))

    renderAs(<DriverApplicationsPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))
    await userEvent.click(await screen.findByRole('button', { name: 'View Driving licence' }))

    // The previewer is open — its file metadata is on screen, which the row
    // behind it does not render.
    expect(await screen.findByText('licence.jpg')).toBeVisible()

    // Plain "Accept": inside a dialog titled with the document, the type is
    // the heading. The row's button keeps its longer label, and this exact
    // match would not find it.
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }))

    expect(post).toHaveBeenCalledWith('/driver-applications/7/documents/41/verify', {})
  })

  it('approves with the licence details the applicant could not be trusted for', async () => {
    answerWith([application()])
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
    answerWith([application()])
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
    answerWith([application()])
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
