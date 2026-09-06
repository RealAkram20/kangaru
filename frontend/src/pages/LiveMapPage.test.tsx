import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveMapPage } from './LiveMapPage'
import { apiClient } from '../lib/apiClient'
import { POLL_MS, type FleetUnit } from '../lib/livePositions'
import { apiFailure } from '../test/harness'
import type { LivePosition, NearbyVehicle, OnDutyDriver } from '../types/livePosition'

/**
 * The page, not the map. MapLibre needs a WebGL context jsdom does not
 * have, so `FleetMap` is replaced by a stub that records what it was given
 * — which is the only thing this page owes it. The marker arithmetic is
 * tested in `lib/livePositions.test.ts`, where it can be tested properly.
 */
const drawn = vi.fn()

vi.mock('../components/map/FleetMap', () => ({
  FleetMap: (props: { units: FleetUnit[] }) => {
    drawn(props.units)
    // Mirrors the real map: `planMarkers` never plans a marker for a unit
    // without a position, so the count here is what would actually be drawn.
    const placed = props.units.filter((u) => u.latitude !== null && u.longitude !== null)
    return <div data-testid="fleet-map">{placed.length} markers</div>
  },
}))

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn() },
}))

const get = vi.mocked(apiClient.get)

function position(overrides: Partial<LivePosition> = {}): LivePosition {
  return {
    vehicle_id: 1,
    trip_id: 10,
    driver_id: 5,
    latitude: 0.3476,
    longitude: 32.5825,
    speed_kph: 40,
    heading_degrees: 90,
    recorded_at: '2026-08-07T12:00:00Z',
    age_seconds: 3,
    stale: false,
    vehicle: { id: 1, registration_number: 'UBK 421H', make: 'Toyota', model: 'Noah' },
    driver: { id: 5, name: 'Grace Nakato' },
    trip: {
      id: 10,
      status: 'trip_started',
      origin: 'Kampala Road',
      destination: 'Entebbe Airport',
      client: { id: 3, name: 'Centenary Bank' },
    },
    ...overrides,
  }
}

function waitingDriver(overrides: Partial<OnDutyDriver> = {}): OnDutyDriver {
  return {
    driver_id: 15,
    driver: { id: 15, name: 'Okello Denis' },
    vehicle_id: 19,
    vehicle: { id: 19, registration_number: 'UAX 900Q', make: 'Bajaj', model: 'Boxer' },
    latitude: 0.395,
    longitude: 32.703,
    accuracy_metres: 12,
    recorded_at: '2026-08-07T12:00:00Z',
    age_seconds: 20,
    stale: false,
    trip: null,
    ...overrides,
  }
}

/** Routes each poll by URL: the page asks two endpoints per tick. */
function answers(
  positions: LivePosition[],
  onDuty: OnDutyDriver[] | 'forbidden' = [],
  nearby: NearbyVehicle[] = [],
) {
  get.mockImplementation(((url: string) => {
    if (url.startsWith('/live-positions')) {
      return Promise.resolve({
        data: {
          success: true,
          message: '',
          data: positions,
          meta: { scope: 'platform', filters: { clients: [{ value: 3, label: 'Centenary Bank' }] } },
        },
      })
    }
    if (url.startsWith('/public/nearby-vehicles')) {
      return Promise.resolve({ data: { success: true, message: '', data: nearby } })
    }
    if (onDuty === 'forbidden') {
      return Promise.reject(apiFailure(403, 'FORBIDDEN', 'This action is unauthorized.'))
    }
    return Promise.resolve({ data: { success: true, message: '', data: onDuty } })
  }) as never)
}

function page() {
  return render(
    <MemoryRouter>
      <LiveMapPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  drawn.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('LiveMapPage', () => {
  it('draws the fleet and the pool together, named', async () => {
    answers([position()], [waitingDriver()])

    page()

    expect(await screen.findByTestId('fleet-map')).toHaveTextContent('2 markers')
    expect(screen.getByText('UBK 421H')).toBeInTheDocument()
    expect(screen.getByText('Grace Nakato')).toBeInTheDocument()
    expect(screen.getByText('Okello Denis')).toBeInTheDocument()
    expect(screen.getByText('1 on a trip · 1 waiting')).toBeInTheDocument()
  })

  it('still draws the map when nothing is out there, and says why the list is empty', async () => {
    answers([], [])

    page()

    // The map is the page — an idle fleet is an empty map of Kampala, not
    // a card where a map should be.
    expect(await screen.findByTestId('fleet-map')).toBeInTheDocument()
    expect(screen.getByText('Nothing is out there')).toBeInTheDocument()
  })

  it('keeps the trips when the pool is refused, and stops asking for it', async () => {
    // A corporate client's user: /driver-presence is 403 for them by design
    // (the riders are Shanitah's) and the page must not treat that as a
    // fault — or ask again every ten seconds.
    answers([position()], 'forbidden')
    vi.useFakeTimers({ shouldAdvanceTime: true })

    page()

    expect(await screen.findByTestId('fleet-map')).toHaveTextContent('1 markers')
    expect(screen.queryByText('The map may be out of date')).not.toBeInTheDocument()

    const asked = get.mock.calls.filter(([url]) => url === '/driver-presence').length
    await vi.advanceTimersByTimeAsync(POLL_MS)
    await waitFor(() => {
      expect(get.mock.calls.filter(([url]) => (url as string).startsWith('/live-positions')).length).toBeGreaterThan(1)
    })

    expect(get.mock.calls.filter(([url]) => url === '/driver-presence').length).toBe(asked)
  })

  it('shows a refused client the anonymized pool instead — categories, never names', async () => {
    // The riders are Shanitah's (security-gate F2): /driver-presence
    // answers a client 403, and the page switches to the public anonymized
    // read — the same vehicles as silhouettes, nothing as names.
    answers([position()], 'forbidden', [
      { key: 'abc123def456', category: 'boda', kind: 'boda', latitude: 0.35, longitude: 32.59, age_seconds: 12 },
    ])

    page()

    expect(await screen.findByText('Boda')).toBeInTheDocument()
    expect(screen.getByText('Waiting for work')).toBeInTheDocument()
    expect(screen.getByTestId('fleet-map')).toHaveTextContent('2 markers')
    // Their own trip still shows, fully named — it is theirs.
    expect(screen.getByText('Grace Nakato')).toBeInTheDocument()
    expect(screen.queryByText('The map may be out of date')).not.toBeInTheDocument()
  })

  it('puts the unit nobody has heard from at the top of the list', async () => {
    answers(
      [
        position({ vehicle_id: 1, speed_kph: 55 }),
        position({
          vehicle_id: 2,
          stale: true,
          age_seconds: 900,
          vehicle: { id: 2, registration_number: 'UBB 111A', make: null, model: null },
        }),
      ],
      [waitingDriver()],
    )

    page()

    await screen.findByTestId('fleet-map')

    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('UBB 111A')
    expect(rows[0]).toHaveTextContent('Not reporting')
    // The pool is context, not an alarm: it goes last.
    expect(rows[rows.length - 1]).toHaveTextContent('Waiting for work')
  })

  it('filters the list by the chips and finds a plate typed in a hurry', async () => {
    answers([position()], [waitingDriver()])
    const user = userEvent.setup()

    page()
    await screen.findByTestId('fleet-map')

    await user.click(screen.getByRole('button', { name: /^Waiting/ }))
    expect(screen.queryByText('Grace Nakato')).not.toBeInTheDocument()
    expect(screen.getByText('Okello Denis')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^All/ }))
    await user.type(screen.getByRole('textbox', { name: 'Search the fleet' }), 'ubk421h')
    expect(screen.getByText('Grace Nakato')).toBeInTheDocument()
    expect(screen.queryByText('Okello Denis')).not.toBeInTheDocument()
  })

  it('unfolds the selected unit with its route, its client and the door to the trip', async () => {
    answers([position()], [])
    const user = userEvent.setup()

    page()
    await screen.findByTestId('fleet-map')

    await user.click(screen.getByRole('button', { name: /UBK 421H/ }))

    expect(screen.getByText('Kampala Road → Entebbe Airport')).toBeInTheDocument()
    expect(screen.getByText('Centenary Bank', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open trip #10/ })).toHaveAttribute('href', '/trips/10')
  })

  it('says a never-reported driver has nothing to draw, rather than inventing a place', async () => {
    answers(
      [],
      [waitingDriver({ latitude: null, longitude: null, age_seconds: null, recorded_at: null, stale: true })],
    )
    const user = userEvent.setup()

    page()
    await screen.findByTestId('fleet-map')
    expect(screen.getByTestId('fleet-map')).toHaveTextContent('0 markers')

    await user.click(screen.getByRole('button', { name: /Okello Denis/ }))
    expect(screen.getByText('Never reported — nothing to draw')).toBeInTheDocument()
    expect(screen.getByText('No position')).toBeInTheDocument()
  })

  it('keeps the markers on screen when a refresh fails', async () => {
    // A dropped request is not evidence the fleet vanished. Blanking the map
    // on every blip would make it useless on a bad connection — and a
    // dispatcher would read the blank as "everything stopped".
    answers([position()], [])
    vi.useFakeTimers({ shouldAdvanceTime: true })

    page()
    expect(await screen.findByTestId('fleet-map')).toHaveTextContent('1 markers')

    get.mockRejectedValue(new Error('offline'))
    await vi.advanceTimersByTimeAsync(POLL_MS)

    await waitFor(() => expect(screen.getByText('The map may be out of date')).toBeInTheDocument())
    expect(screen.getByTestId('fleet-map')).toHaveTextContent('1 markers')
  })

  it('polls while the tab is visible', async () => {
    answers([position()], [])
    vi.useFakeTimers({ shouldAdvanceTime: true })

    page()
    await waitFor(() => expect(tripPolls()).toBe(1))

    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(tripPolls()).toBe(2)
  })

  it('stops asking while the tab is hidden, and refreshes at once on return', async () => {
    // A dispatcher leaves this open all day behind other windows. Without
    // the visibility check, 200 dashboards spend the night asking where a
    // fleet that stopped at six is.
    answers([position()], [])
    vi.useFakeTimers({ shouldAdvanceTime: true })

    page()
    await waitFor(() => expect(tripPolls()).toBe(1))

    hide()
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(tripPolls()).toBe(1)

    show()
    // Immediately, not one interval later: coming back to a map showing
    // where things were half a minute ago is when it is most misleading.
    await waitFor(() => expect(tripPolls()).toBe(2))
  })

  it('stops polling once the page is closed', async () => {
    answers([position()], [])
    vi.useFakeTimers({ shouldAdvanceTime: true })

    const view = page()
    await waitFor(() => expect(tripPolls()).toBe(1))

    view.unmount()
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)

    expect(tripPolls()).toBe(1)
  })
})

function tripPolls(): number {
  return get.mock.calls.filter(([url]) => (url as string).startsWith('/live-positions')).length
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

const hide = () => setVisibility('hidden')
const show = () => setVisibility('visible')
