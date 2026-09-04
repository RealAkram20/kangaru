import { fireEvent, screen, waitFor, within } from '@testing-library/react'
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

/**
 * The POSTs that *created a booking*, not every POST on the page.
 *
 * Creating one now dispatches it — the panel that tells the desk whether a
 * driver took the job asks the office to place it — so counting every call
 * would count the answer as a second request. This asks the question these
 * tests were always asking: was the booking sent once, and with what.
 */
const creates = () => post.mock.calls.filter((call) => call[0] === '/bookings')

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
    // ADR-0051: required on the wire — `BookingResource` sends it
    // unconditionally, and null is the "no preference" case.
    vehicle_category: null,
    // ADR-0064: every booking names its service; details is null on a ride.
    service_type: 'ride',
    details: null,
    origin: 'Kampala',
    destination: 'Entebbe',
    scheduled_for: null,
    is_immediate: true,
    status: 'pending',
    is_ringing: false,
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
 * Shanitah's own desk.
 *
 * It now gets the colleague picker too — since 24 August `/colleagues`
 * answers a fleet with the staff of the clients it actively serves, so a
 * dispatcher taking a call from a bank can name the employee. Picking stays
 * **optional** for them, which is why the dialog tests below still type a
 * name: this account books walk-ins and callers who have no account anywhere
 * (ADR-0012), and `StoreBookingRequest` requires a named colleague only of a
 * corporate actor.
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

    await waitFor(() => expect(creates()).toHaveLength(1))

    const payload = creates()[0][1] as Record<string, unknown>
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

    await waitFor(() => expect(creates()).toHaveLength(1))

    // Free text always stands: a dispatcher on the phone types what the
    // caller says, and the booking is created without a point.
    const payload = creates()[0][1] as Record<string, unknown>
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

  it('shows the current time and sends an untouched pickup as an immediate request', async () => {
    const user = userEvent.setup()
    renderAs(<BookingsPage />, dispatcher)

    await user.click(await screen.findByRole('button', { name: /new booking/i }))

    // Prefilled with now (owner's ask, 24 Aug) — never an empty box.
    expect(screen.getByLabelText(/pickup time/i)).not.toHaveValue('')

    await user.type(screen.getByLabelText(/^passenger\*/i), 'Peter Ochieng')
    await user.type(screen.getByLabelText(/contact number/i), '+256700111222')
    await user.type(screen.getByLabelText(/pick-up/i), 'Nakawa')
    await user.type(screen.getByLabelText(/destination/i), 'Jinja')

    await user.click(screen.getByRole('button', { name: /create booking/i }))

    await waitFor(() => expect(creates()).toHaveLength(1))

    // `scheduled_for: null` is the contract for "now". The prefill is what
    // the dispatcher *sees*; what is sent for an untouched field is null,
    // because a prefilled clock is stale by submit time and sending it
    // verbatim earns the "must be in the future" refusal it replaced.
    expect(post).toHaveBeenCalledWith('/bookings', {
      // ADR-0064: every payload names its service; the dialog opens on Ride.
      service_type: 'ride',
      passenger_name: 'Peter Ochieng',
      passenger_phone: '+256700111222',
      passenger_count: 1,
      origin: 'Nakawa',
      destination: 'Jinja',
      scheduled_for: null,
      // ADR-0051: sent on every booking, and null is the "no preference"
      // answer rather than an omission.
      vehicle_category: null,
      notes: null,
    })
  })

  it('sends a chosen future pickup time as a schedule', async () => {
    const user = userEvent.setup()
    renderAs(<BookingsPage />, dispatcher)

    await user.click(await screen.findByRole('button', { name: /new booking/i }))
    await user.type(screen.getByLabelText(/^passenger\*/i), 'Peter Ochieng')
    await user.type(screen.getByLabelText(/contact number/i), '+256700111222')
    await user.type(screen.getByLabelText(/pick-up/i), 'Nakawa')
    await user.type(screen.getByLabelText(/destination/i), 'Jinja')
    fireEvent.change(screen.getByLabelText(/pickup time/i), {
      target: { value: '2026-12-24T09:30' },
    })
    await user.click(screen.getByRole('button', { name: /create booking/i }))

    await waitFor(() => expect(creates()).toHaveLength(1))
    expect((creates()[0][1] as Record<string, unknown>).scheduled_for).toBe(
      new Date('2026-12-24T09:30').toISOString(),
    )
  })

  it('reads a pickup re-picked to the current minute as "now", not a stale schedule', async () => {
    const user = userEvent.setup()
    renderAs(<BookingsPage />, dispatcher)

    await user.click(await screen.findByRole('button', { name: /new booking/i }))
    await user.type(screen.getByLabelText(/^passenger\*/i), 'Peter Ochieng')
    await user.type(screen.getByLabelText(/contact number/i), '+256700111222')
    await user.type(screen.getByLabelText(/pick-up/i), 'Nakawa')
    await user.type(screen.getByLabelText(/destination/i), 'Jinja')

    // The dispatcher opens the picker and nudges the shown "now" by a
    // minute. Sending that verbatim is the exact 422 from the field's
    // previous life — by submit, "now" is in the past — so anything within
    // a few minutes of the submit moment travels as null. A minute later
    // rather than the same value, because React drops a change event whose
    // value did not change, and an unedited field is the *other* test.
    const nudged = new Date(Date.now() + 60_000)
    const pad = (part: number) => String(part).padStart(2, '0')
    fireEvent.change(screen.getByLabelText(/pickup time/i), {
      target: {
        value:
          `${nudged.getFullYear()}-${pad(nudged.getMonth() + 1)}-${pad(nudged.getDate())}` +
          `T${pad(nudged.getHours())}:${pad(nudged.getMinutes())}`,
      },
    })
    await user.click(screen.getByRole('button', { name: /create booking/i }))

    await waitFor(() => expect(creates()).toHaveLength(1))
    expect((creates()[0][1] as Record<string, unknown>).scheduled_for).toBeNull()
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

    await waitFor(() => expect(creates()).toHaveLength(1))
    expect(creates()[0][1]).toMatchObject({
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

    await waitFor(() => expect(creates()).toHaveLength(1))
    // Sent without one, and refused by the server — which is the right
    // place for that refusal to come from.
    expect(creates()[0][1]).not.toHaveProperty('passenger_user_id')
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

/**
 * The owner, 24 August: *"the contact should be loaded automatically from the
 * selected passenger"*.
 *
 * It was, and it also **deleted** one. `passenger_phone` was set to
 * `picked?.phone ?? ''` on every pick, and every client account on the
 * platform has a null `phone` — so picking a passenger emptied a box the
 * dispatcher may have filled from the caller thirty seconds earlier. Which is
 * exactly what it looked like from the outside: a prefill that does nothing.
 */
describe('the number that comes with the passenger', () => {
  /*
   * `access_level` spelled out, unlike the `dispatcher` fixture above.
   *
   * `makeUser()` does not set it, so that fixture is level-less and falls to
   * the plain text box - which is why the dialog tests above still exercise
   * the typed-name path and these have to build their own actor. The real
   * `/auth/me` always sends a level; a fixture that omits one is testing an
   * account the server cannot produce.
   */
  const deskWithClients = makeUser({
    role: 'dispatcher',
    tenant_id: null,
    tenant_name: null,
    access_level: 'fleet',
  })

  const colleagues = (...people: { id: number; name: string; phone: string | null }[]) => {
    get.mockImplementation((url: string) =>
      Promise.resolve(url.includes('/colleagues') ? apiOk(people) : apiOk([booking()])),
    )
  }

  const openWithPassenger = async (user: ReturnType<typeof userEvent.setup>, term: string) => {
    renderAs(<BookingsPage />, deskWithClients)
    await user.click(await screen.findByRole('button', { name: /new booking/i }))
    await user.type(screen.getByLabelText(/^passenger\*/i), term)
  }

  it('fills the contact number from the colleague who has one', async () => {
    const user = userEvent.setup()
    colleagues({ id: 9, name: 'Joseph Mukasa', phone: '+256700111222' })

    await openWithPassenger(user, 'Joseph')
    await user.click(await screen.findByRole('button', { name: /Joseph Mukasa/ }))

    expect(screen.getByLabelText(/contact number/i)).toHaveValue('+256700111222')
  })

  it('leaves a number the dispatcher typed when the colleague has none', async () => {
    const user = userEvent.setup()
    colleagues({ id: 9, name: 'Joseph Mukasa', phone: null })

    renderAs(<BookingsPage />, deskWithClients)
    await user.click(await screen.findByRole('button', { name: /new booking/i }))
    // The order that matters: the number comes off the caller first, and the
    // passenger is named afterwards.
    await user.type(screen.getByLabelText(/contact number/i), '+256788999000')
    await user.type(screen.getByLabelText(/^passenger\*/i), 'Joseph')
    await user.click(await screen.findByRole('button', { name: /Joseph Mukasa/ }))

    expect(screen.getByLabelText(/contact number/i)).toHaveValue('+256788999000')
  })

  /**
   * The failure the blanket clear was guarding, and the reason this is a flag
   * rather than "never clear": a number left under the wrong name sends a car
   * out and has the driver ring somebody else, and nothing on the screen looks
   * wrong.
   */
  it("clears a previous colleague's number rather than carrying it to the next", async () => {
    const user = userEvent.setup()
    colleagues(
      { id: 9, name: 'Joseph Mukasa', phone: '+256700111222' },
      { id: 10, name: 'Joseph Okello', phone: null },
    )

    await openWithPassenger(user, 'Joseph')
    await user.click(await screen.findByRole('button', { name: /Joseph Mukasa/ }))
    expect(screen.getByLabelText(/contact number/i)).toHaveValue('+256700111222')

    await user.clear(screen.getByLabelText(/^passenger\*/i))
    await user.type(screen.getByLabelText(/^passenger\*/i), 'Joseph')
    await user.click(await screen.findByRole('button', { name: /Joseph Okello/ }))

    expect(screen.getByLabelText(/contact number/i)).toHaveValue('')
  })
})

/**
 * ADR-0064: the internal channel carries the same three services as the
 * public order page — and a fleet's desk books **for a corporate client**,
 * named first, because the booking lands on that client's account.
 */
describe('three services on a booking', () => {
  const fleetDesk = makeUser({
    role: 'dispatcher',
    tenant_id: null,
    tenant_name: null,
    access_level: 'fleet',
  })

  it('offers the three services side by side, and opens on Ride', async () => {
    const user = userEvent.setup()
    renderAs(<BookingsPage />, dispatcher)

    await user.click(await screen.findByRole('button', { name: /new booking/i }))

    // Visible as three options rather than folded into a dropdown: a
    // dispatcher on a call should see delivery and self-drive exist.
    expect(screen.getByRole('radio', { name: /ride/i })).toBeChecked()
    expect(screen.getByRole('radio', { name: /delivery/i })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /self-drive/i })).not.toBeChecked()
  })

  it('sends a delivery with its parcel details, and no passenger count', async () => {
    const user = userEvent.setup()
    renderAs(<BookingsPage />, dispatcher)

    await user.click(await screen.findByRole('button', { name: /new booking/i }))
    await user.click(screen.getByRole('radio', { name: /delivery/i }))

    // The person the desk rings is the sender now, not a passenger.
    await user.type(screen.getByLabelText(/^sender\*/i), 'Peter Ochieng')
    await user.type(screen.getByLabelText(/contact number/i), '+256700111222')
    await user.type(screen.getByLabelText(/pick-up/i), 'Nakawa')
    await user.type(screen.getByLabelText(/deliver to/i), 'Jinja')
    await user.type(screen.getByLabelText(/^recipient\*/i), 'Amina Okello')
    await user.type(screen.getByLabelText(/recipient number/i), '+256701222333')
    await user.click(screen.getByLabelText(/confirm handover with a pin/i))
    await user.click(screen.getByRole('button', { name: /create booking/i }))

    await waitFor(() => expect(creates()).toHaveLength(1))

    const payload = creates()[0][1] as Record<string, unknown>
    expect(payload).toMatchObject({
      service_type: 'delivery',
      origin: 'Nakawa',
      destination: 'Jinja',
      details: {
        recipient_name: 'Amina Okello',
        recipient_phone: '+256701222333',
        confirm_with_pin: true,
      },
    })
    // Seats are a ride's question; a count on a parcel would invent a
    // passenger nobody booked.
    expect(payload).not.toHaveProperty('passenger_count')
  })

  it('books a rental with a hire period and no route at all', async () => {
    const user = userEvent.setup()
    renderAs(<BookingsPage />, dispatcher)

    await user.click(await screen.findByRole('button', { name: /new booking/i }))
    await user.click(screen.getByRole('radio', { name: /self-drive/i }))

    // No route and no pickup time: the renter collects the vehicle, and the
    // rental's clock is the hire period.
    expect(screen.queryByLabelText(/pick-up/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/pickup time/i)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/^renter\*/i), 'Peter Ochieng')
    await user.type(screen.getByLabelText(/contact number/i), '+256700111222')
    fireEvent.change(screen.getByLabelText(/^from\*/i), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText(/^to\*/i), { target: { value: '2026-09-05' } })
    await user.type(screen.getByLabelText(/identity documents/i), 'National ID')
    await user.click(screen.getByRole('button', { name: /create booking/i }))

    await waitFor(() => expect(creates()).toHaveLength(1))

    const payload = creates()[0][1] as Record<string, unknown>
    expect(payload).toMatchObject({
      service_type: 'self_drive',
      details: { start_date: '2026-09-01', end_date: '2026-09-05', kyc_documents: 'National ID' },
    })
    expect(payload).not.toHaveProperty('origin')
    expect(payload).not.toHaveProperty('scheduled_for')
  })

  it('requires the fleet desk to name the client, and sends the choice', async () => {
    const user = userEvent.setup()
    get.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/colleagues')
          ? apiOk([])
          : apiOk([booking()], {
              scope: 'platform',
              // The filter list names more clients than the dialog offers:
              // the picker reads `bookable_clients` — active contracts only
              // — so Ended Ltd must never appear as an option.
              filters: {
                clients: [
                  { value: 7, label: 'Centenary Bank' },
                  { value: 9, label: 'Ended Ltd' },
                ],
              },
              bookable_clients: [{ value: 7, label: 'Centenary Bank' }],
            }),
      ),
    )

    renderAs(<BookingsPage />, fleetDesk)

    await user.click(await screen.findByRole('button', { name: /new booking/i }))

    // Only the served client is offered — the ended one is in the filter
    // list and must not be an answer here.
    const picker = screen.getByLabelText(/^client\*/i)
    expect(within(picker).queryByRole('option', { name: 'Ended Ltd' })).not.toBeInTheDocument()

    await user.selectOptions(picker, '7')
    await user.type(screen.getByLabelText(/^passenger\*/i), 'A Caller')
    await user.type(screen.getByLabelText(/contact number/i), '+256700111222')
    await user.type(screen.getByLabelText(/pick-up/i), 'Nakawa')
    await user.type(screen.getByLabelText(/destination/i), 'Jinja')
    await user.click(screen.getByRole('button', { name: /create booking/i }))

    await waitFor(() => expect(creates()).toHaveLength(1))
    expect(creates()[0][1]).toMatchObject({ tenant_id: 7 })
  })

  it('shows the hire period where a rental has no route to show', async () => {
    get.mockResolvedValue(
      apiOk([
        booking({
          service_type: 'self_drive',
          origin: null,
          destination: null,
          details: { start_date: '2026-09-01', end_date: '2026-09-05' },
        }),
      ]),
    )

    renderAs(<BookingsPage />)

    expect(await screen.findByText('2026-09-01 → 2026-09-05')).toBeInTheDocument()
    expect(screen.getByText('Self-drive')).toBeInTheDocument()
  })
})

/**
 * What became of the booking that was just raised.
 *
 * The owner's report was *"nothing happens next after clicking create
 * booking… still the order did not reach the driver"*, and both halves were
 * true: the booking was created and then stopped, silently, at gates the
 * screen never mentioned. These assertions are that it now says which gate.
 */
describe('BookingsPage — what became of the booking', () => {
  const answers = (dispatch: () => Promise<unknown>) => {
    post.mockImplementation((url: string) =>
      (url === '/bookings' ? Promise.resolve(apiOk(booking({ id: 77 }))) : dispatch()) as never,
    )
  }

  const create = async () => {
    const user = userEvent.setup()
    renderAs(<BookingsPage />, dispatcher)

    await user.click(await screen.findByRole('button', { name: /new booking/i }))
    await user.type(screen.getByLabelText(/^passenger\*/i), 'Peter Ochieng')
    await user.type(screen.getByLabelText(/contact number/i), '+256700111222')
    await user.type(screen.getByLabelText(/pick-up/i), 'Nakawa')
    await user.type(screen.getByLabelText(/destination/i), 'Jinja')
    await user.click(screen.getByRole('button', { name: /create booking/i }))
  }

  const trip = {
    id: 501,
    status: 'assigned',
    driver: { id: 3, name: 'Ada Nakato' },
    vehicle: { id: 11, registration_number: 'UDD 005D' },
  }

  it('asks the office to place the booking exactly once', async () => {
    answers(() => Promise.resolve(apiOk(trip)))

    await create()

    await waitFor(() =>
      expect(post.mock.calls.filter((call) => call[0] === '/bookings/77/auto-assignment')).toHaveLength(1),
    )

    // Dispatching is not idempotent: a second auto-assignment is a second
    // offer, to a second driver, for one job. The harness renders under
    // StrictMode — which is exactly the double mount a browser does in
    // development — so an unguarded effect sends it twice here.
    await screen.findByText(/UDD 005D/)
    expect(post.mock.calls.filter((call) => call[0] === '/bookings/77/auto-assignment')).toHaveLength(1)
  })

  it('says the driver has it and has not answered yet', async () => {
    answers(() => Promise.resolve(apiOk(trip)))

    await create()

    // `assigned` is the office putting the job on somebody's name and
    // nothing more. Reading it as "accepted" is what made a job nobody took
    // look exactly like one already being driven.
    expect(await screen.findByText(/waiting for ada nakato to accept trip #501/i)).toBeVisible()
  })

  it("shows the office's own refusal rather than a silence", async () => {
    answers(() =>
      Promise.reject(
        apiFailure(422, 'NO_VEHICLE_AVAILABLE', 'No contracted vehicle is free for this client.'),
      ),
    )

    await create()

    // Verbatim. Automatic dispatch commits a *contracted* vehicle or
    // nothing, so this is an ordinary outcome — and rewriting it here would
    // be a second vocabulary for one refusal.
    expect(
      await screen.findByText(/no contracted vehicle is free for this client/i),
    ).toBeVisible()
  })
})
