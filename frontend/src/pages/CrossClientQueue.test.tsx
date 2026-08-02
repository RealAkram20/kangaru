import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiOk, makeUser, renderAs } from '../test/harness'
import type { Booking } from '../types/booking'
import type { Driver } from '../types/driver'
import type { Trip } from '../types/trip'
import type { Vehicle } from '../types/vehicle'
import { BookingsPage } from './BookingsPage'
import { DispatchPage } from './DispatchPage'
import { TripsPage } from './TripsPage'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)

/**
 * ADR-0006 gave Shanitah's own staff one queue spanning every client, and
 * said in the same breath that a queue which does not name its clients is
 * **worse** than no cross-client queue at all.
 *
 * The failure this guards is not a leak — the server decides what anyone
 * may see. It is a *mistake*: a dispatcher committing a vehicle to what
 * they read as the Bank's airport run when the row belonged to another
 * client. Nothing on screen contradicted them, because `tenant_id` was the
 * only thing distinguishing the rows and nobody reads "3" as a bank.
 *
 * The scope comes from the API (`meta.scope`), never from inspecting the
 * signed-in user — a page that worked it out for itself would be another
 * copy of the predicate ADR-0006 exists to keep in one place.
 */

const PLATFORM_STAFF = makeUser({
  id: 90,
  tenant_id: null,
  name: 'Dispatch Desk',
  email: 'dispatch@kangaruride.test',
  role: 'dispatcher',
})

function booking(id: number, client: { id: number; name: string } | undefined, origin: string): Booking {
  return {
    id,
    tenant_id: client?.id ?? 1,
    ...(client ? { client } : {}),
    requested_by_user_id: 9,
    requested_by: { id: 9, name: 'Moses Kato', email: 'moses@x.test', role: 'corporate_admin' },
    passenger_name: 'Grace Amongin',
    passenger_phone: '+256700000000',
    passenger_count: 2,
    origin,
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
  }
}

function trip(id: number, client: { id: number; name: string } | undefined, origin: string): Trip {
  return {
    id,
    tenant_id: client?.id ?? 1,
    ...(client ? { client } : {}),
    // Deliberately narrower than what the API sends. `TripResource`
    // returns `booking_id` and the two `odometer_*_photo_url` fields; the
    // frontend `Trip` type declares none of them, because nothing here
    // reads them. `tsc -b` rejects the excess properties even though
    // `tsc --noEmit` accepts them, and CI runs both.
    vehicle_id: 7,
    driver_id: 3,
    origin,
    destination: 'Entebbe',
    status: 'assigned',
    allowed_transitions: [],
    odometer_start: null,
    odometer_start_photo_path: null,
    odometer_end: null,
    odometer_end_photo_path: null,
    distance_km: null,
    gps_distance_km: null,
    distance_variance_flagged: false,
    cancellation_charge_applicable: false,
    started_at: null,
    completed_at: null,
    duration_minutes: null,
    created_at: '2026-07-20T08:00:00.000000Z',
    updated_at: '2026-07-20T08:00:00.000000Z',
  }
}

const BANK = { id: 1, name: 'Centenary Bank' }
const NGO = { id: 2, name: 'Acme NGO Ltd' }

const vehicle: Vehicle = {
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
}

const driver: Driver = {
  id: 3,
  name: 'Ada Nakato',
  phone: '+256700999888',
  email: null,
  license_number: 'DL-99881',
  license_expiry: '2028-01-01',
  status: 'active',
  created_at: '2026-01-01T00:00:00.000000Z',
  updated_at: '2026-01-01T00:00:00.000000Z',
}

/** Serves whichever listing the page under test asks for, at `scope`. */
function serve(scope: 'platform' | 'tenant') {
  const meta = {
    cursor: { next: null },
    scope,
    filters: {
      clients:
        scope === 'platform'
          ? [
              { value: BANK.id, label: BANK.name },
              { value: NGO.id, label: NGO.name },
            ]
          : [],
    },
  }

  const bookings =
    scope === 'platform'
      ? [booking(41, BANK, 'Head Office'), booking(42, NGO, 'Ntinda')]
      : [booking(41, undefined, 'Head Office')]

  const trips =
    scope === 'platform'
      ? [trip(81, BANK, 'Head Office'), trip(82, NGO, 'Ntinda')]
      : [trip(81, undefined, 'Head Office')]

  get.mockImplementation((url: string) => {
    if (url.startsWith('/bookings')) return Promise.resolve(apiOk(bookings, meta))
    if (url.startsWith('/trips')) return Promise.resolve(apiOk(trips, meta))
    if (url.startsWith('/vehicles')) return Promise.resolve(apiOk([vehicle]))
    if (url.startsWith('/drivers')) return Promise.resolve(apiOk([driver]))
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the cross-client queue names its clients', () => {
  // Scoped to the table on purpose. The client picker renders the same
  // names as <option>s, so a bare getByText would match two nodes and
  // could pass on the picker alone while the rows stayed unlabelled.
  it('gives the bookings table a Client column for platform staff', async () => {
    serve('platform')

    renderAs(<BookingsPage />, PLATFORM_STAFF)

    expect(await screen.findByRole('columnheader', { name: 'Client' })).toBeInTheDocument()

    const table = within(screen.getByRole('table'))
    expect(table.getByText('Centenary Bank')).toBeInTheDocument()
    expect(table.getByText('Acme NGO Ltd')).toBeInTheDocument()
  })

  it('gives the trips table a Client column for platform staff', async () => {
    serve('platform')

    renderAs(<TripsPage />, PLATFORM_STAFF)

    expect(await screen.findByRole('columnheader', { name: 'Client' })).toBeInTheDocument()

    const table = within(screen.getByRole('table'))
    expect(table.getByText('Centenary Bank')).toBeInTheDocument()
    expect(table.getByText('Acme NGO Ltd')).toBeInTheDocument()
  })

  it('names the client on each row of the dispatch queue', async () => {
    serve('platform')

    renderAs(<DispatchPage />, PLATFORM_STAFF)

    expect(await screen.findByText('Head Office → Entebbe')).toBeInTheDocument()
    expect(screen.getByText('Centenary Bank')).toBeInTheDocument()
    expect(screen.getByText('Acme NGO Ltd')).toBeInTheDocument()
  })

  it('names the client in the assignment confirmation, the last screen before a vehicle is committed', async () => {
    serve('platform')

    renderAs(<DispatchPage />, PLATFORM_STAFF)

    await userEvent.click(await screen.findByText('Ntinda → Entebbe'))

    await userEvent.selectOptions(await screen.findByLabelText(/vehicle/i), '7')
    await userEvent.selectOptions(screen.getByLabelText(/driver/i), '3')
    await userEvent.click(screen.getByRole('button', { name: /assign/i }))

    const dialog = await screen.findByRole('dialog')

    // The sentence a dispatcher reads immediately before committing. Naming
    // the client only on the panel behind the dialog would be the wrong
    // place: the dialog is what has their attention.
    expect(within(dialog).getByText(/for Acme NGO Ltd/)).toBeInTheDocument()
  })

  it('filters the fetched page down to one client by name', async () => {
    serve('platform')

    renderAs(<BookingsPage />, PLATFORM_STAFF)

    await screen.findByRole('columnheader', { name: 'Client' })

    await userEvent.type(screen.getByPlaceholderText(/filter by client/i), 'Acme')

    // Asserted inside the table: the picker keeps rendering both names as
    // options regardless, so an unscoped query would never see a row go.
    // This box narrows the page in hand — the picker above it is what
    // narrows the query.
    const table = within(screen.getByRole('table'))
    expect(table.queryByText('Centenary Bank')).not.toBeInTheDocument()
    expect(table.getByText('Acme NGO Ltd')).toBeInTheDocument()
  })
})

describe('the client picker narrows on the server', () => {
  it('asks the API for one client rather than sifting the page it already has', async () => {
    serve('platform')

    renderAs(<BookingsPage />, PLATFORM_STAFF)

    await screen.findByLabelText('Client')

    await userEvent.selectOptions(screen.getByLabelText('Client'), String(NGO.id))

    // The distinction that matters. The search box narrows what was
    // fetched; this narrows what is fetched, which is the only version
    // that survives more than one page of queue.
    await waitFor(() => expect(get).toHaveBeenCalledWith('/bookings?tenant_id=2'))
  })

  it('does the same on the trips list', async () => {
    serve('platform')

    renderAs(<TripsPage />, PLATFORM_STAFF)

    await screen.findByLabelText('Client')

    await userEvent.selectOptions(screen.getByLabelText('Client'), String(BANK.id))

    await waitFor(() => expect(get).toHaveBeenCalledWith('/trips?tenant_id=1'))
  })

  it('offers every client, not only the ones on this page', async () => {
    serve('platform')

    renderAs(<BookingsPage />, PLATFORM_STAFF)

    const picker = await screen.findByLabelText('Client')

    // Sourced from meta.filters.clients, so the picker can reach a client
    // whose rows are further down — the reason anybody opens it.
    expect(within(picker).getByRole('option', { name: 'All clients' })).toBeInTheDocument()
    expect(within(picker).getByRole('option', { name: 'Centenary Bank' })).toBeInTheDocument()
    expect(within(picker).getByRole('option', { name: 'Acme NGO Ltd' })).toBeInTheDocument()
  })

  it('goes back to every client', async () => {
    serve('platform')

    renderAs(<BookingsPage />, PLATFORM_STAFF)

    await screen.findByLabelText('Client')

    await userEvent.selectOptions(screen.getByLabelText('Client'), String(NGO.id))
    await waitFor(() => expect(get).toHaveBeenCalledWith('/bookings?tenant_id=2'))

    await userEvent.selectOptions(screen.getByLabelText('Client'), '')

    // No `tenant_id` at all, rather than an empty one — the endpoint's
    // whitelist would take `tenant_id=` as a filter and fail validation.
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/bookings'))
  })
})

describe("a client's own listing is unchanged", () => {
  it('shows no client picker', async () => {
    serve('tenant')

    renderAs(<BookingsPage />)

    await screen.findByText('Head Office → Entebbe')

    // There is no client to choose. The endpoint refuses `tenant_id` from
    // this account, and `meta.filters.clients` came back empty.
    expect(screen.queryByLabelText('Client')).not.toBeInTheDocument()
  })

  it('shows no Client column on the bookings table', async () => {
    serve('tenant')

    renderAs(<BookingsPage />)

    await screen.findByText('Head Office → Entebbe')

    // A column repeating the reader's own name on every row is noise, and
    // the API does not even send it — `whenLoaded` omits the key.
    expect(screen.queryByRole('columnheader', { name: 'Client' })).not.toBeInTheDocument()
  })

  it('shows no Client column on the trips table', async () => {
    serve('tenant')

    renderAs(<TripsPage />)

    await screen.findByRole('columnheader', { name: 'Route' })

    expect(screen.queryByRole('columnheader', { name: 'Client' })).not.toBeInTheDocument()
  })

  it('leaves the filter placeholder without a client term', async () => {
    serve('tenant')

    renderAs(<BookingsPage />)

    await screen.findByText('Head Office → Entebbe')

    expect(screen.getByPlaceholderText('Filter by route, passenger or status')).toBeInTheDocument()
  })
})

describe('the page never decides the scope for itself', () => {
  it('shows no Client column when the API omits meta.scope entirely', async () => {
    // An older API, or one that stopped sending it. The safe reading is
    // "one client's listing": a column too few, rather than rows labelled
    // with a client the response never confirmed.
    get.mockImplementation((url: string) => {
      if (url.startsWith('/bookings')) return Promise.resolve(apiOk([booking(41, BANK, 'Head Office')]))
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })

    renderAs(<BookingsPage />, PLATFORM_STAFF)

    await screen.findByText('Head Office → Entebbe')

    expect(screen.queryByRole('columnheader', { name: 'Client' })).not.toBeInTheDocument()
  })

  it('trusts meta.scope over the signed-in user', async () => {
    // A tenant-scoped user with a platform-scoped response is not a real
    // combination — it is the assertion that the page reads the response
    // rather than the user object, which is the whole point of serving
    // `scope` at all.
    serve('platform')

    renderAs(<BookingsPage />, makeUser({ tenant_id: 1, role: 'corporate_admin' }))

    expect(await screen.findByRole('columnheader', { name: 'Client' })).toBeInTheDocument()
  })
})
