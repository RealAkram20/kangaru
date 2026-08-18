import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, renderAs } from '../test/harness'
import type { DistanceEvidence, HeldTrip } from '../types/trip'
import { DistanceReviewPage } from './DistanceReviewPage'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)

beforeEach(() => {
  vi.clearAllMocks()
})

function held(overrides: Partial<HeldTrip> = {}): HeldTrip {
  return {
    trip_id: 41,
    tenant_id: 1,
    client: 'Centenary Bank',
    origin: 'Kampala',
    destination: 'Entebbe',
    completed_at: '2026-08-15T09:30:00Z',
    driver_name: 'Aisha N.',
    vehicle_registration: 'UBA 123X',
    grade: 'C',
    grade_label: 'held for review',
    billed_km: 62.5,
    odometer_km: 100,
    resolved_at: '2026-08-15T09:32:00Z',
    waiting_days: 3,
    is_walk_in: false,
    fare_settled: false,
    ...overrides,
  }
}

function evidence(overrides: Partial<DistanceEvidence> = {}): DistanceEvidence {
  return {
    id: 7,
    resolved_at: '2026-08-15T09:32:00Z',
    policy: 'gps_primary',
    grade: 'C',
    grade_label: 'held for review',
    billed_km: 62.5,
    reason:
      'Trace not trusted: 1 mock-location ping(s); odometer 100.00 km clamped to 62.50 km by the corridor 45.00–62.50 km around reference route 50.00 km.',
    odometer_km: 100,
    gps_km: 48,
    matched_km: 40,
    inferred_km: 8,
    haversine_km: 47,
    route_km: 50,
    reference_source: 'pins',
    coverage_percent: 92,
    inferred_share_percent: 16.7,
    pings_total: 201,
    pings_kept: 200,
    gaps_routed: 1,
    dropped: { mock: 1, accuracy: 0, duplicate: 0, teleport: 0, jitter: 0 },
    provider: 'osrm',
    matched_polylines: ['abc'],
    thresholds: { minCoveragePercent: 80 },
    ...overrides,
  }
}

/** The queue's own payload, meta included. */
function queue(rows: HeldTrip[], total = rows.length, next: string | null = null) {
  return apiOk(rows, { cursor: { next }, total })
}

describe('DistanceReviewPage', () => {
  it('lists what is waiting, how long, and the two figures a reviewer compares', async () => {
    get.mockResolvedValue(
      queue([
        held(),
        held({
          trip_id: 42,
          waiting_days: 0,
          grade: 'U',
          grade_label: 'unverified',
          billed_km: 12,
          odometer_km: 13,
        }),
      ]),
    )

    renderAs(<DistanceReviewPage />)

    expect(await screen.findByText('Waiting on review')).toBeVisible()
    expect(screen.getByText('#41')).toBeVisible()
    // Grade carries its letter *and* its word — never colour alone.
    expect(screen.getByText('C · held for review')).toBeVisible()
    expect(screen.getByText('U · unverified')).toBeVisible()
    // The comparison the decision turns on, on both rows.
    expect(screen.getByText('62.5 km')).toBeVisible()
    expect(screen.getByText('100.0 km')).toBeVisible()
    expect(screen.getByText('12.0 km')).toBeVisible()
    // On both rows — the fixture's default client.
    expect(screen.getAllByText('Centenary Bank')).toHaveLength(2)
    expect(get.mock.calls.at(-1)?.[0]).toBe('/trips/distance-review')
  })

  it('flags a wait past the two-business-day promise, and says today is today', async () => {
    get.mockResolvedValue(
      queue([held({ waiting_days: 5 }), held({ trip_id: 42, waiting_days: 0 })]),
    )

    renderAs(<DistanceReviewPage />)

    // Twice over: the row's badge and the tile above it — the tile is the
    // figure the two-business-day metric is actually about.
    expect(await screen.findAllByText('5 days')).toHaveLength(2)
    expect(screen.getByText('Today')).toBeVisible()
    expect(screen.getByText('Longest wait')).toBeVisible()
  })

  it('takes the backlog size from the server rather than counting the page', async () => {
    // Twenty-five rows on screen, forty in the queue: a reviewer must not
    // read the page as the whole of it.
    get.mockResolvedValue(queue([held()], 40, 'cursor-2'))

    renderAs(<DistanceReviewPage />)

    expect(await screen.findByText('40')).toBeVisible()
  })

  it('shows the evidence in the dialog, above the reason box', async () => {
    // A clearance overrules the resolver; a reviewer who must leave the
    // screen to see what they are overruling will stop looking.
    get.mockImplementation(
      (url: string) =>
        Promise.resolve(
          url.includes('/distance') && !url.includes('distance-review')
            ? apiOk([evidence()])
            : queue([held()]),
        ) as never,
    )

    renderAs(<DistanceReviewPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))

    expect(await screen.findByText(/Trace not trusted/)).toBeVisible()
    expect(screen.getByText('Measured trace')).toBeVisible()
    expect(screen.getByText(/40.0 km matched to roads/)).toBeVisible()
    expect(screen.getByText('Reference route')).toBeVisible()
    expect(screen.getByText(/Dropped: mock 1/)).toBeVisible()
    expect(screen.getByLabelText(/Why is this being cleared/)).toBeVisible()
  })

  it('will not submit a reason too short to be a reason', async () => {
    get.mockImplementation(
      (url: string) =>
        Promise.resolve(
          url.includes('/distance') && !url.includes('distance-review')
            ? apiOk([evidence()])
            : queue([held()]),
        ) as never,
    )

    renderAs(<DistanceReviewPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))

    const clear = await screen.findByRole('button', { name: /Clear and allow billing/ })
    expect(clear).toBeDisabled()

    await userEvent.type(screen.getByLabelText(/Why is this being cleared/), 'ok')
    expect(clear).toBeDisabled()

    await userEvent.type(
      screen.getByLabelText(/Why is this being cleared/),
      ' — checked the trace with the driver',
    )
    expect(clear).toBeEnabled()
  })

  it('clears a trip, says what that means for it, and reloads from the server', async () => {
    get.mockImplementation(
      (url: string) =>
        Promise.resolve(
          url.includes('/distance') && !url.includes('distance-review')
            ? apiOk([evidence()])
            : queue([held({ is_walk_in: true, client: null })]),
        ) as never,
    )
    post.mockResolvedValue(apiOk({}) as never)

    renderAs(<DistanceReviewPage />)
    await screen.findByText('Waiting on review')
    const mountCalls = get.mock.calls.filter(([url]) => url === '/trips/distance-review').length

    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))
    await userEvent.type(
      await screen.findByLabelText(/Why is this being cleared/),
      'Reviewed the trace; the passenger asked for a long way round.',
    )
    await userEvent.click(screen.getByRole('button', { name: /Clear and allow billing/ }))

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/trips/41/distance/clearance', {
        reason: 'Reviewed the trace; the passenger asked for a long way round.',
      }),
    )

    // A walk-in's clearance settles a driver's pay, which is not the same
    // sentence as a corporate trip becoming invoiceable.
    expect(await screen.findByText(/fare settles on the figure you saw/)).toBeVisible()
    // Reloaded rather than spliced: the count and the rows both come from
    // the server, and inventing the new state is how the two drift apart.
    // Counted as "more than the mount asked for" rather than exactly two —
    // the harness renders under StrictMode, which mounts twice.
    await waitFor(() =>
      expect(
        get.mock.calls.filter(([url]) => url === '/trips/distance-review').length,
      ).toBeGreaterThan(mountCalls),
    )
  })

  it('says nothing is held rather than showing an empty table', async () => {
    get.mockResolvedValue(queue([], 0))

    renderAs(<DistanceReviewPage />)

    expect(await screen.findByText('Nothing is waiting on a review')).toBeVisible()
    expect(screen.getByText(/Nothing is held/)).toBeVisible()
    // No invented longest wait over an empty queue, and no zero standing in
    // for it (`docs/screen-rules.md` §1).
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.queryByText('0 days')).toBeNull()
  })

  it("shows the server's message when the queue cannot be loaded", async () => {
    get.mockRejectedValue(apiFailure(500, 'SERVER_ERROR', 'Something went wrong on our end.', {}))

    renderAs(<DistanceReviewPage />)

    expect(await screen.findByText('Something went wrong on our end.')).toBeVisible()
  })
})
