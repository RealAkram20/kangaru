import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatTimestamp } from '../../lib/format'
import { apiFailure, apiOk, makeUser, renderAs } from '../../test/harness'
import type { Booking } from '../../types/booking'
import type { Trip } from '../../types/trip'
import { ClientDashboard } from './ClientDashboard'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn() },
}))

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))

const { apiClient } = await import('../../lib/apiClient')
const get = vi.mocked(apiClient.get)

const TRIP_SUMMARY = {
  trips: 12,
  trips_completed: 11,
  distance_km: 1260,
  duration_minutes: 1914,
  records_incomplete: 0,
  completeness_percent: 100,
}

const MONTH_MONEY = {
  periods: 1,
  invoices: 8,
  invoiced_minor: 4381200,
  credit_notes: 3,
  credited_minor: 34000,
  outstanding_minor: 4347200,
  currency: 'UGX',
  payments_recorded: false,
}

const TO_DATE_MONEY = { ...MONTH_MONEY, invoices: 24, invoiced_minor: 12855700, credited_minor: 94000, outstanding_minor: 12761700 }

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 29,
    tenant_id: 1,
    booking_id: 31,
    vehicle_id: 3,
    vehicle: {
      id: 3,
      registration_number: 'UNW 211R',
      make: 'Toyota',
      model: 'Land Cruiser',
      year: 2018,
      category: 'suv',
      seating_capacity: 5,
      color: null,
      vin: null,
      status: 'active',
      created_at: '',
      updated_at: '',
    },
    driver_id: 4,
    origin: 'Head Office, Kampala',
    destination: 'Mbale Branch',
    status: 'closed',
    allowed_transitions: [],
    odometer_start: 53484,
    odometer_start_photo_path: null,
    odometer_end: 53720,
    odometer_end_photo_path: null,
    distance_km: '236.00',
    gps_distance_km: null,
    distance_variance_flagged: false,
    cancellation_charge_applicable: null,
    started_at: '2026-08-01T07:23:00.000000Z',
    completed_at: '2026-08-01T12:55:00.000000Z',
    duration_minutes: 332,
    created_at: '',
    updated_at: '',
    ...overrides,
  } as Trip
}

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 40,
    tenant_id: 1,
    requested_by_user_id: 6,
    requested_by: { id: 6, name: 'Grace Amongin', email: 'grace@centenary-bank.test', role: 'corporate_employee' },
    passenger_name: 'Lorna Breitenberg',
    passenger_phone: '+256700000000',
    passenger_count: 3,
    origin: 'Kampala',
    destination: 'Masaka',
    scheduled_for: null,
    is_immediate: true,
    status: 'pending',
    approved_by_user_id: null,
    approved_at: null,
    ...overrides,
  } as Booking
}

/** Answers each endpoint the page calls; anything unlisted resolves empty. */
function serve(overrides: Partial<Record<string, unknown>> = {}) {
  get.mockImplementation((url: string) => {
    if (url in overrides) {
      const answer = overrides[url]
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
    }
    if (url.startsWith('/reports/trips')) return Promise.resolve(apiOk([], { cursor: { next: null }, summary: TRIP_SUMMARY, scope: 'tenant' }))
    if (url.startsWith('/reports/financial?from')) return Promise.resolve(apiOk([], { summary: MONTH_MONEY, scope: 'tenant' }))
    if (url.startsWith('/reports/financial')) return Promise.resolve(apiOk([], { summary: TO_DATE_MONEY, scope: 'tenant' }))
    if (url.startsWith('/bookings')) return Promise.resolve(apiOk([booking()]))
    if (url === '/live-positions') return Promise.resolve(apiOk([{ vehicle_id: 3, trip_id: 29 }]))
    if (url === '/trips') return Promise.resolve(apiOk([trip()]))
    return Promise.resolve(apiOk([]))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  serve()
})

describe('ClientDashboard — a corporate admin', () => {
  it('shows this month\'s figures straight from the report summaries', async () => {
    renderAs(<ClientDashboard />, makeUser({ role: 'corporate_admin' }))

    const month = await screen.findByRole('region', { name: 'This month' })
    // Trips: completed count with commenced beside it.
    expect(within(month).getByText('11')).toBeInTheDocument()
    expect(within(month).getByText('12 commenced')).toBeInTheDocument()
    // Distance: the summary's kilometres, thousands-separated.
    expect(within(month).getByText('1,260')).toBeInTheDocument()
    // Invoiced this month is invoiced less credited, whole shillings.
    expect(within(month).getByText('UGX 4,347,200')).toBeInTheDocument()
    expect(within(month).getByText('8 invoices, less UGX 34,000 credited')).toBeInTheDocument()
    // Outstanding is the to-date balance, and says what it is not.
    expect(within(month).getByText('UGX 12,761,700')).toBeInTheDocument()
    expect(within(month).getByText(/payments are not recorded here/i)).toBeInTheDocument()
  })

  it("shows how complete the month's records are, and points at the trips missing a reading", async () => {
    renderAs(<ClientDashboard />, makeUser({ role: 'corporate_admin' }))

    const month = await screen.findByRole('region', { name: 'This month' })
    expect(within(month).getByText('100%')).toBeInTheDocument()
    expect(within(month).getByText('Every completed trip has all six data points')).toBeInTheDocument()

    within(month).getByRole('link', { name: /records complete/i }).click()
    expect(navigate).toHaveBeenCalledWith('/trips')
  })

  it('names the count of trips missing an odometer reading', async () => {
    serve()
    get.mockImplementation((url: string) => {
      if (url.startsWith('/reports/trips'))
        return Promise.resolve(apiOk([], { cursor: { next: null }, summary: { ...TRIP_SUMMARY, records_incomplete: 2, completeness_percent: 82 }, scope: 'tenant' }))
      if (url.startsWith('/reports/financial?from')) return Promise.resolve(apiOk([], { summary: MONTH_MONEY, scope: 'tenant' }))
      if (url.startsWith('/reports/financial')) return Promise.resolve(apiOk([], { summary: TO_DATE_MONEY, scope: 'tenant' }))
      return Promise.resolve(apiOk([]))
    })

    renderAs(<ClientDashboard />, makeUser({ role: 'corporate_admin' }))

    const month = await screen.findByRole('region', { name: 'This month' })
    expect(await within(month).findByText('82%')).toBeInTheDocument()
    expect(within(month).getByText('2 trips are missing an odometer reading')).toBeInTheDocument()
  })

  it('never passes a tenant_id — the server scopes every call', async () => {
    renderAs(<ClientDashboard />, makeUser({ role: 'corporate_admin' }))

    await screen.findByText('UGX 12,761,700')
    for (const [url] of get.mock.calls) expect(String(url)).not.toContain('tenant_id')
  })

  it('lists bookings awaiting approval and offers the Bookings page', async () => {
    renderAs(<ClientDashboard />, makeUser({ role: 'corporate_admin' }))

    expect(await screen.findByText('Awaiting your approval')).toBeInTheDocument()
    expect(await screen.findByText('Lorna Breitenberg')).toBeInTheDocument()
    expect(screen.getByText('1 pending')).toBeInTheDocument()

    screen.getByRole('button', { name: /review in bookings/i }).click()
    expect(navigate).toHaveBeenCalledWith('/bookings')
  })

  it('shows the record the client asked for on each recent trip', async () => {
    renderAs(<ClientDashboard />, makeUser({ role: 'corporate_admin' }))

    expect(await screen.findByText('UNW 211R')).toBeInTheDocument()
    expect(screen.getByText('53,484 / 53,720')).toBeInTheDocument()
    expect(screen.getByText('236.0 km')).toBeInTheDocument()
    expect(screen.getByText('5h 32m')).toBeInTheDocument()
    // Rendered in the reader's local time, like every timestamp in the console.
    expect(screen.getByText(formatTimestamp('2026-08-01T07:23:00.000000Z'))).toBeInTheDocument()
  })

  it('counts vehicles reporting a position', async () => {
    renderAs(<ClientDashboard />, makeUser({ role: 'corporate_admin' }))

    expect(await screen.findByText('vehicle reporting a position')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('renders dashes, not zeros, when a report is refused — and keeps the rest', async () => {
    get.mockImplementation((url: string) => {
      if (url.startsWith('/reports/')) return Promise.reject(apiFailure(403, 'FORBIDDEN', 'No.'))
      if (url === '/trips') return Promise.resolve(apiOk([trip()]))
      if (url === '/live-positions') return Promise.resolve(apiOk([]))
      return Promise.resolve(apiOk([]))
    })

    renderAs(<ClientDashboard />, makeUser({ role: 'corporate_admin' }))

    expect(await screen.findByText('UNW 211R')).toBeInTheDocument()
    const month = screen.getByRole('region', { name: 'This month' })
    expect(within(month).getAllByText('—')).toHaveLength(5)
    expect(within(month).queryByText(/UGX 0/)).not.toBeInTheDocument()
    expect(within(month).getByText('Report unavailable')).toBeInTheDocument()
  })
})

describe('ClientDashboard — a corporate employee', () => {
  it('asks for no report and shows no money', async () => {
    renderAs(<ClientDashboard />, makeUser({ role: 'corporate_employee' }))

    expect(await screen.findByText('UNW 211R')).toBeInTheDocument()
    await waitFor(() => expect(get).toHaveBeenCalledWith('/trips'))
    for (const [url] of get.mock.calls) expect(String(url)).not.toContain('/reports/')
    expect(screen.queryByRole('region', { name: 'This month' })).not.toBeInTheDocument()
    expect(screen.queryByText(/UGX/)).not.toBeInTheDocument()
  })

  it('frames the pending list as their own requests', async () => {
    renderAs(<ClientDashboard />, makeUser({ role: 'corporate_employee' }))

    expect(await screen.findByText('Your requests awaiting approval')).toBeInTheDocument()
    expect(screen.queryByText('Awaiting your approval')).not.toBeInTheDocument()
  })
})
