import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatTimestamp } from '../../lib/format'
import { apiFailure, apiOk, makeUser, renderAs } from '../../test/harness'
import type { Trip, TripEvent } from '../../types/trip'
import { TripRecordPage } from './TripRecordPage'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn() },
}))

const navigate = vi.fn()
let routeId = '29'
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ id: routeId }),
}))

// MapLibre needs a canvas; the trace map is its own component and is
// asserted on by what it is handed, not by pixels.
vi.mock('../../components/map/TripTraceMap', () => ({
  TripTraceMap: ({ points }: { points: unknown[] }) => <div data-testid="trace-map">{points.length} points</div>,
}))

const { apiClient } = await import('../../lib/apiClient')
const get = vi.mocked(apiClient.get)

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
      year: 2024,
      category: 'suv',
      seating_capacity: 5,
      color: null,
      vin: null,
      status: 'active',
      created_at: '',
      updated_at: '',
    },
    driver_id: 4,
    driver: { id: 4, name: 'Savion Pacocha' } as Trip['driver'],
    origin: 'Head Office, Kampala',
    destination: 'Mbale Branch',
    status: 'closed',
    allowed_transitions: [],
    odometer_start: 53484,
    odometer_start_photo_path: 'odometer/29-start.jpg',
    odometer_end: 53720,
    odometer_end_photo_path: 'odometer/29-end.jpg',
    distance_km: '236.00',
    gps_distance_km: '195.77',
    distance_variance_flagged: true,
    cancellation_charge_applicable: null,
    started_at: '2026-08-01T07:23:00.000000Z',
    completed_at: '2026-08-01T12:55:00.000000Z',
    duration_minutes: 332,
    created_at: '',
    updated_at: '',
    ...overrides,
  } as Trip
}

const EVENTS: TripEvent[] = [
  { id: 1, trip_id: 29, from_status: null, to_status: 'assigned', user_id: 4, user: { id: 4, name: 'Dispatch Desk', role: 'dispatcher' }, notes: null, created_at: '2026-08-01T06:00:00.000000Z' },
  { id: 2, trip_id: 29, from_status: 'trip_started', to_status: 'trip_completed', user_id: 9, user: { id: 9, name: 'Savion Pacocha', role: 'driver' }, notes: null, created_at: '2026-08-01T12:55:00.000000Z' },
]

const INVOICE = {
  uuid: 'inv-29',
  invoice_number: 'INV-2026-000020',
  trip_id: 29,
  rate_card_version_id: 1,
  currency: 'UGX',
  total_minor: 851000,
  credited_minor: 12000,
  balance_minor: 839000,
  issued_at: '2026-08-01T13:04:00.000000Z',
  issued_by_user_id: 1,
  notes: null,
}

const BLOB = new Blob(['jpg'], { type: 'image/jpeg' })

function serve(overrides: Record<string, unknown | Error> = {}) {
  get.mockImplementation((url: string) => {
    for (const [key, answer] of Object.entries(overrides)) {
      if (url.startsWith(key)) return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
    }
    if (url === '/trips/29') return Promise.resolve(apiOk(trip()))
    if (url === '/trips/29/events') return Promise.resolve(apiOk(EVENTS, { cursor: { next: null } }))
    if (url.startsWith('/trips/29/locations'))
      return Promise.resolve(apiOk([{ latitude: 0.34, longitude: 32.58 }, { latitude: 1.08, longitude: 34.17 }], { cursor: { next: null }, gps_distance_km: 195.77 }))
    if (url.startsWith('/trips/29/odometer-photo/')) return Promise.resolve({ data: BLOB })
    if (url === '/invoices') return Promise.resolve(apiOk([INVOICE]))
    return Promise.reject(apiFailure(404, 'NOT_FOUND', 'No.'))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  routeId = '29'
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:photo')
  globalThis.URL.revokeObjectURL = vi.fn()
  serve()
})

describe('TripRecordPage — the six facts and their evidence', () => {
  it('shows every data point the letter names, from the trip itself', async () => {
    renderAs(<TripRecordPage />, makeUser({ role: 'corporate_admin' }))

    expect(await screen.findByText('Trip #29')).toBeInTheDocument()
    // 1. commencement and completion
    expect(screen.getByText(formatTimestamp('2026-08-01T07:23:00.000000Z'))).toBeInTheDocument()
    // Completed appears as the fact and again on the timeline's last event.
    expect(screen.getAllByText(formatTimestamp('2026-08-01T12:55:00.000000Z')).length).toBeGreaterThan(0)
    // 2. registration
    expect(screen.getByText('UNW 211R')).toBeInTheDocument()
    // 3. origin and destination
    expect(screen.getByText('Head Office, Kampala')).toBeInTheDocument()
    expect(screen.getByText('Mbale Branch')).toBeInTheDocument()
    // 4. opening and closing odometer
    expect(screen.getByText('53,484')).toBeInTheDocument()
    expect(screen.getByText('53,720')).toBeInTheDocument()
    // 5. distance, with the GPS figure beside it
    expect(screen.getByText('236.0 km')).toBeInTheDocument()
    expect(screen.getByText('GPS trace: 195.8 km')).toBeInTheDocument()
    // 6. duration in hours and minutes
    expect(screen.getByText('5h 32m')).toBeInTheDocument()
  })

  it('names the platform\'s own verdict on the readings, and says why', async () => {
    renderAs(<TripRecordPage />, makeUser({ role: 'corporate_admin' }))

    await screen.findByText('Trip #29')
    expect(screen.getAllByText('Check').length).toBeGreaterThan(0)
    expect(screen.getByText(/disagree beyond tolerance/i)).toBeInTheDocument()
  })

  it('shows the dashboard photograph behind each reading, fetched with the token', async () => {
    renderAs(<TripRecordPage />, makeUser({ role: 'corporate_admin' }))

    expect(await screen.findByAltText('Opening dashboard photo')).toBeInTheDocument()
    expect(await screen.findByAltText('Closing dashboard photo')).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/trips/29/odometer-photo/start', { responseType: 'blob' })
    expect(get).toHaveBeenCalledWith('/trips/29/odometer-photo/end', { responseType: 'blob' })
  })

  it('says when no photo was captured rather than showing a placeholder', async () => {
    serve({ '/trips/29/odometer-photo/end': apiFailure(404, 'NOT_FOUND', 'No dashboard photo.') })

    renderAs(<TripRecordPage />, makeUser({ role: 'corporate_admin' }))

    expect(await screen.findByAltText('Opening dashboard photo')).toBeInTheDocument()
    expect(await screen.findByText(/no dashboard photo captured/i)).toBeInTheDocument()
    expect(screen.queryByAltText('Closing dashboard photo')).not.toBeInTheDocument()
  })

  it('draws the recorded GPS trace and states its length', async () => {
    renderAs(<TripRecordPage />, makeUser({ role: 'corporate_admin' }))

    expect(await screen.findByTestId('trace-map')).toHaveTextContent('2 points')
    expect(screen.getByText('2 GPS positions · 195.8 km by GPS')).toBeInTheDocument()
  })

  it('says so when no trace was recorded, and draws no road', async () => {
    serve({ '/trips/29/locations': apiOk([], { cursor: { next: null }, gps_distance_km: null }) })

    renderAs(<TripRecordPage />, makeUser({ role: 'corporate_admin' }))

    expect(await screen.findByText(/No GPS trace was recorded/i)).toBeInTheDocument()
    expect(screen.queryByTestId('trace-map')).not.toBeInTheDocument()
  })

  it('shows the timeline and the invoice the trip produced', async () => {
    renderAs(<TripRecordPage />, makeUser({ role: 'corporate_admin' }))

    expect(await screen.findByText('Dispatch Desk')).toBeInTheDocument()
    expect(screen.getByText('INV-2026-000020')).toBeInTheDocument()
    expect(screen.getByText('UGX 851,000')).toBeInTheDocument()
    expect(screen.getByText('−UGX 12,000')).toBeInTheDocument()
    expect(screen.getByText('UGX 839,000')).toBeInTheDocument()
  })

  it('leaves the invoice card out for a reader the API refuses it to', async () => {
    serve({ '/invoices': apiFailure(403, 'FORBIDDEN', 'No.') })

    renderAs(<TripRecordPage />, makeUser({ role: 'corporate_employee' }))

    await screen.findByText('Trip #29')
    await waitFor(() => expect(get).toHaveBeenCalledWith('/invoices', { params: { trip_id: 29 } }))
    expect(screen.queryByText('Invoice')).not.toBeInTheDocument()
    expect(screen.queryByText(/UGX/)).not.toBeInTheDocument()
  })

  it('reports a trip it cannot load, and refuses a non-number', async () => {
    serve({ '/trips/29': apiFailure(404, 'NOT_FOUND', 'The requested resource could not be found.') })
    renderAs(<TripRecordPage />, makeUser({ role: 'corporate_admin' }))
    expect(await screen.findByText(/could not be found/i)).toBeInTheDocument()

    routeId = 'abc'
    renderAs(<TripRecordPage />, makeUser({ role: 'corporate_admin' }))
    expect(await screen.findByText('This is not a trip number.')).toBeInTheDocument()
  })
})
