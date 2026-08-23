import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, renderAs } from '../../test/harness'
import type { DistanceReportRow, DistanceReportSummary } from '../../types/report'
import { DistanceReport } from './DistanceReport'

vi.mock('../../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

const { apiClient } = await import('../../lib/apiClient')
const get = vi.mocked(apiClient.get)

beforeEach(() => {
  vi.clearAllMocks()
})

function summary(overrides: Partial<DistanceReportSummary> = {}): DistanceReportSummary {
  return {
    resolved: 3,
    unresolved: 0,
    grades: { A: 2, B: 0, C: 1, U: 0 },
    providers: { osrm: 3, haversine: 0 },
    no_trace: 1,
    no_reference: 1,
    variance_flagged: 1,
    with_mock_pings: 0,
    mean_coverage_percent: 66.7,
    mean_inferred_share_percent: 0,
    coverage: { under_50: 1, '50_to_80': 0, '80_to_95': 0, '95_up': 2, unknown: 0 },
    trace_vs_odometer: { within_5: 1, '5_to_15': 0, '15_to_30': 0, over_30: 1, unknown: 1 },
    trace_vs_route: { within_5: 2, '5_to_15': 0, '15_to_30': 0, over_30: 0, unknown: 1 },
    ...overrides,
  }
}

function row(overrides: Partial<DistanceReportRow> = {}): DistanceReportRow {
  return {
    trip_id: 41,
    tenant_id: 1,
    origin: 'Kampala',
    destination: 'Entebbe',
    completed_at: '2026-08-18T09:30:00Z',
    driver_name: 'Aisha N.',
    vehicle_registration: 'UBA 123X',
    resolved_at: '2026-08-18T09:32:00Z',
    policy: 'gps_primary',
    grade: 'A',
    billed_km: 50,
    reason: 'Measured 50.00 km from a trusted trace; reference route 50.00 km agrees.',
    odometer_km: 50,
    gps_km: 50,
    matched_km: 50,
    inferred_km: 0,
    route_km: 50,
    reference_source: 'trace',
    coverage_percent: 100,
    inferred_share_percent: 0,
    pings_total: 201,
    pings_kept: 201,
    provider: 'osrm',
    variance_flagged: false,
    ...overrides,
  }
}

function meta(overrides: Partial<DistanceReportSummary> = {}, next: string | null = null) {
  return {
    cursor: { next },
    summary: summary(overrides),
    scope: 'platform',
    covers: 'All clients',
    filters: { clients: [] },
  }
}

describe('DistanceReport', () => {
  it('renders the grade tiles, the distributions and a row per trip from the server', async () => {
    get.mockResolvedValue(
      apiOk([row(), row({ trip_id: 42, grade: 'C', gps_km: null, provider: 'haversine' })], meta()),
    )

    renderAs(<DistanceReport from="2026-08-01" to="2026-08-31" client="" reloadToken={0} />)

    expect(await screen.findByText('Trips resolved')).toBeVisible()
    // The tile label and the row badge both carry letter and word together
    // (never colour alone), so each grade appears at least twice.
    expect(screen.getAllByText('A · GPS-verified').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('C · Held').length).toBeGreaterThanOrEqual(2)
    // Shares are computed from the server's counts, never invented.
    expect(screen.getByText(/67% of resolved trips/)).toBeVisible()
    expect(screen.getByText('Where the trace sits')).toBeVisible()
    expect(screen.getByText('Trace against the odometer')).toBeVisible()
    expect(screen.getByText('#41')).toBeVisible()
    // A trip with no trace shows an em dash, not a zero.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    // The request carried the period and no client filter.
    expect(get.mock.calls.at(-1)?.[0]).toBe('/reports/distance?from=2026-08-01&to=2026-08-31')
  })

  it('says plainly when the engine is off, so a wall of C reads as unconfigured rather than fraudulent', async () => {
    get.mockResolvedValue(
      apiOk(
        [],
        meta({
          resolved: 5,
          grades: { A: 0, B: 0, C: 5, U: 0 },
          providers: { osrm: 0, haversine: 5 },
        }),
      ),
    )

    renderAs(<DistanceReport from="" to="" client="" reloadToken={0} />)

    expect(await screen.findByText('Off')).toBeVisible()
    expect(screen.getByText(/switch on trace matching once OSRM is self-hosted/)).toBeVisible()
  })

  it('warns when completed trips are sitting unresolved — the queue is not running', async () => {
    get.mockResolvedValue(apiOk([], meta({ unresolved: 7 })))

    renderAs(<DistanceReport from="" to="" client="" reloadToken={0} />)

    expect(
      await screen.findByText(/7 completed but not yet resolved — check the queue worker/),
    ).toBeVisible()
  })

  it('re-fetches with the grade and engine filters and the chosen client', async () => {
    get.mockResolvedValue(apiOk([], meta()))

    renderAs(<DistanceReport from="" to="" client="12" reloadToken={0} />)

    // Last call, not call count: the harness mounts under StrictMode, which
    // runs the effect twice on mount.
    await waitFor(() => expect(get.mock.calls.at(-1)?.[0]).toBe('/reports/distance?tenant_id=12'))

    await userEvent.selectOptions(await screen.findByLabelText('Grade'), 'C')
    await waitFor(() =>
      expect(get.mock.calls.at(-1)?.[0]).toBe('/reports/distance?tenant_id=12&grade=C'),
    )

    await userEvent.selectOptions(screen.getByLabelText('Engine'), 'haversine')
    await waitFor(() =>
      expect(get.mock.calls.at(-1)?.[0]).toBe(
        '/reports/distance?tenant_id=12&grade=C&provider=haversine',
      ),
    )
  })

  it('shows the empty state, and never a zero, when nothing has been resolved', async () => {
    get.mockResolvedValue(
      apiOk(
        [],
        meta({
          resolved: 0,
          grades: { A: 0, B: 0, C: 0, U: 0 },
          providers: { osrm: 0, haversine: 0 },
          mean_coverage_percent: null,
          coverage: { under_50: 0, '50_to_80': 0, '80_to_95': 0, '95_up': 0, unknown: 0 },
        }),
      ),
    )

    renderAs(<DistanceReport from="" to="" client="" reloadToken={0} />)

    expect(await screen.findByText('No resolved trips')).toBeVisible()
    // Mean coverage over nothing is a dash, not 0%; the engine over nothing
    // is a dash, not "Off".
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('0%')).toBeNull()
    expect(screen.queryByText('Off')).toBeNull()
  })

  it("shows the server's field explanation on a refusal, and the envelope message otherwise", async () => {
    get.mockRejectedValue(
      apiFailure(422, 'VALIDATION_FAILED', 'The given data was invalid.', {
        tenant_id: ['This filter is not recognized.'],
      }),
    )
    renderAs(<DistanceReport from="" to="" client="9" reloadToken={0} />)
    expect(await screen.findByText('This filter is not recognized.')).toBeVisible()
    expect(screen.queryByText('The given data was invalid.')).toBeNull()

    get.mockRejectedValue(apiFailure(500, 'SERVER_ERROR', 'Something went wrong on our end.', {}))
    renderAs(<DistanceReport from="" to="" client="" reloadToken={1} />)
    expect(await screen.findByText('Something went wrong on our end.')).toBeVisible()
  })
})
