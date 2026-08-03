import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, makeUser, renderAs } from '../test/harness'
import type { Booking } from '../types/booking'
import { BookingsPage } from './BookingsPage'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 41,
    tenant_id: 1,
    requested_by_user_id: 9,
    requested_by: { id: 9, name: 'Moses Kato', email: 'moses@x.test', role: 'corporate_admin' },
    passenger_name: 'Grace Amongin',
    passenger_phone: '+256700000000',
    passenger_count: 2,
    origin: 'Kampala',
    destination: 'Entebbe',
    scheduled_for: null,
    is_immediate: true,
    status: 'pending',
    approved_by_user_id: null,
    approved_at: null,
    decision_reason: null,
    notes: null,
    created_at: '2026-07-20T08:00:00.000000Z',
    updated_at: '2026-07-20T08:00:00.000000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  get.mockResolvedValue(apiOk([booking()]))
  post.mockResolvedValue(apiOk({}))
})

/**
 * The booking form — one of the two flows AGENTS.md names by hand for
 * component tests ("critical flows (booking form, dispatch board)").
 *
 * These assert what a user can see and do, not how the component stores it.
 * A test that reached for internal state would keep passing through a
 * rewrite that broke the screen, which is the opposite of the point.
 */
describe('BookingsPage', () => {
  it('lists the bookings it loaded', async () => {
    renderAs(<BookingsPage />)

    expect(await screen.findByText('Kampala → Entebbe')).toBeInTheDocument()
    expect(screen.getByText('Grace Amongin')).toBeInTheDocument()
  })

  it('says so when bookings cannot be loaded, rather than showing an empty list', async () => {
    get.mockRejectedValue(apiFailure(500, 'SERVER_ERROR', 'The bookings service is unavailable.'))

    renderAs(<BookingsPage />)

    // An empty table and a failed request look identical to a user, and one
    // of them means "you have no bookings" — which would be a lie.
    expect(await screen.findByText('Bookings unavailable')).toBeInTheDocument()
    expect(screen.getByText('The bookings service is unavailable.')).toBeInTheDocument()
  })

  it('sends a booking with no pickup time as an immediate request', async () => {
    const user = userEvent.setup()
    renderAs(<BookingsPage />)

    await user.click(await screen.findByRole('button', { name: /new booking/i }))

    await user.type(screen.getByLabelText(/^passenger\*/i), 'Peter Ochieng')
    await user.type(screen.getByLabelText(/contact number/i), '+256700111222')
    await user.type(screen.getByLabelText(/pick-up/i), 'Nakawa')
    await user.type(screen.getByLabelText(/destination/i), 'Jinja')

    await user.click(screen.getByRole('button', { name: /create booking/i }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))

    // `scheduled_for: null` is the contract for "now" — the backend reads a
    // missing value as immediate, and sending "" would be a 422.
    expect(post).toHaveBeenCalledWith('/bookings', {
      passenger_name: 'Peter Ochieng',
      passenger_phone: '+256700111222',
      passenger_count: 1,
      origin: 'Nakawa',
      destination: 'Jinja',
      scheduled_for: null,
      notes: null,
    })
  })

  it('puts a validation error against the field it belongs to', async () => {
    const user = userEvent.setup()
    post.mockRejectedValue(
      apiFailure(422, 'VALIDATION_FAILED', 'The given data was invalid.', {
        passenger_phone: ['The contact number must be a valid Ugandan number.'],
      }),
    )

    renderAs(<BookingsPage />)

    await user.click(await screen.findByRole('button', { name: /new booking/i }))
    await user.type(screen.getByLabelText(/^passenger\*/i), 'Peter Ochieng')
    await user.type(screen.getByLabelText(/contact number/i), '07')
    await user.type(screen.getByLabelText(/pick-up/i), 'Nakawa')
    await user.type(screen.getByLabelText(/destination/i), 'Jinja')
    await user.click(screen.getByRole('button', { name: /create booking/i }))

    // Beside the input, not as a banner at the top of the dialog: a form
    // that reports "something was invalid" without saying which field is a
    // form the user has to guess at.
    expect(
      await screen.findByText('The contact number must be a valid Ugandan number.'),
    ).toBeInTheDocument()

    // And the dialog stays open, with what they typed still in it.
    expect(screen.getByLabelText(/pick-up/i)).toHaveValue('Nakawa')
  })

  it('keeps the dialog open and shows the server message when creation fails without field errors', async () => {
    const user = userEvent.setup()
    post.mockRejectedValue(
      apiFailure(409, 'CREDIT_LIMIT_EXCEEDED', 'This company has reached its credit limit.'),
    )

    renderAs(<BookingsPage />)

    await user.click(await screen.findByRole('button', { name: /new booking/i }))
    await user.type(screen.getByLabelText(/^passenger\*/i), 'Peter Ochieng')
    await user.click(screen.getByRole('button', { name: /create booking/i }))

    expect(await screen.findByText('This company has reached its credit limit.')).toBeInTheDocument()
  })

  it('narrows by pickup date on the server, not the page in hand', async () => {
    renderAs(<BookingsPage />)
    await screen.findByText('Kampala → Entebbe')

    // fireEvent rather than user.type: a date input takes a whole value
    // per change, which is also why the page does not debounce it.
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-08-01' } })
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-08-31' } })

    await waitFor(() => {
      const urls = get.mock.calls.map(([url]) => url as string)
      expect(
        urls.some((url) => url.includes('from=2026-08-01') && url.includes('to=2026-08-31')),
      ).toBe(true)
    })
  })

  it('approves a pending booking and reloads the list', async () => {
    const user = userEvent.setup()
    renderAs(<BookingsPage />)

    await screen.findByText('Kampala → Entebbe')
    // Counted from here rather than asserted as a total: the harness
    // renders in StrictMode like the app does, so mounting fetches twice
    // in development. What matters is that approving triggers another
    // fetch, not how many the mount happened to make.
    const before = get.mock.calls.length

    await user.click(screen.getByRole('button', { name: /^approve$/i }))

    await waitFor(() => expect(post).toHaveBeenCalledWith('/bookings/41/approval'))
    // Reloaded rather than patched in place: the decision may have changed
    // more than the row the client can see.
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(before))
  })

  it('surfaces the server\'s refusal when an approval is rejected', async () => {
    const user = userEvent.setup()
    post.mockRejectedValue(
      apiFailure(409, 'INVALID_BOOKING_TRANSITION', 'This booking has already been decided.'),
    )

    renderAs(<BookingsPage />)

    await user.click(await screen.findByRole('button', { name: /^approve$/i }))

    // Shown verbatim. The backend writes these for a human (AGENTS.md Error
    // Handling); re-wording in the client is how the two drift apart.
    expect(await screen.findByText('This booking has already been decided.')).toBeInTheDocument()
  })

  it('will not let a booking be rejected without a reason', async () => {
    const user = userEvent.setup()
    renderAs(<BookingsPage />)

    await user.click(await screen.findByRole('button', { name: /^reject$/i }))

    const dialog = screen.getByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: /reject booking/i })

    // The reason is recorded against the booking and shown to the requester,
    // so an empty one is a refusal nobody can explain later.
    expect(confirm).toBeDisabled()

    await user.type(within(dialog).getByLabelText(/reason/i), 'No vehicle available.')
    expect(confirm).toBeEnabled()

    await user.click(confirm)
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/bookings/41/rejection', { reason: 'No vehicle available.' }),
    )
  })

  it('hides approve and reject from a role that cannot use them', async () => {
    renderAs(<BookingsPage />, makeUser({ role: 'corporate_employee' }))

    await screen.findByText('Kampala → Entebbe')

    // Convenience, not authorization — the server answers 403 regardless
    // (AGENTS.md: never rely solely on frontend permissions). Cancel stays,
    // because a requester may withdraw their own request.
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^reject$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument()
  })

  it('offers no decision buttons on a booking that is no longer pending', async () => {
    get.mockResolvedValue(apiOk([booking({ status: 'assigned' })]))

    renderAs(<BookingsPage />)

    await screen.findByText('Kampala → Entebbe')

    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument()
  })

  it('asks the server for the search rather than sifting the page it holds', async () => {
    const user = userEvent.setup()

    const gulu = booking({ id: 42, origin: 'Gulu', destination: 'Lira', passenger_name: 'Sam Etyang' })

    // The server does the matching now. In-browser filtering searched the
    // 25 rows in hand and reported the rest of the queue as "no match",
    // which is a wrong answer rather than a slow one.
    get.mockImplementation((url: string) =>
      Promise.resolve(url.includes('q=gulu') ? apiOk([gulu]) : apiOk([booking(), gulu])),
    )

    renderAs(<BookingsPage />)

    await screen.findByText('Kampala → Entebbe')

    await user.type(screen.getByPlaceholderText(/filter by route/i), 'gulu')

    await waitFor(() => expect(get).toHaveBeenCalledWith('/bookings?q=gulu'))

    expect(await screen.findByText('Gulu → Lira')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Kampala → Entebbe')).not.toBeInTheDocument())
  })
})
