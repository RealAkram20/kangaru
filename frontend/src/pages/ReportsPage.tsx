import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { canViewInvoices } from '../lib/billing'
import { apiClient } from '../lib/apiClient'
import { apiError } from '../lib/apiError'
import { formatTimestamp } from '../lib/format'
import { formatDistance, formatDuration, formatOdometer } from '../lib/tripStatus'
import type { ApiSuccess, FilterOption, TenancyScope } from '../types/api'
import type { Driver } from '../types/driver'
import type {
  FinancialPeriod,
  ReportType,
  TripReportFilters,
  TripReportMeta,
  TripReportRow,
  TripReportSummary,
} from '../types/report'
import type { Vehicle } from '../types/vehicle'
import { ExportPanel } from './reports/ExportPanel'
import { FinancialReport } from './reports/FinancialReport'
import { FleetReport } from './reports/FleetReport'
import { ReportScopeNotice } from './reports/ReportScopeNotice'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { Identifier } from '../components/core/Identifier'
import { ClientFilterSelect } from '../components/filters/ClientFilterSelect'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { KPIStat } from '../components/data/KPIStat'
import { Alert } from '../components/feedback/Alert'
import { EmptyState } from '../components/feedback/EmptyState'
import { PanelBoundary } from '../components/feedback/PanelBoundary'
import { FormField } from '../components/forms/FormField'
import { Input } from '../components/forms/Input'
import { Select } from '../components/forms/Select'

/**
 * DataTable keys its rows off `id`. The report's natural key is `trip_id`,
 * and adding a duplicate `id` to the API resource purely to satisfy a table
 * component would be the tail wagging the dog — so it is attached here.
 */
type ReportTableRow = TripReportRow & { id: number }

const COLUMNS: DataColumn<ReportTableRow>[] = [
  {
    key: 'trip_id',
    header: 'Trip',
    render: (row) => <Identifier size="xs">#{row.trip_id}</Identifier>,
  },
  // 1. Date and time of commencement and completion.
  {
    key: 'commenced_at',
    header: 'Commenced',
    render: (row) => (row.commenced_at ? formatTimestamp(row.commenced_at) : '—'),
  },
  {
    key: 'completed_at',
    header: 'Completed',
    render: (row) => (row.completed_at ? formatTimestamp(row.completed_at) : '—'),
  },
  // 2. Vehicle registration details.
  {
    key: 'vehicle_registration',
    header: 'Vehicle',
    render: (row) =>
      row.vehicle_registration ? (
        <Identifier kind="plate" size="xs">
          {row.vehicle_registration}
        </Identifier>
      ) : (
        '—'
      ),
  },
  { key: 'driver_name', header: 'Driver', render: (row) => row.driver_name ?? '—' },
  // 3. Trip origin and destination.
  { key: 'origin', header: 'Origin' },
  { key: 'destination', header: 'Destination' },
  // 4. Opening and closing odometer readings.
  {
    key: 'odometer_start',
    header: 'Opening odo.',
    numeric: true,
    render: (row) => formatOdometer(row.odometer_start),
  },
  {
    key: 'odometer_end',
    header: 'Closing odo.',
    numeric: true,
    render: (row) => formatOdometer(row.odometer_end),
  },
  // 5. Total distance travelled.
  {
    key: 'distance_km',
    header: 'Distance',
    numeric: true,
    render: (row) => formatDistance(row.distance_km),
  },
  // 6. Trip duration.
  {
    key: 'duration_minutes',
    header: 'Duration',
    numeric: true,
    render: (row) => formatDuration(row.duration_minutes),
  },
  {
    key: 'is_complete',
    header: 'Record',
    render: (row) => {
      // A trip still on the road is not a deficient record — it simply has
      // not finished. Only a *completed* trip missing a required data point
      // is a compliance problem, which is the same line the summary's
      // completeness figure draws.
      if (row.completed_at === null) {
        return (
          <Badge tone="info" size="sm" icon="loader-circle">
            In progress
          </Badge>
        )
      }

      return row.is_complete ? (
        <Badge tone="success" size="sm" icon="circle-check">
          Complete
        </Badge>
      ) : (
        <Badge tone="warning" size="sm" icon="triangle-alert">
          Incomplete
        </Badge>
      )
    },
  },
]

/** Defaults to the current calendar month — the billing period. */
function currentMonth(): { from: string; to: string } {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const first = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)

  return {
    from: first,
    to: `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`,
  }
}

function toQuery(filters: TripReportFilters, client: string): string {
  const params = new URLSearchParams()
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.vehicle_id) params.set('vehicle_id', filters.vehicle_id)
  if (filters.driver_id) params.set('driver_id', filters.driver_id)
  // ADR-0007. Only platform staff may send it — the endpoint refuses it
  // from a client's own user, who has one tenant and never had a choice.
  // `''` is every client, which is what the picker's empty option means.
  if (client) params.set('tenant_id', client)

  return params.toString()
}

async function fetchReport(filters: TripReportFilters, client: string) {
  const response = await apiClient.get<ApiSuccess<TripReportRow[], TripReportMeta>>(
    `/reports/trips?${toQuery(filters, client)}`,
  )

  return {
    rows: response.data.data,
    summary: response.data.meta?.summary ?? null,
    // Defaulted the safe way, as the queues do: an API that does not send
    // it is one client's report, so no picker is offered rather than one
    // offered with nothing behind it.
    scope: response.data.meta?.scope ?? 'tenant',
    clients: response.data.meta?.filters?.clients ?? [],
    covers: response.data.meta?.covers,
  }
}

/** PROJECT.md's four Phase 1 reports, in the order it lists them. */
const REPORTS: { value: ReportType; subtitle: string }[] = [
  { value: 'trips', subtitle: 'Every trip that commenced in the selected period' },
  { value: 'drivers', subtitle: 'Every driver who commenced a trip in the selected period' },
  { value: 'vehicles', subtitle: 'Every vehicle that commenced a trip in the selected period' },
  { value: 'financial', subtitle: 'Invoiced, credited and outstanding per period' },
]

const REPORT_LABELS: Record<ReportType, string> = {
  trips: 'Trip report',
  drivers: 'Driver report',
  vehicles: 'Vehicle report',
  financial: 'Financial report',
}

const GROUP_BY: { value: FinancialPeriod; label: string }[] = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'year', label: 'Annually' },
]

export function ReportsPage() {
  const { user } = useAuth()
  const month = currentMonth()
  // The financial report needs `invoices.view` as well as `reports.view`,
  // so it is not offered to a Dispatcher or Fleet Owner — the server
  // refuses it, and a picker entry that answers 403 is a dead end rather
  // than a feature.
  const available = useMemo(
    () => REPORTS.filter((r) => r.value !== 'financial' || canViewInvoices(user)),
    [user],
  )
  const [report, setReport] = useState<ReportType>('trips')
  // Bumped by Run report, so the aggregate reports re-fetch on demand
  // rather than on every keystroke in a date field.
  const [fleetToken, setFleetToken] = useState(0)
  const [filters, setFilters] = useState<TripReportFilters>({
    from: month.from,
    to: month.to,
    vehicle_id: '',
    driver_id: '',
    // PROJECT.md and AGENTS.md both describe billing as a monthly cycle,
    // so that is the period a finance user arrives wanting.
    group_by: 'month',
  })
  const [rows, setRows] = useState<TripReportRow[] | null>(null)
  const [summary, setSummary] = useState<TripReportSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  // ADR-0007. Whether a client may be chosen at all is the API's answer,
  // not this page's — the same rule the bookings and trips queues follow,
  // so the reports do not become a fourth place the predicate lives.
  const [scope, setScope] = useState<TenancyScope>('tenant')
  const [clients, setClients] = useState<FilterOption[]>([])
  // Whose figures the rows on screen are of, in words — the same string the
  // exported file header carries, so the two cannot describe one report
  // differently (ADR-0007 rule 5).
  const [covers, setCovers] = useState<string | undefined>(undefined)
  // '' is every client. Kept out of `filters` because it is not a filter
  // the way a vehicle is: it decides whose figures these are, and on the
  // financial report the server refuses to answer without it.
  const [client, setClient] = useState('')

  const apply = useCallback(
    (result: {
      rows: TripReportRow[]
      summary: TripReportSummary | null
      scope: TenancyScope
      clients: FilterOption[]
      covers: string | undefined
    }) => {
      setRows(result.rows)
      setSummary(result.summary)
      setScope(result.scope)
      setClients(result.clients)
      setCovers(result.covers)
      setError(null)
    },
    [],
  )

  const run = useCallback(
    (next: TripReportFilters, forClient: string) =>
      fetchReport(next, forClient)
        .then(apply)
        .catch((failure: unknown) =>
          setError(apiError(failure, 'Could not run this report.').message),
        ),
    [apply],
  )

  useEffect(() => {
    let cancelled = false

    Promise.all([
      fetchReport(filters, client),
      apiClient.get<ApiSuccess<Vehicle[]>>('/vehicles'),
      apiClient.get<ApiSuccess<Driver[]>>('/drivers'),
    ])
      .then(([report, vehicleList, driverList]) => {
        if (cancelled) return
        apply(report)
        setVehicles(vehicleList.data.data)
        setDrivers(driverList.data.data)
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(apiError(failure, 'Could not run this report.').message)
      })

    return () => {
      cancelled = true
    }
    // Runs once; later changes go through the Run report button so a
    // half-typed date range does not fire a query on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apply])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error && (
        <Alert tone="error" title="Report problem" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card
        title={REPORT_LABELS[report]}
        subtitle={REPORTS.find((r) => r.value === report)?.subtitle ?? ''}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: 'var(--space-4)',
            alignItems: 'end',
          }}
        >
          <FormField label="Report" htmlFor="r-report">
            <Select
              id="r-report"
              value={report}
              onChange={(e) => setReport(e.target.value as ReportType)}
              options={available.map((r) => ({ value: r.value, label: REPORT_LABELS[r.value] }))}
            />
          </FormField>
          {/*
            Second, straight after the report itself, because it is the
            other question that decides what the numbers mean rather than
            merely how many of them there are. Renders nothing for a
            client's own user — they have one client and it was never a
            choice (ADR-0007).

            Not offered on the driver and vehicle reports: those aggregate
            a fleet that is Shanitah's since ADR-0005, the server takes no
            `tenant_id` on them, and a control that answers 422 is a dead
            end rather than a feature.
          */}
          {report !== 'drivers' && report !== 'vehicles' && (
            <FormField label="Client" htmlFor="r-client">
              <ClientFilterSelect
                scope={scope}
                clients={clients}
                value={client}
                onChange={setClient}
                width="100%"
                // The financial report has no all-clients answer to give:
                // ADR-0007 refuses to total across them, so the empty
                // option is a prompt rather than a choice. Saying "All
                // clients" here would offer something the server declines.
                allLabel={report === 'financial' ? 'Choose a client…' : 'All clients'}
              />
            </FormField>
          )}
          <FormField label="From" htmlFor="r-from">
            <Input
              id="r-from"
              type="date"
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            />
          </FormField>
          <FormField label="To" htmlFor="r-to">
            <Input
              id="r-to"
              type="date"
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            />
          </FormField>
          {report === 'trips' && (
            <FormField label="Vehicle" htmlFor="r-vehicle">
              <Select
                id="r-vehicle"
                placeholder="All vehicles"
                value={filters.vehicle_id}
                onChange={(e) => setFilters({ ...filters, vehicle_id: e.target.value })}
                options={vehicles.map((v) => ({
                  value: String(v.id),
                  label: v.registration_number,
                }))}
              />
            </FormField>
          )}
          {report === 'trips' && (
            <FormField label="Driver" htmlFor="r-driver">
              <Select
                id="r-driver"
                placeholder="All drivers"
                value={filters.driver_id}
                onChange={(e) => setFilters({ ...filters, driver_id: e.target.value })}
                options={drivers.map((d) => ({ value: String(d.id), label: d.name }))}
              />
            </FormField>
          )}
          {/* Only the financial report has periods for a cadence to bucket
              — the others are a row per thing. The server rejects the
              filter on them rather than ignoring it, so it is not offered. */}
          {report === 'financial' && (
            <FormField label="Group by" htmlFor="r-group-by">
              <Select
                id="r-group-by"
                value={filters.group_by}
                onChange={(e) =>
                  setFilters({ ...filters, group_by: e.target.value as FinancialPeriod })
                }
                options={GROUP_BY}
              />
            </FormField>
          )}
          <div style={{ display: 'flex', gap: 'var(--gap-inline)' }}>
            <Button
              iconLeft="play"
              onClick={() => {
                if (report === 'trips') void run(filters, client)
                else setFleetToken((n) => n + 1)
              }}
            >
              Run report
            </Button>
          </div>
        </div>
      </Card>

      {/*
        Each panel is boundaried separately rather than the page as a
        whole. One boundary around everything would still blank the screen
        — it would just apologise while doing it. Per panel, a broken
        financial report leaves the filters, the export panel and the
        navigation exactly where they were.
      */}
      {(report === 'drivers' || report === 'vehicles') && (
        <PanelBoundary label={`the ${report} report`}>
          {/* No client passed: these two span every client for platform
              staff and take no tenant_id (ADR-0007 rule 3). */}
          <FleetReport
            report={report}
            from={filters.from}
            to={filters.to}
            reloadToken={fleetToken}
          />
        </PanelBoundary>
      )}

      {report === 'financial' && (
        <PanelBoundary label="the financial report">
          <FinancialReport
            from={filters.from}
            to={filters.to}
            groupBy={filters.group_by}
            client={client}
            reloadToken={fleetToken}
          />
        </PanelBoundary>
      )}

      {report === 'trips' && summary && (
        <PanelBoundary label="the trip summary">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <ReportScopeNotice covers={covers} scope={scope} />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                gap: 'var(--space-4)',
              }}
            >
              <KPIStat
                label="Trips"
                value={summary.trips.toLocaleString('en-US')}
                icon="navigation"
              />
              <KPIStat
                label="Completed"
                value={summary.trips_completed.toLocaleString('en-US')}
                icon="flag"
              />
              <KPIStat
                label="Distance"
                value={`${summary.distance_km.toLocaleString('en-US')} km`}
                icon="route"
              />
              <KPIStat
                label="Time on the road"
                value={formatDuration(summary.duration_minutes)}
                icon="clock"
              />
              <KPIStat
                label="Records complete"
                value={
                  summary.completeness_percent === null ? '—' : `${summary.completeness_percent}%`
                }
                icon={summary.records_incomplete === 0 ? 'circle-check' : 'triangle-alert'}
                // KPIStat's tone is default|accent only, so the shortfall is
                // carried by the icon and hint rather than a colour it has no
                // token for.
                //
                // The "across every client" suffix is ADR-0007's Consequences
                // in one line. PROJECT.md's success metric is "all six data
                // points on 100% of completed trips" *per client*; spanning
                // makes this a platform average, which is a different claim
                // and not the one the metric is measured against. Unlabelled
                // it would be read as the former.
                hint={
                  (summary.records_incomplete === 0
                    ? 'All six required data points present'
                    : `${summary.records_incomplete} missing a required data point`) +
                  (covers === 'All clients' ? ', averaged across every client' : '')
                }
              />
            </div>
          </div>
        </PanelBoundary>
      )}

      <PanelBoundary label="the export panel">
        <ExportPanel filters={filters} report={report} />
      </PanelBoundary>

      {report === 'trips' && (
        // The table carrying the Bank's six acceptance criteria. If any
        // one row is malformed enough to throw, the summary tiles above it
        // must survive — they are the figures a demo is actually reading.
        <PanelBoundary label="the trip report table">
          <Card padding="none">
            {rows !== null && rows.length === 0 ? (
              <EmptyState
                icon="file-search"
                title="No trips in this period"
                description="No trip commenced between the selected dates. Widen the range or clear the vehicle and driver filters."
              />
            ) : (
              <DataTable<ReportTableRow>
                columns={COLUMNS}
                rows={(rows ?? []).map((row) => ({ ...row, id: row.trip_id }))}
                dense
                emptyMessage={rows === null ? 'Running…' : 'No trips in this period'}
              />
            )}
          </Card>
        </PanelBoundary>
      )}
    </div>
  )
}
