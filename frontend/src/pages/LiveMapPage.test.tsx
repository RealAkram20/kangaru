import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveMapPage } from './LiveMapPage'
import { apiClient } from '../lib/apiClient'
import { POLL_MS } from '../lib/livePositions'
import type { LivePosition } from '../types/livePosition'

/**
 * The page, not the map. MapLibre needs a WebGL context jsdom does not
 * have, so `FleetMap` is replaced by a stub that records what it was given
 * — which is the only thing this page owes it. The marker arithmetic is
 * tested in `lib/livePositions.test.ts`, where it can be tested properly.
 */
const drawn = vi.fn()

vi.mock('../components/map/FleetMap', () => ({
  FleetMap: (props: { positions: LivePosition[] }) => {
    drawn(props.positions)
    return <div data-testid="fleet-map">{props.positions.length} markers</div>
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
    ...overrides,
  }
}

function answers(positions: LivePosition[]) {
  get.mockResolvedValue({ data: { success: true, message: '', data: positions } } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  drawn.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('LiveMapPage', () => {
  it('draws the fleet it is given', async () => {
    answers([position({ vehicle_id: 7 }), position({ vehicle_id: 8, speed_kph: 0 })])

    render(<LiveMapPage />)

    expect(await screen.findByTestId('fleet-map')).toHaveTextContent('2 markers')
    expect(await screen.findByText('#7')).toBeInTheDocument()
  })

  it('says nothing is moving rather than showing an empty map', async () => {
    answers([])

    render(<LiveMapPage />)

    expect(await screen.findByText('Nothing is moving')).toBeInTheDocument()
    expect(screen.queryByTestId('fleet-map')).not.toBeInTheDocument()
  })

  it('puts the vehicle nobody has heard from at the top of the list', async () => {
    answers([
      position({ vehicle_id: 1, speed_kph: 55 }),
      position({ vehicle_id: 2, stale: true, age_seconds: 900 }),
    ])

    render(<LiveMapPage />)

    await screen.findByTestId('fleet-map')

    const rows = screen.getAllByRole('row').slice(1) // drop the header
    expect(rows[0]).toHaveTextContent('#2')
    expect(rows[0]).toHaveTextContent('Not reporting')
  })

  it('counts what is not reporting in the card subtitle', async () => {
    answers([position({ vehicle_id: 1 }), position({ vehicle_id: 2, stale: true })])

    render(<LiveMapPage />)

    expect(await screen.findByText('2 on the road · 1 not reporting')).toBeInTheDocument()
  })

  it('keeps the markers on screen when a refresh fails', async () => {
    // A dropped request is not evidence the fleet vanished. Blanking the map
    // on every blip would make it useless on a bad connection — and a
    // dispatcher would read the blank as "everything stopped".
    answers([position({ vehicle_id: 3 })])
    vi.useFakeTimers({ shouldAdvanceTime: true })

    render(<LiveMapPage />)
    expect(await screen.findByTestId('fleet-map')).toHaveTextContent('1 markers')

    get.mockRejectedValue(new Error('offline'))
    await vi.advanceTimersByTimeAsync(POLL_MS)

    // `role="status"`, not `role="alert"`: a failed refresh is polite news.
    // Interrupting a dispatcher mid-assignment because one poll timed out
    // would be the banner shouting louder than the problem.
    await waitFor(() =>
      expect(screen.getByText('Positions may be out of date')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('fleet-map')).toHaveTextContent('1 markers')
  })

  it('polls while the tab is visible', async () => {
    answers([position()])
    vi.useFakeTimers({ shouldAdvanceTime: true })

    render(<LiveMapPage />)
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('stops asking while the tab is hidden, and refreshes at once on return', async () => {
    // A dispatcher leaves this open all day behind other windows. Without
    // the visibility check, 200 dashboards spend the night asking where a
    // fleet that stopped at six is.
    answers([position()])
    vi.useFakeTimers({ shouldAdvanceTime: true })

    render(<LiveMapPage />)
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))

    hide()
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(get).toHaveBeenCalledTimes(1)

    show()
    // Immediately, not one interval later: coming back to a map showing
    // where things were half a minute ago is when it is most misleading.
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  })

  it('stops polling once the page is closed', async () => {
    answers([position()])
    vi.useFakeTimers({ shouldAdvanceTime: true })

    const view = render(<LiveMapPage />)
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))

    view.unmount()
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)

    expect(get).toHaveBeenCalledTimes(1)
  })
})

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

const hide = () => setVisibility('hidden')
const show = () => setVisibility('visible')
