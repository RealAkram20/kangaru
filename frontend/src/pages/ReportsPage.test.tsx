import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFailure, apiOk, makeUser, renderAs } from '../test/harness'
import type { TripReportRow, TripReportSummary } from '../types/report'
import { ReportsPage } from './ReportsPage'

vi.mock('../lib/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

const { apiClient } = await import('../lib/apiClient')
const get = vi.mocked(apiClient.get)

function row(overrides: Partial<TripReportRow> = {}): TripReportRow {
  return {
    trip_id: 41,
    booking_id: 12,
    status: 'trip_completed',
    commenced_at: '2026-07-21T08:14:22.000000Z',
    completed_at: '2026-07-21T09:20:22.000000Z',
    vehicle_registration: 'UAA 123A',
    vehicle_description: 'Toyota Hiace',
    driver_name: 'Moses Kato',
    origin: 'Kampala',
    destination: 'Entebbe',
    odometer_start: 41200,
    odometer_end: 41242,
    distance_km: '42.00',
    duration_minutes: 66,
    is_complete: true,
    ...overrides,
  } as TripReportRow
}

function summary(overrides: Partial<TripReportSummary> = {}): TripReportSummary {
  return {
    trips: 1,
    trips_completed: 1,
    distance_km: 42,
    duration_minutes: 66,
    records_incomplete: 0,
    completeness_percent: 100,
    ...overrides,
  }
}

/**
 * The page issues four different reads on mount: the report itself, the
 * vehicle and driver pickers, and ExportPanel's list of past exports. Each
 * is answered by shape rather than by a catch-all — feeding ExportPanel the
 * trip rows crashes it on a field they do not have, and because nothing
 * catches that, the whole page renders blank.
 */
function report(rows: TripReportRow[], meta: TripReportSummary | null = summary()) {
  get.mockImplementation((url: string) => {
    if (url.startsWith('/vehicles'))
      return Promise.resolve(apiOk([{ id: 7, registration_number: 'UAA 123A' }]))
    if (url.startsWith('/drivers')) return Promise.resolve(apiOk([{ id: 3, name: 'Moses Kato' }]))
    if (url.startsWith('/reports/exports')) return Promise.resolve(apiOk([]))
    if (url.startsWith('/reports/financial')) {
      return Promise.resolve(
        apiOk([], {
          summary: {
            invoiced_minor: 0,
            credited_minor: 0,
            outstanding_minor: 0,
            invoices: 0,
            credit_notes: 0,
            payments_recorded: false,
            periods: 0,
          },
        }),
      )
    }
    if (url.startsWith('/reports/drivers') || url.startsWith('/reports/vehicles')) {
      return Promise.resolve(apiOk([]))
    }

    return Promise.resolve(
      apiOk(
        rows,
        meta === null ? { cursor: { next: null } } : { cursor: { next: null }, summary: meta },
      ),
    )
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  report([row()])
})

describe('ReportsPage', () => {
  /**
   * PROJECT.md: "The Bank's six required data points appear on every trip
   * report." This is the column-level counterpart to the TripsPage test.
   */
  it('carries all six Bank data points as columns', async () => {
    renderAs(<ReportsPage />)

    await screen.findByText('#41')
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)

    expect(headers).toEqual(
      expect.arrayContaining([
        'Commenced',
        'Completed',
        'Vehicle',
        'Origin',
        'Destination',
        'Opening odo.',
        'Closing odo.',
        'Distance',
        'Duration',
      ]),
    )

    const line = screen.getByText('#41').closest('tr') as HTMLElement
    expect(within(line).getByText('UAA 123A')).toBeInTheDocument()
    expect(within(line).getByText('41,200')).toBeInTheDocument()
    expect(within(line).getByText('41,242')).toBeInTheDocument()
    expect(within(line).getByText('42.0 km')).toBeInTheDocument()
    expect(within(line).getByText('1h 6m')).toBeInTheDocument()
  })

  /**
   * A trip still on the road is not a deficient record — it has not
   * finished. Only a *completed* trip missing a required data point is a
   * compliance problem, and conflating the two would inflate the number a
   * bank is shown.
   */
  it('does not call an unfinished trip an incomplete record', async () => {
    report([
      row(),
      row({
        trip_id: 42,
        completed_at: null,
        odometer_end: null,
        distance_km: null,
        duration_minutes: null,
        is_complete: false,
      }),
      row({ trip_id: 43, odometer_end: null, is_complete: false }),
    ])

    renderAs(<ReportsPage />)

    await screen.findByText('#41')

    const line = (id: string) => screen.getByText(id).closest('tr') as HTMLElement

    expect(within(line('#41')).getByText('Complete')).toBeInTheDocument()
    expect(within(line('#42')).getByText('In progress')).toBeInTheDocument()
    expect(within(line('#43')).getByText('Incomplete')).toBeInTheDocument()
  })

  it('reports completeness against the Bank criterion, and names the shortfall', async () => {
    report(
      [row()],
      summary({ trips: 4, trips_completed: 3, records_incomplete: 1, completeness_percent: 67 }),
    )

    renderAs(<ReportsPage />)

    await screen.findByText('#41')

    expect(screen.getByText('67%')).toBeInTheDocument()
    expect(screen.getByText('1 missing a required data point')).toBeInTheDocument()
  })

  it('says nothing has completed rather than claiming 100%', async () => {
    report(
      [row()],
      summary({ trips: 2, trips_completed: 0, records_incomplete: 0, completeness_percent: null }),
    )

    renderAs(<ReportsPage />)

    await screen.findByText('#41')

    // Null is not 100 — a period in which nothing finished has no
    // completeness figure, and showing one would be an invented compliance
    // number.
    // Two levels: KPIStat puts the label and the value in sibling divs, so
    // the label's own parent is only the header row.
    const stat = screen.getByText('Records complete').parentElement?.parentElement as HTMLElement
    expect(within(stat).getByText('—')).toBeInTheDocument()
    expect(within(stat).queryByText('100%')).toBeNull()
  })

  it('does not re-query on every keystroke in a date field', async () => {
    const user = userEvent.setup()
    renderAs(<ReportsPage />)

    await screen.findByText('#41')
    const before = get.mock.calls.length

    await user.clear(screen.getByLabelText(/^From/))
    await user.type(screen.getByLabelText(/^From/), '2026-06-01')

    // A half-typed date range is not a range anybody meant to run.
    expect(get.mock.calls.length).toBe(before)

    await user.click(screen.getByRole('button', { name: /run report/i }))
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(before))
  })

  it('sends the vehicle and driver filters the pickers were populated with', async () => {
    const user = userEvent.setup()
    renderAs(<ReportsPage />)

    await screen.findByText('#41')

    await user.selectOptions(screen.getByLabelText(/^Vehicle/), '7')
    await user.click(screen.getByRole('button', { name: /run report/i }))

    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining('vehicle_id=7')))
  })

  /**
   * Only the financial report buckets by period; the server rejects
   * `group_by` on the others rather than ignoring it, so offering the
   * control elsewhere would be offering a 422.
   */
  it('offers Group by on the financial report and nowhere else', async () => {
    const user = userEvent.setup()
    renderAs(<ReportsPage />)

    await screen.findByText('#41')
    expect(screen.queryByLabelText(/^Group by/)).toBeNull()

    await user.selectOptions(screen.getByLabelText(/^Report/), 'financial')

    expect(screen.getByLabelText(/^Group by/)).toBeInTheDocument()
    // And the trip-only filters go away with it.
    expect(screen.queryByLabelText(/^Vehicle/)).toBeNull()
    expect(screen.queryByLabelText(/^Driver/)).toBeNull()
  })

  it('says a period is empty rather than showing a bare table', async () => {
    report(
      [],
      summary({
        trips: 0,
        trips_completed: 0,
        distance_km: 0,
        duration_minutes: 0,
        completeness_percent: null,
      }),
    )

    renderAs(<ReportsPage />)

    expect(await screen.findByText('No trips in this period')).toBeInTheDocument()
    expect(
      screen.getByText(/Widen the range or clear the vehicle and driver filters/i),
    ).toBeInTheDocument()
  })

  it('says so when a report cannot be run', async () => {
    report([row()])
    get.mockImplementation((url: string) =>
      url.startsWith('/reports/trips')
        ? Promise.reject(apiFailure(500, 'SERVER_ERROR', 'The report timed out.'))
        : Promise.resolve(apiOk([])),
    )

    renderAs(<ReportsPage />)

    const alert = (await screen.findByText('Report problem')).closest('div') as HTMLElement
    // Scoped to this alert: ExportPanel raises its own banner for its own
    // failures, and the two must not be read as one.
    expect(within(alert).getByText('The report timed out.')).toBeInTheDocument()
  })
})

/**
 * ADR-0007's client picker.
 *
 * The backend accepted `?tenant_id=` before this existed, which left a
 * platform Super Admin reading "Choose the client this financial report is
 * for" on a page with nothing that let them choose. These cover the control
 * that closed that gap.
 */
describe('ReportsPage client picker', () => {
  const platformUser = {
    tenant_id: null,
    role: 'super_admin' as const,
    email: 'sa@kangaruride.test',
  }

  /** Serves the scope block ADR-0007 added to every report response. */
  function reportAs(scope: 'platform' | 'tenant', clients: { value: number; label: string }[]) {
    get.mockImplementation((url: string) => {
      if (url.startsWith('/vehicles')) return Promise.resolve(apiOk([]))
      if (url.startsWith('/drivers')) return Promise.resolve(apiOk([]))
      if (url.startsWith('/reports/exports')) return Promise.resolve(apiOk([]))

      return Promise.resolve(
        apiOk([row()], {
          cursor: { next: null },
          summary: summary(),
          scope,
          covers: scope === 'platform' ? 'All clients' : 'Centenary Bank',
          filters: { clients },
        }),
      )
    })
  }

  it('offers a platform reader the clients the endpoint served', async () => {
    reportAs('platform', [
      { value: 2, label: 'Acme NGO' },
      { value: 1, label: 'Centenary Bank' },
    ])

    renderAs(<ReportsPage />, makeUser(platformUser))

    const picker = await screen.findByLabelText('Client')

    // The options come from the response, not from a list this page keeps —
    // a picker holding its own copy is one that falls behind the list the
    // endpoint will actually accept.
    expect(within(picker).getByRole('option', { name: 'Centenary Bank' })).toBeInTheDocument()
    expect(within(picker).getByRole('option', { name: 'Acme NGO' })).toBeInTheDocument()
    expect(within(picker).getByRole('option', { name: 'All clients' })).toBeInTheDocument()
  })

  it("shows a client's own user no picker at all", async () => {
    // The endpoint serves them an empty option list, because they have
    // exactly one client and it was never a choice.
    reportAs('tenant', [])

    renderAs(<ReportsPage />)

    await screen.findByText('#41')
    expect(screen.queryByLabelText('Client')).toBeNull()
  })

  it('narrows the trip report to the chosen client, server-side', async () => {
    reportAs('platform', [{ value: 1, label: 'Centenary Bank' }])

    renderAs(<ReportsPage />, makeUser(platformUser))

    await userEvent.selectOptions(await screen.findByLabelText('Client'), '1')
    await userEvent.click(screen.getByRole('button', { name: /Run report/i }))

    // Server-side: the rows for another client were never fetched. A
    // client-side filter would be a wrong answer rather than a slow one,
    // and on an aggregate it would be a wrong *number*.
    await waitFor(() =>
      expect(get.mock.calls.some(([url]) => String(url).includes('tenant_id=1'))).toBe(true),
    )
  })

  it('prompts rather than offering "all clients" on the financial report', async () => {
    reportAs('platform', [{ value: 1, label: 'Centenary Bank' }])

    renderAs(<ReportsPage />, makeUser(platformUser))

    await userEvent.selectOptions(await screen.findByLabelText('Report'), 'financial')

    // ADR-0007 refuses a cross-client total, so there is no all-clients
    // answer to offer here. Labelling the empty option "All clients" would
    // advertise something the server declines with a 422.
    const picker = await screen.findByLabelText('Client')
    expect(within(picker).getByRole('option', { name: 'Choose a client…' })).toBeInTheDocument()
    expect(within(picker).queryByRole('option', { name: 'All clients' })).toBeNull()
  })

  it('offers no client picker on the driver and vehicle reports', async () => {
    reportAs('platform', [{ value: 1, label: 'Centenary Bank' }])

    renderAs(<ReportsPage />, makeUser(platformUser))

    await userEvent.selectOptions(await screen.findByLabelText('Report'), 'drivers')

    // These aggregate a fleet that is Shanitah's (ADR-0005) and take no
    // tenant_id. A control that answers 422 is a dead end, not a feature.
    await waitFor(() => expect(screen.queryByLabelText('Client')).toBeNull())
  })
})

/**
 * ADR-0007 rule 5's on-screen half: "a report that spans clients must say
 * so on screen and in the exported file".
 *
 * The file header landed first, because that is the document that travels.
 * This is the screen, and it matters because the picker communicates scope
 * only implicitly — a reader arriving at a page somebody else left open has
 * no other way to tell whose totals they are reading.
 */
describe('ReportsPage scope notice', () => {
  const platformUser = {
    tenant_id: null,
    role: 'super_admin' as const,
    email: 'sa@kangaruride.test',
  }

  function reportCovering(
    scope: 'platform' | 'tenant',
    covers: string,
    summaryOverrides: Partial<TripReportSummary> = {},
  ) {
    get.mockImplementation((url: string) => {
      if (url.startsWith('/vehicles') || url.startsWith('/drivers'))
        return Promise.resolve(apiOk([]))
      if (url.startsWith('/reports/exports')) return Promise.resolve(apiOk([]))

      return Promise.resolve(
        apiOk([row()], {
          cursor: { next: null },
          summary: summary(summaryOverrides),
          scope,
          covers,
          filters: { clients: [{ value: 1, label: 'Centenary Bank' }] },
        }),
      )
    })
  }

  it('says the figures span every client when they do', async () => {
    reportCovering('platform', 'All clients')

    renderAs(<ReportsPage />, makeUser(platformUser))

    expect(await screen.findByText(/Figures cover/)).toBeVisible()
    expect(screen.getByText('every client')).toBeVisible()
  })

  it('names the client when the report is narrowed to one', async () => {
    reportCovering('platform', 'Centenary Bank')

    renderAs(<ReportsPage />, makeUser(platformUser))

    await screen.findByText(/Figures cover/)
    expect(screen.getByText('Centenary Bank', { selector: 'strong' })).toBeVisible()
  })

  it('stays quiet for a client reading their own report', async () => {
    // Naming their own company on every panel is noise, not information —
    // they have one client and never had a choice.
    reportCovering('tenant', 'Centenary Bank')

    renderAs(<ReportsPage />)

    await screen.findByText('#41')
    expect(screen.queryByText(/Figures cover/)).toBeNull()
  })

  /**
   * ADR-0007's Consequences, which the first implementation pass left
   * undone: PROJECT.md's success metric is "all six data points on 100% of
   * completed trips" **per client**. Spanning makes the figure a platform
   * average, which is a different claim, and unlabelled it reads as the
   * metric it is not.
   */
  it('labels completeness as an average when the report spans clients', async () => {
    reportCovering('platform', 'All clients', { records_incomplete: 3 })

    renderAs(<ReportsPage />, makeUser(platformUser))

    expect(await screen.findByText(/averaged across every client/)).toBeVisible()
  })

  it("leaves completeness unqualified for one client's figures", async () => {
    reportCovering('platform', 'Centenary Bank', { records_incomplete: 3 })

    renderAs(<ReportsPage />, makeUser(platformUser))

    await screen.findByText(/Figures cover/)
    expect(screen.queryByText(/averaged across every client/)).toBeNull()
    expect(screen.getByText(/3 missing a required data point/)).toBeVisible()
  })
})
