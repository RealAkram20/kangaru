import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, renderAs } from '../test/harness'
import { SupportRequestsPage } from './SupportRequestsPage'
import type { SupportRequest } from '../types/supportRequest'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)

function report(overrides: Partial<SupportRequest> = {}): SupportRequest {
  return {
    id: 12,
    driver_id: 3,
    driver_name: 'Musa Kiwanuka',
    topic: 'passenger',
    topic_label: 'Passenger issue',
    status: 'open',
    status_label: 'Waiting for the office',
    trip_id: null,
    body: 'The passenger refused to pay at Ntinda and left the vehicle.',
    answer: null,
    answered_by: null,
    answered_at: null,
    created_at: '2026-08-17T09:00:00.000000Z',
    ...overrides,
  }
}

const listOf = (...rows: SupportRequest[]) => apiOk(rows)

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * ADR-0044's consequence, on a screen — and the same one ADR-0027 records one
 * population over: a report nobody reads is worse than no form at all, because
 * the driver believes they have told somebody.
 *
 * So the first thing asserted is that the queue opens on the reports still
 * owed an answer, and the last is that there is no way to close one without
 * writing it.
 */
it('opens on the reports still waiting for an answer', async () => {
  get.mockResolvedValue(listOf(report()))

  renderAs(<SupportRequestsPage />)

  await waitFor(() =>
    expect(get).toHaveBeenCalledWith('/support-requests', { params: { status: 'open' } }),
  )
  expect(await screen.findByText('Musa Kiwanuka')).toBeInTheDocument()
  expect(screen.getByText('1 waiting for an answer')).toBeInTheDocument()
})

it('narrows to one topic, because different desks answer different things', async () => {
  get.mockResolvedValue(listOf(report()))

  renderAs(<SupportRequestsPage />)
  await screen.findByText('Musa Kiwanuka')

  await userEvent.selectOptions(screen.getByDisplayValue('Every topic'), 'payment')

  await waitFor(() =>
    expect(get).toHaveBeenCalledWith('/support-requests', {
      params: { status: 'open', topic: 'payment' },
    }),
  )
})

it('shows the driver whole account before asking for a reply', async () => {
  const long =
    'The passenger got in at Kampala Road and became abusive.\n\nHe left at Ntinda without paying.'

  get.mockResolvedValue(listOf(report({ body: long })))

  renderAs(<SupportRequestsPage />)
  await userEvent.click(await screen.findByRole('button', { name: 'Answer' }))

  /*
    Whole and unabridged **in the dialog** — the table clips to one line, and a
    decision must never be made from the clipped copy. Scoped with `within`
    because both are on screen at once, which is exactly the pair worth
    distinguishing: `getByText` unscoped matches the truncated cell too and
    would pass on the version this asserts against.

    One paragraph, matched by `toHaveTextContent`, because `pre-wrap` keeps the
    driver's own line breaks inside a single node.
  */
  const dialog = within(screen.getByRole('dialog'))

  expect(dialog.getByText(/became abusive/)).toHaveTextContent('He left at Ntinda without paying.')
})

it('sends the answer, and says it goes to the driver', async () => {
  get.mockResolvedValue(listOf(report()))
  post.mockResolvedValue(apiOk(report({ status: 'answered', answer: 'Sorted.' })))

  renderAs(<SupportRequestsPage />)
  await userEvent.click(await screen.findByRole('button', { name: 'Answer' }))

  // The clerk is told what the box does before they type in it: this is the
  // only thing about the report that reaches the driver.
  expect(
    screen.getByText(
      'What you write is sent to the driver as a notification and appears in their app. Nothing else about this report reaches them, so say what they need to know.',
    ),
  ).toBeInTheDocument()

  await userEvent.type(
    screen.getByLabelText('Your answer'),
    'We have spoken to the passenger and credited your fare.',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Send answer' }))

  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/support-requests/12/answer', {
      answer: 'We have spoken to the passenger and credited your fare.',
    }),
  )
})

it('will not send an empty answer', async () => {
  get.mockResolvedValue(listOf(report()))

  renderAs(<SupportRequestsPage />)
  await userEvent.click(await screen.findByRole('button', { name: 'Answer' }))

  // There is no closing without an answer (ADR-0044 §2), so an empty one must
  // not be a way to do it by another route.
  expect(screen.getByRole('button', { name: 'Send answer' })).toBeDisabled()

  await userEvent.type(screen.getByLabelText('Your answer'), 'ok')
  expect(screen.getByRole('button', { name: 'Send answer' })).toBeDisabled()
})

it('offers no way to close a report without answering it', async () => {
  get.mockResolvedValue(listOf(report()))

  renderAs(<SupportRequestsPage />)
  await screen.findByText('Musa Kiwanuka')

  // The endpoint does not exist and the page must not imply it does. An office
  // that can dismiss a report in silence is the failure this feature ends.
  expect(screen.queryByRole('button', { name: /close|dismiss|ignore/i })).not.toBeInTheDocument()
})

it('reads an answered report back rather than offering to answer it twice', async () => {
  get.mockResolvedValue(
    listOf(
      report({
        status: 'answered',
        status_label: 'Answered',
        answer: 'We credited the fare to your wallet.',
        answered_by: 'Sarah at the office',
        answered_at: '2026-08-17T11:00:00.000000Z',
      }),
    ),
  )

  renderAs(<SupportRequestsPage />)
  await userEvent.click(await screen.findByRole('button', { name: 'Read' }))

  expect(screen.getByText('We credited the fare to your wallet.')).toBeInTheDocument()
  // Named to the office — accountability for who said what is the point of
  // `Auditable` on this model. The driver is never shown this.
  expect(screen.getByText(/Sarah at the office/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Send answer' })).not.toBeInTheDocument()
})

it('says the queue is empty rather than looking broken', async () => {
  get.mockResolvedValue(listOf())

  renderAs(<SupportRequestsPage />)

  expect(
    await screen.findByText('Nothing waiting — every driver report has an answer.'),
  ).toBeInTheDocument()
})

it('reports a failed load instead of showing an empty queue', async () => {
  get.mockRejectedValue(apiFailure(500, 'SERVER_ERROR', 'boom'))

  renderAs(<SupportRequestsPage />)

  // An empty queue and an unreachable one must never look the same: one means
  // every driver has an answer, the other means nobody knows.
  expect(await screen.findByText('Could not load driver reports.')).toBeInTheDocument()
})
