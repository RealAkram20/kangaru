import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, makeUser, renderAs } from '../test/harness'
import type { Booking } from '../types/booking'
import { BookingsPage } from './BookingsPage'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

// jsdom has no geocoder; the picker's suggestions are stubbed at the module
// boundary so the coordinate path can be exercised (ADR-0020 §2).
vi.mock('./public/places', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./public/places')>()),
  searchPlaces: vi.fn(async () => [
    { name: 'Acacia Mall', detail: 'Kira Road, Kampala', lngLat: [32.5825, 0.3476] },
  ]),
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
    passenger_user_id: null,
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
/**
 * Shanitah's own desk: no tenant, so no colleagues to name.
 *
 * The dialog tests below type a passenger's name, which is what this
 * account does — it books for walk-ins and callers who have no account
 * anywhere (ADR-0012). A client's own staff get the colleague picker
 * instead, and that has its own tests at the end of this file.
 */
const dispatcher = makeUser({ role: 'dispatcher', tenant_id: null, tenant_name: null })

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

  /**
   * ADR-0020 §2. A dispatcher raising a booking by hand used to produce one
   * with no coordinates, so the matcher reported "pickup has no
   * coordinates, so distance was not used" for every staff-created booking.
   */
  it('sends the pick-up coordinates when the dispatcher takes a suggestion', async () => {
    const user = userEvent.setup()
    renderAs(<BookingsPage />, dispatcher)

    await user.click(await screen.findByRole('button', { name: /new booking/i }))
    await user.type(screen.getByLabelText(/^passenger\*/i), 'Peter Ochieng')
    await user.type(screen.getByLabelText(/contact number/i), '+256700111222')
    await user.type(screen.getByLabelText(/pick-up/i), 'Acacia')
    await user.click(await screen.findByRole('button', { name: /Acacia Mall/ }))
    await user.type(screen.getByLabelText(/destination/i), 'Jinja')
    await user.click(screen.getByRole('button', { name: /create booking/i }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))

    const payload = post.mock.calls[0][1] as Record<string, unknown>
    // `lngLat` is [lng, lat]; sending them the wrong way round puts a
    // Kampala pickup off the coast of Ghana with both values still valid.
    expect(payload.origin_latitude).toBe(0.3476)
    expect(payload.origin_longitude).toBe(32.5825)
  })

  it('sends no coordinates when the pick-up was only typed', async () => {
    const user = userEvent.setup()
    renderAs(<BookingsPage />, dispatcher)

    await user.click(await screen.findByRole('button', { name: /new booking/i }))
    await user.type(screen.getByLabelText(/^passenger\*/i), 'Peter Ochieng')
    await user.type(screen.getByLabelText(/contact number/i), '+256700111222')
    await user.type(screen.getByLabelText(/pick-up/i), 'Somewhere the geocoder never saw')
    await user.type(screen.getByLabelText(/destination/i), 'Jinja')
    await user.click(screen.getByRole('button', { name: /create booking/i }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))

    // Free text always stands: a dispatcher on the phone types what the
    // caller says, and the booking is created without a point.
    const payload = post.mock.calls[0][1] as Record<string, unknown>
    expect(payload).not.toHaveProperty('origin_latitude')
    expect(payload.origin).toBe('Somewhere the geocoder never saw')
  })

  it('shows a service-area refusal on the pick-up field, not nowhere', async () => {
    const user = userEvent.setup()
    post.mockRejectedValueOnce(
      apiFailure(422, 'VALIDATION_FAILED', 'The given data was invalid.', {
        origin_latitude: ['That pickup is outside the area we cover.'],
      }),
    )
    renderAs(<BookingsPage />, dispatcher)

    await user.click(await screen.findByRole('button', { name: /new booking/i }))
    await user.type(screen.getByLabelText(/^passenger\*/i), 'Peter Ochieng')
    await user.type(screen.getByLabelText(/contact number/i), '+256700111222')
    await user.type(screen.getByLabelText(/pick-up/i), 'Acacia')
    await user.type(screen.getByLabelText(/destination/i), 'Jinja')
    await user.click(screen.getByRole('button', { name: /create booking/i }))

    // ADR-0021 rejects `origin_latitude`, which has no input of its own.
    // Without re-labelling, the dialog would show nothing at all.
    expect(
      await screen.findByText('That pickup is outside the area we cover.'),
    ).toBeInTheDocument()
  })

  it('sends a booking with no pickup time as an immediate request', async () => {
    const user = userEvent.setup()
    renderAs(<BookingsPage />, dispatcher)

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

    renderAs(<BookingsPage />, dispatcher)

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

    renderAs(<BookingsPage />, dispatcher)

    await user.click(await screen.findByRole('button', { name: /new booking/i }))
    await user.type(screen.getByLabelText(/^passenger\*/i), 'Peter Ochieng')
    await user.click(screen.getByRole('button', { name: /create booking/i }))

    expect(await screen.findByText('This company has reached its credit limit.')).toBeInTheDocument()
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

  /*
   |------------------------------------------------------------------
   | The passenger, when a client raises the booking
   |------------------------------------------------------------------
   |
   | A client's booking is for one of the client's own people. The server
   | is what enforces that — it rejects `passenger_user_id` and takes the
   | passenger's *name* off the account — and these assert the screen's half
   | of it: search rather than a directory-sized dropdown, the id sent, and
   | the number prefilled but still the caller's to correct.
   */

  /** Answers `/colleagues` with a directory, and everything else with the queue. */
  function withColleagues(hits: { id: number; name: string; phone: string | null }[]) {
    get.mockImplementation((url: string) =>
      Promise.resolve(url.startsWith('/colleagues') ? apiOk(hits) : apiOk([booking()])),
    )
  }

  it('names a colleague as the passenger, and sends the account, not the spelling', async () => {
    const user = userEvent.setup()
    withColleagues([{ id: 12, name: 'Joseph Mukasa', phone: '+256700111222' }])

    renderAs(<BookingsPage />)

    await user.click(await screen.findByRole('button', { name: /new booking/i }))
    await user.type(screen.getByLabelText(/^passenger\*/i), 'Jose')

    // Searched server-side and debounced: a bank's directory is thousands
    // of accounts, so this is never a `<select>` holding all of them.
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/colleagues', expect.objectContaining({ params: { q: 'Jose' } })),
    )

    await user.click(await screen.findByRole('button', { name: /Joseph Mukasa/ }))

    // The account's number, prefilled from the record rather than retyped.
    expect(screen.getByLabelText(/contact number/i)).toHaveValue('+256700111222')

    await user.type(screen.getByLabelText(/pick-up/i), 'Nakawa')
    await user.type(screen.getByLabelText(/destination/i), 'Jinja')
    await user.click(screen.getByRole('button', { name: /create booking/i }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(post.mock.calls[0][1]).toMatchObject({
      passenger_user_id: 12,
      passenger_name: 'Joseph Mukasa',
      passenger_phone: '+256700111222',
    })
  })

  it('drops the chosen colleague the moment the name is typed over', async () => {
    const user = userEvent.setup()
    withColleagues([{ id: 12, name: 'Joseph Mukasa', phone: '+256700111222' }])

    renderAs(<BookingsPage />)

    await user.click(await screen.findByRole('button', { name: /new booking/i }))
    await user.type(screen.getByLabelText(/^passenger\*/i), 'Jose')
    await user.click(await screen.findByRole('button', { name: /Joseph Mukasa/ }))

    // The id and the name on screen must never be able to disagree: the
    // whole point of naming an account is that one person is one passenger.
    await user.type(screen.getByLabelText(/^passenger\*/i), ' someone else')
    await user.type(screen.getByLabelText(/pick-up/i), 'Nakawa')
    await user.type(screen.getByLabelText(/destination/i), 'Jinja')
    await user.click(screen.getByRole('button', { name: /create booking/i }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    // Sent without one, and refused by the server — which is the right
    // place for that refusal to come from.
    expect(post.mock.calls[0][1]).not.toHaveProperty('passenger_user_id')
  })

  it('shows the server refusal to name nobody against the passenger field', async () => {
    const user = userEvent.setup()
    withColleagues([])
    post.mockRejectedValue(
      apiFailure(422, 'VALIDATION_FAILED', 'The given data was invalid.', {
        passenger_user_id: ['Choose the colleague who is travelling.'],
      }),
    )

    renderAs(<BookingsPage />)

    await user.click(await screen.findByRole('button', { name: /new booking/i }))
    await user.type(screen.getByLabelText(/^passenger\*/i), 'Nobody In Particular')
    await user.click(screen.getByRole('button', { name: /create booking/i }))

    // Against the field, not as a banner: the error names `passenger_user_id`
    // and there is no input by that name, so untranslated it would render
    // as nothing visibly wrong.
    expect(await screen.findByText('Choose the colleague who is travelling.')).toBeInTheDocument()
  })
})
