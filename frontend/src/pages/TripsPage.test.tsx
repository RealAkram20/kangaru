import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, makeUser, renderAs } from '../test/harness'
import { formatTimestamp } from '../lib/format'
import type { Trip, TripEvent } from '../types/trip'
import { TripsPage } from './TripsPage'

const STARTED_AT = '2026-07-21T08:14:22.000000Z'
const COMPLETED_AT = '2026-07-21T09:20:22.000000Z'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 41,
    tenant_id: 1,
    vehicle_id: 7,
    vehicle: { id: 7, registration_number: 'UAA 123A' } as Trip['vehicle'],
    driver_id: 3,
    driver: { id: 3, name: 'Moses Kato' } as Trip['driver'],
    origin: 'Kampala',
    destination: 'Entebbe',
    status: 'trip_completed',
    allowed_transitions: ['invoice_generated', 'disputed'],
    odometer_start: 41200,
    odometer_start_photo_path: 'tenants/1/odo/start.jpg',
    odometer_end: 41242,
    odometer_end_photo_path: 'tenants/1/odo/end.jpg',
    distance_km: '42.00',
    gps_distance_km: '41.80',
    distance_variance_flagged: false,
    cancellation_charge_applicable: null,
    started_at: STARTED_AT,
    completed_at: COMPLETED_AT,
    duration_minutes: 66,
    created_at: '2026-07-21T08:00:00.000000Z',
    updated_at: '2026-07-21T09:20:22.000000Z',
    ...overrides,
  }
}

function event(overrides: Partial<TripEvent> = {}): TripEvent {
  return {
    id: 1,
    trip_id: 41,
    from_status: 'passenger_onboard',
    to_status: 'trip_started',
    user_id: 3,
    user: { id: 3, name: 'Moses Kato', role: 'driver' },
    notes: null,
    // Deliberately not STARTED_AT: the panel shows the trip's commencement
    // time as a fact *and* the timeline entry's own time, and identical
    // values would make an assertion on either one ambiguous.
    created_at: '2026-07-21T08:15:00.000000Z',
    ...overrides,
  }
}

/** `/trips` for the list, `/trips/{id}/events` for the timeline. */
function board(trips: Trip[], events: TripEvent[] = [event()]) {
  get.mockImplementation((url: string) =>
    Promise.resolve(
      url.includes('/events') ? apiOk(events) : apiOk(trips, { cursor: { next: null } }),
    ),
  )
}

/**
 * Rows are found by registration plate rather than by route: the Route cell
 * renders origin, an arrow icon and destination inside one span, so no
 * element has the text "Kampala" on its own.
 */
async function openTrip(user: ReturnType<typeof userEvent.setup>, plate = 'UAA 123A') {
  const cell = await screen.findByText(plate)
  await user.click(cell.closest('tr') as HTMLElement)

  return screen.getByText(/Trip #\d+/).closest('section') as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  board([trip()])
})

describe('TripsPage', () => {
  /**
   * Centenary Bank's letter (CRDB/CS/F/26) requires six data points on
   * every trip, and PROJECT.md makes them the Phase 1 acceptance criteria.
   * This is the test that says they reach the screen.
   */
  it('shows all six of the Bank-required data points', async () => {
    const user = userEvent.setup()
    renderAs(<TripsPage />, makeUser({ role: 'finance' }))

    const panel = await openTrip(user)

    // 1. commencement and completion date/time.
    //
    // Asserted through formatTimestamp rather than as a literal:
    // it renders in *local* time, so "2026-07-21 08:14:22" would pass in
    // CI (UTC) and fail on a developer machine in Kampala, or the reverse.
    // What matters here is that the two timestamps reach the screen.
    expect(within(panel).getByText(formatTimestamp(STARTED_AT))).toBeInTheDocument()
    expect(within(panel).getByText(formatTimestamp(COMPLETED_AT))).toBeInTheDocument()
    // 2. vehicle registration details
    expect(within(panel).getByText(/UAA 123A/)).toBeInTheDocument()
    // 3. trip origin and destination
    expect(within(panel).getByText(/Kampala → Entebbe/)).toBeInTheDocument()
    // 4. opening and closing odometer readings
    expect(within(panel).getByText('41,200')).toBeInTheDocument()
    expect(within(panel).getByText('41,242')).toBeInTheDocument()
    // 5. total distance travelled
    expect(within(panel).getByText('42.0 km')).toBeInTheDocument()
    // 6. duration in hours/minutes
    expect(within(panel).getByText('1h 6m')).toBeInTheDocument()
  })

  /**
   * `allowed_transitions` is served by the API precisely so no copy of the
   * lifecycle graph lives in this client. A button that exists because the
   * server said so cannot drift from the server.
   */
  it('builds its actions from what the server said the state allows', async () => {
    const user = userEvent.setup()
    board([
      trip({
        status: 'driver_arrived',
        allowed_transitions: ['passenger_onboard', 'no_show', 'cancelled'],
      }),
    ])

    renderAs(<TripsPage />, makeUser({ role: 'dispatcher' }))

    const panel = await openTrip(user)

    expect(within(panel).getByRole('button', { name: /passenger onboard/i })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /no show/i })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /cancelled/i })).toBeInTheDocument()
    // Nothing the server did not list.
    expect(within(panel).queryByRole('button', { name: /trip completed/i })).toBeNull()
  })

  /**
   * `invoice_generated` is a legal next state that the transitions endpoint
   * refuses outright — Modules\Billing applies it inside the transaction
   * that issues the invoice. A button for it would always 422.
   */
  it('never offers Invoice generated as a transition, even though the server lists it', async () => {
    const user = userEvent.setup()
    // The fixture's allowed_transitions contains it, exactly as the API sends.
    renderAs(<TripsPage />, makeUser({ role: 'finance' }))

    const panel = await openTrip(user)

    expect(within(panel).queryByRole('button', { name: /^invoice generated$/i })).toBeNull()
    // The real route to an invoice is its own action.
    expect(within(panel).getByRole('button', { name: /generate invoice/i })).toBeInTheDocument()
  })

  it('offers no Generate invoice to a role that cannot bill', async () => {
    const user = userEvent.setup()
    renderAs(<TripsPage />, makeUser({ role: 'dispatcher' }))

    const panel = await openTrip(user)

    expect(within(panel).queryByRole('button', { name: /generate invoice/i })).toBeNull()
  })

  it('offers no Generate invoice on a trip that is not completed', async () => {
    const user = userEvent.setup()
    board([trip({ status: 'passenger_onboard', allowed_transitions: ['trip_started'] })])

    renderAs(<TripsPage />, makeUser({ role: 'finance' }))

    const panel = await openTrip(user)

    expect(within(panel).queryByRole('button', { name: /generate invoice/i })).toBeNull()
  })

  it('renders the append-only timeline, naming the actor or the system', async () => {
    const user = userEvent.setup()
    board(
      [trip()],
      [
        event(),
        event({
          id: 2,
          from_status: 'trip_started',
          to_status: 'trip_completed',
          user_id: null,
          user: undefined,
          notes: 'Arrived early.',
        }),
      ],
    )

    renderAs(<TripsPage />, makeUser({ role: 'finance' }))

    const panel = await openTrip(user)

    expect(await within(panel).findByText('Moses Kato')).toBeInTheDocument()
    // A transition with no actor is the system's, and says so rather than
    // leaving a blank where a name should be.
    expect(within(panel).getByText('System')).toBeInTheDocument()
    expect(within(panel).getByText(/Arrived early\./)).toBeInTheDocument()
  })

  it('shows a dash for facts a trip does not have yet, rather than a zero', async () => {
    const user = userEvent.setup()
    board([
      trip({
        status: 'assigned',
        allowed_transitions: ['accepted', 'cancelled'],
        odometer_start: null,
        odometer_end: null,
        distance_km: null,
        duration_minutes: null,
        started_at: null,
        completed_at: null,
      }),
    ])

    renderAs(<TripsPage />, makeUser({ role: 'dispatcher' }))

    const panel = await openTrip(user)

    // A trip that has not started has no distance. "0 km" would be a
    // measurement nobody took.
    expect(within(panel).getAllByText('—').length).toBeGreaterThanOrEqual(6)
  })

  it('asks the server for the search rather than sifting the page it holds', async () => {
    const user = userEvent.setup()

    const other = trip({
      id: 42,
      origin: 'Gulu',
      destination: 'Lira',
      vehicle: { id: 9, registration_number: 'UBB 456B' } as Trip['vehicle'],
    })

    // The server answers the search; the page renders what it gets back.
    // This used to filter in the browser, which meant a trip list longer
    // than one page reported everything past row 25 as "no match".
    get.mockImplementation((url: string) => {
      if (url.includes('/events')) return Promise.resolve(apiOk([event()]))
      if (url.includes('q=UBB')) return Promise.resolve(apiOk([other], { cursor: { next: null } }))

      return Promise.resolve(apiOk([trip(), other], { cursor: { next: null } }))
    })

    renderAs(<TripsPage />, makeUser({ role: 'dispatcher' }))

    await screen.findByText('UAA 123A')

    await user.type(
      screen.getByPlaceholderText(/filter by route, vehicle, driver or status/i),
      'UBB',
    )

    // Debounced, so this settles a moment after the last keystroke rather
    // than firing one request per character.
    await waitFor(() => expect(get).toHaveBeenCalledWith('/trips?q=UBB'))

    expect(await screen.findByText('UBB 456B')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('UAA 123A')).toBeNull())
  })

  it('sends one request for a burst of typing, not one per keystroke', async () => {
    const user = userEvent.setup()
    board([trip()])

    renderAs(<TripsPage />, makeUser({ role: 'dispatcher' }))

    await screen.findByText('UAA 123A')
    get.mockClear()

    await user.type(screen.getByPlaceholderText(/filter by route/i), 'Entebbe')

    await waitFor(() => expect(get).toHaveBeenCalledWith('/trips?q=Entebbe'))

    // Seven characters, one request. Without the debounce each keystroke
    // is a query and their answers can arrive out of order, leaving the
    // rows for "E" on screen after the ones for "Entebbe".
    const searches = get.mock.calls.filter(([url]) => String(url).includes('q='))
    expect(searches).toHaveLength(1)
  })

  it('says the board is empty when it is', async () => {
    board([])

    renderAs(<TripsPage />, makeUser({ role: 'dispatcher' }))

    expect(await screen.findByText('No trips yet')).toBeInTheDocument()
  })

  it('says the filter matched nothing, rather than that there are no trips', async () => {
    const user = userEvent.setup()

    get.mockImplementation((url: string) => {
      if (url.includes('/events')) return Promise.resolve(apiOk([event()]))
      if (url.includes('q=')) return Promise.resolve(apiOk([], { cursor: { next: null } }))

      return Promise.resolve(apiOk([trip()], { cursor: { next: null } }))
    })

    renderAs(<TripsPage />, makeUser({ role: 'dispatcher' }))

    await screen.findByText('UAA 123A')
    await user.type(screen.getByPlaceholderText(/filter by route/i), 'zzz')

    // An empty result from a search is a different thing from an empty
    // list, and saying "No trips yet" to somebody who has just searched
    // reads as data loss.
    expect(await screen.findByText('No trips match your filter')).toBeInTheDocument()
    expect(screen.queryByText('No trips yet')).toBeNull()
  })

  it('says so when trips cannot be loaded', async () => {
    get.mockRejectedValue(apiFailure(500, 'SERVER_ERROR', 'Trips are unavailable.'))

    renderAs(<TripsPage />, makeUser({ role: 'dispatcher' }))

    expect(await screen.findByText('Could not load trips.')).toBeInTheDocument()
  })

  it('reports a timeline failure without taking the trip facts down with it', async () => {
    const user = userEvent.setup()
    get.mockImplementation((url: string) =>
      url.includes('/events')
        ? Promise.reject(apiFailure(500, 'SERVER_ERROR', 'nope'))
        : Promise.resolve(apiOk([trip()], { cursor: { next: null } })),
    )

    renderAs(<TripsPage />, makeUser({ role: 'finance' }))

    const panel = await openTrip(user)

    expect(
      await within(panel).findByText(/Could not load this trip’s timeline\./),
    ).toBeInTheDocument()
    // The six Bank facts live on the trip record, not in the timeline, so
    // they survive its failure.
    expect(within(panel).getByText('42.0 km')).toBeInTheDocument()
  })
})
