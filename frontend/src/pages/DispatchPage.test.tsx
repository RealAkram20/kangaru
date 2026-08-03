import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, renderAs } from '../test/harness'
import type { Booking } from '../types/booking'
import type { Driver } from '../types/driver'
import type { Vehicle } from '../types/vehicle'
import { DispatchPage } from './DispatchPage'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 41,
    // Bookings are still tenant-scoped — they are the client's. Only the
    // fleet moved to the platform (ADR-0005).
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
    status: 'approved',
    approved_by_user_id: 1,
    approved_at: '2026-07-20T08:05:00.000000Z',
    decision_reason: null,
    notes: null,
    created_at: '2026-07-20T08:00:00.000000Z',
    updated_at: '2026-07-20T08:00:00.000000Z',
    ...overrides,
  }
}

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 7,
    registration_number: 'UAA 111A',
    make: 'Toyota',
    model: 'Hiace',
    year: 2021,
    category: 'van',
    seating_capacity: 12,
    color: 'White',
    vin: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000000Z',
    updated_at: '2026-01-01T00:00:00.000000Z',
    ...overrides,
  }
}

function driver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: 3,
    name: 'Ada Nakato',
    phone: '+256700999888',
    email: null,
    license_number: 'DL-99881',
    license_expiry: '2028-01-01',
    status: 'active',
    created_at: '2026-01-01T00:00:00.000000Z',
    updated_at: '2026-01-01T00:00:00.000000Z',
    ...overrides,
  }
}

/** The board loads three endpoints in parallel; order matters to the mock. */
function board(
  queue: Booking[] = [booking()],
  vehicles: Vehicle[] = [vehicle()],
  drivers: Driver[] = [driver()],
) {
  get.mockImplementation((url: string) => {
    if (url.startsWith('/bookings')) return Promise.resolve(apiOk(queue))
    if (url.startsWith('/vehicles')) return Promise.resolve(apiOk(vehicles))
    if (url.startsWith('/drivers')) return Promise.resolve(apiOk(drivers))
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  board()
  post.mockResolvedValue(apiOk({ id: 88, driver: driver(), vehicle: vehicle() }))
})

/**
 * The dispatch board — the second flow AGENTS.md names by hand.
 *
 * The behaviour that matters here is what happens when the server refuses.
 * Assignment is pessimistically locked server-side and exactly one of two
 * racing dispatchers wins; the loser gets a 409, and what this screen does
 * with it is the whole reason the lock is worth having. A board that
 * swallowed that would let a dispatcher believe they had a vehicle they
 * did not.
 */
describe('DispatchPage', () => {
  it('shows the queue and asks for a selection before offering anything', async () => {
    renderAs(<DispatchPage />)

    expect(await screen.findByText('Kampala → Entebbe')).toBeInTheDocument()
    expect(screen.getByText('Select a booking')).toBeInTheDocument()
    expect(screen.queryByLabelText(/vehicle/i)).not.toBeInTheDocument()
  })

  it('pages the queue with the cursor, appending rather than replacing', async () => {
    const user = userEvent.setup()
    get.mockImplementation((url: string) => {
      if (url.startsWith('/bookings')) {
        // The cursor is opaque and sent back unaltered; the second page
        // ends the queue.
        return Promise.resolve(
          url.includes('cursor=abc')
            ? apiOk([booking({ id: 42, origin: 'Ntinda', destination: 'Kololo' })], {
                cursor: { next: null },
              })
            : apiOk([booking()], { cursor: { next: 'abc' } }),
        )
      }
      if (url.startsWith('/vehicles')) return Promise.resolve(apiOk([vehicle()]))
      if (url.startsWith('/drivers')) return Promise.resolve(apiOk([driver()]))
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })

    renderAs(<DispatchPage />)
    await screen.findByText('Kampala → Entebbe')

    await user.click(screen.getByRole('button', { name: /load more/i }))

    // Appended: the row already on screen stays put beside the new one. A
    // queue that replaced its rows would pull the page out from under a
    // dispatcher mid-read.
    expect(await screen.findByText('Ntinda → Kololo')).toBeInTheDocument()
    expect(screen.getByText('Kampala → Entebbe')).toBeInTheDocument()

    // And the control removes itself at the end of the queue.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument(),
    )
  })

  it('offers no load-more when the queue fits one page', async () => {
    renderAs(<DispatchPage />)

    await screen.findByText('Kampala → Entebbe')
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument()
  })

  it('says the queue is clear rather than showing nothing', async () => {
    board([])

    renderAs(<DispatchPage />)

    expect(await screen.findByText('Queue clear')).toBeInTheDocument()
  })

  it('says so when the board cannot be loaded', async () => {
    get.mockRejectedValue(apiFailure(500, 'SERVER_ERROR', 'The dispatch service is unavailable.'))

    renderAs(<DispatchPage />)

    expect(await screen.findByText('Dispatch board unavailable')).toBeInTheDocument()
  })

  it('only offers active vehicles and drivers', async () => {
    const user = userEvent.setup()
    board(
      [booking()],
      [vehicle(), vehicle({ id: 8, registration_number: 'UBB 222B', status: 'maintenance' })],
      [driver(), driver({ id: 4, name: 'Ben Okello', status: 'suspended' })],
    )

    renderAs(<DispatchPage />)
    await user.click(await screen.findByRole('button', { name: /Kampala → Entebbe/ }))

    // A courtesy filter, not the rule — the server rejects anything
    // inactive regardless. But offering a vehicle in the workshop invites a
    // 409 the dispatcher could have avoided.
    const vehicles = screen.getByLabelText(/vehicle/i)
    expect(within(vehicles).getByRole('option', { name: /UAA 111A/ })).toBeInTheDocument()
    expect(within(vehicles).queryByRole('option', { name: /UBB 222B/ })).not.toBeInTheDocument()

    const drivers = screen.getByLabelText(/driver/i)
    expect(within(drivers).queryByRole('option', { name: /Ben Okello/ })).not.toBeInTheDocument()
  })

  it('will not assign until both a vehicle and a driver are chosen', async () => {
    const user = userEvent.setup()
    renderAs(<DispatchPage />)

    await user.click(await screen.findByRole('button', { name: /Kampala → Entebbe/ }))

    const assign = screen.getByRole('button', { name: /^assign$/i })
    expect(assign).toBeDisabled()

    await user.selectOptions(screen.getByLabelText(/vehicle/i), '7')
    expect(assign).toBeDisabled()

    await user.selectOptions(screen.getByLabelText(/driver/i), '3')
    expect(assign).toBeEnabled()
  })

  it('confirms before committing a vehicle and driver', async () => {
    const user = userEvent.setup()
    renderAs(<DispatchPage />)

    await user.click(await screen.findByRole('button', { name: /Kampala → Entebbe/ }))
    await user.selectOptions(screen.getByLabelText(/vehicle/i), '7')
    await user.selectOptions(screen.getByLabelText(/driver/i), '3')
    await user.click(screen.getByRole('button', { name: /^assign$/i }))

    // Assignment takes a pessimistic lock and blocks both the vehicle and
    // the driver until the trip ends. That is not something to do on a
    // single click.
    expect(await screen.findByText(/this commits UAA 111A and Ada Nakato/i)).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /confirm assignment/i }))

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/bookings/41/assignment', { vehicle_id: 7, driver_id: 3 }),
    )
  })

  it('reports the trip it created and reloads the board', async () => {
    const user = userEvent.setup()
    renderAs(<DispatchPage />)

    await user.click(await screen.findByRole('button', { name: /Kampala → Entebbe/ }))
    await user.selectOptions(screen.getByLabelText(/vehicle/i), '7')
    await user.selectOptions(screen.getByLabelText(/driver/i), '3')
    await user.click(screen.getByRole('button', { name: /^assign$/i }))

    // Counted from here: the harness renders in StrictMode like the app,
    // so the board's three mount requests happen twice. The assertion is
    // that assignment refetches, not how many the mount made.
    const before = get.mock.calls.length

    await user.click(screen.getByRole('button', { name: /confirm assignment/i }))

    expect(await screen.findByText('Booking dispatched')).toBeInTheDocument()
    expect(screen.getByText(/trip #88/)).toBeInTheDocument()

    // Reloaded, not patched: another dispatcher may have been deciding at
    // the same time, and a stale queue is what causes the next 409.
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(before))
  })

  it('shows the server\'s refusal verbatim when it loses a race for the vehicle', async () => {
    const user = userEvent.setup()
    post.mockRejectedValue(
      apiFailure(
        409,
        'VEHICLE_UNAVAILABLE',
        'UAA 111A was assigned to trip #91 a moment ago. Choose another vehicle.',
      ),
    )

    renderAs(<DispatchPage />)

    await user.click(await screen.findByRole('button', { name: /Kampala → Entebbe/ }))
    await user.selectOptions(screen.getByLabelText(/vehicle/i), '7')
    await user.selectOptions(screen.getByLabelText(/driver/i), '3')
    await user.click(screen.getByRole('button', { name: /^assign$/i }))
    await user.click(screen.getByRole('button', { name: /confirm assignment/i }))

    // The exact sentence the dispatcher needs — it names the trip that has
    // their vehicle. Re-wording it in the client is how they end up reading
    // "Something went wrong" instead.
    expect(await screen.findByText(/assigned to trip #91 a moment ago/i)).toBeInTheDocument()
    expect(screen.getByText('Assignment refused')).toBeInTheDocument()

    // No success banner, and the confirm dialog is closed so the panel can
    // be corrected rather than the same assignment retried blindly.
    expect(screen.queryByText('Booking dispatched')).not.toBeInTheDocument()
  })

  it('warns when the chosen vehicle has fewer seats than passengers', async () => {
    const user = userEvent.setup()
    board([booking({ passenger_count: 6 })], [vehicle({ seating_capacity: 4 })])

    renderAs(<DispatchPage />)

    await user.click(await screen.findByRole('button', { name: /Kampala → Entebbe/ }))
    await user.selectOptions(screen.getByLabelText(/vehicle/i), '7')

    // A warning, not a block: the server has no seating rule, and a
    // dispatcher who knows two passengers dropped out should not be stopped.
    expect(await screen.findByText('Seats may be short')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText(/driver/i), '3')
    expect(screen.getByRole('button', { name: /^assign$/i })).toBeEnabled()
  })
})
