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
    account: null,
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
    // Before the plain `/bookings` arm: these are `/bookings/{id}/...` and
    // the prefix match would otherwise hand the picker the booking queue.
    if (url.includes('/candidate-vehicles')) {
      // Active-only, because that is what the server does
      // (`VehicleCandidates` / `DriverCandidates` both scope to active).
      // A mock that returned retired vehicles would let a regression in the
      // real filter pass here unnoticed.
      return Promise.resolve(
        apiOk(
          vehicles.filter((v) => v.status === 'active').map((v) => ({ ...v, ...freeCandidate })),
        ),
      )
    }
    if (url.includes('/candidate-drivers')) {
      return Promise.resolve(
        apiOk(
          drivers.filter((d) => d.status === 'active').map((d) => ({ ...d, ...freeCandidate })),
        ),
      )
    }
    if (url.startsWith('/bookings')) return Promise.resolve(apiOk(queue))
    if (url.startsWith('/vehicles')) return Promise.resolve(apiOk(vehicles))
    if (url.startsWith('/drivers')) return Promise.resolve(apiOk(drivers))
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

/** Everything free, which is what most of these cases are not about. */
const freeCandidate = {
  allocated: false,
  dispatchable: true,
  requires_override_reason: false,
  note: null,
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

  /**
   * ADR-0017 on this screen. The board used to offer everything and let the
   * assignment endpoint refuse, so a dispatcher learned the rule by being
   * stopped. These assert the two halves of the fix: the reason is visible
   * *before* the click, and the option still exists.
   */
  it('shows an unavailable vehicle with its reason instead of hiding it', async () => {
    const user = userEvent.setup()
    const inWorkshop = vehicle({ id: 9, registration_number: 'UCC 333C' })

    get.mockImplementation((url: string) => {
      if (url.includes('/candidate-vehicles')) {
        return Promise.resolve(
          apiOk([
            { ...vehicle(), ...freeCandidate },
            {
              ...inWorkshop,
              ...freeCandidate,
              dispatchable: false,
              note: 'Not available for this time.',
            },
          ]),
        )
      }
      if (url.includes('/candidate-drivers')) {
        return Promise.resolve(apiOk([{ ...driver(), ...freeCandidate }]))
      }
      if (url.startsWith('/bookings')) return Promise.resolve(apiOk([booking()]))
      if (url.startsWith('/vehicles')) return Promise.resolve(apiOk([vehicle(), inWorkshop]))
      if (url.startsWith('/drivers')) return Promise.resolve(apiOk([driver()]))
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })

    renderAs(<DispatchPage />)
    await user.click(await screen.findByRole('button', { name: /Kampala → Entebbe/ }))

    const vehicles = await screen.findByLabelText(/vehicle/i)
    const blocked = await within(vehicles).findByRole('option', { name: /UCC 333C/ })

    // Listed, so a dispatcher who knows the fleet is not left wondering
    // where it went — and carrying the reason, so they do not have to guess.
    expect(blocked).toBeInTheDocument()
    expect(blocked).toHaveTextContent('Not available for this time.')
    // But unpickable: the server would answer 409 anyway, and finding that
    // out after the confirmation dialog is the experience this replaces.
    expect(blocked).toBeDisabled()

    expect(within(vehicles).getByRole('option', { name: /UAA 111A/ })).toBeEnabled()
  })

  it('shows an unavailable driver the same way', async () => {
    const user = userEvent.setup()
    const onLeave = driver({ id: 5, name: 'Ben Okello' })

    get.mockImplementation((url: string) => {
      if (url.includes('/candidate-vehicles')) {
        return Promise.resolve(apiOk([{ ...vehicle(), ...freeCandidate }]))
      }
      if (url.includes('/candidate-drivers')) {
        return Promise.resolve(
          apiOk([
            { ...driver(), ...freeCandidate },
            { ...onLeave, dispatchable: false, note: 'Not rostered for this time.' },
          ]),
        )
      }
      if (url.startsWith('/bookings')) return Promise.resolve(apiOk([booking()]))
      if (url.startsWith('/vehicles')) return Promise.resolve(apiOk([vehicle()]))
      if (url.startsWith('/drivers')) return Promise.resolve(apiOk([driver(), onLeave]))
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })

    renderAs(<DispatchPage />)
    await user.click(await screen.findByRole('button', { name: /Kampala → Entebbe/ }))

    const drivers = await screen.findByLabelText(/driver/i)
    const blocked = await within(drivers).findByRole('option', { name: /Ben Okello/ })

    // "Not rostered" and "on leave" are different problems with different
    // fixes, and the board says which.
    expect(blocked).toHaveTextContent('Not rostered for this time.')
    expect(blocked).toBeDisabled()
  })

  it('still offers the plain fleet when the candidate lookup fails', async () => {
    const user = userEvent.setup()

    get.mockImplementation((url: string) => {
      if (url.includes('/candidate-')) return Promise.reject(new Error('down'))
      if (url.startsWith('/bookings')) return Promise.resolve(apiOk([booking()]))
      if (url.startsWith('/vehicles')) return Promise.resolve(apiOk([vehicle()]))
      if (url.startsWith('/drivers')) return Promise.resolve(apiOk([driver()]))
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })

    renderAs(<DispatchPage />)
    await user.click(await screen.findByRole('button', { name: /Kampala → Entebbe/ }))

    // Losing the annotation costs a dispatcher the preview, not the ability
    // to work — the assignment endpoint enforces availability regardless.
    const vehicles = await screen.findByLabelText(/vehicle/i)
    expect(within(vehicles).getByRole('option', { name: /UAA 111A/ })).toBeEnabled()
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

  it("shows the server's refusal verbatim when it loses a race for the vehicle", async () => {
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
