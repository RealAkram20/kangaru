import { useEffect, useState } from 'react'
import { Badge } from '../../components/core/Badge'
import { Card } from '../../components/core/Card'
import { Identifier } from '../../components/core/Identifier'
import { DataTable, type DataColumn } from '../../components/data/DataTable'
import { KPIStat } from '../../components/data/KPIStat'
import { LoadMore } from '../../components/data/LoadMore'
import { EmptyState } from '../../components/feedback/EmptyState'
import { FormField } from '../../components/forms/FormField'
import { Select } from '../../components/forms/Select'
import { apiClient } from '../../lib/apiClient'
import { fieldFirstMessage } from '../../lib/apiError'
import { formatTimestamp } from '../../lib/format'
import type { ApiSuccess } from '../../types/api'
import type {
  DistanceDeviationBuckets,
  DistanceGrade,
  DistanceReportMeta,
  DistanceReportRow,
  DistanceReportSummary,
} from '../../types/report'
import { ReportScopeNotice } from './ReportScopeNotice'

/**
 * The measured-distance shadow report (ADR-0045; Phase 1 step 5 of
 * `docs/measured-distance-plan.md`).
 *
 * The instrument the flip to trace-priced fares is judged on. Every figure
 * here is the server's: the resolver's grade per trip, and over the whole
 * filtered set the distribution of grades, of engine, of coverage, and of
 * how far the trace sits from the odometer and from the road. **Nothing on
 * this screen is billed** — the tiles say so, and the "Engine" tile says
 * plainly when the resolver has been measuring by haversine because the
 * road engine is switched off, so a wall of grade C is read as an
 * unconfigured deployment and not as a fleet of liars.
 *
 * Grade and engine are filters of this panel rather than the page, because
 * they exist for no other report.
 */

const GRADE_LABEL: Record<DistanceGrade, string> = {
  A: 'GPS-verified',
  B: 'Bounded',
  C: 'Held',
  // "Unverified", not "unknown": nothing vouches for the figure and nothing
  // contradicts it, which is a state an operator can act on (switch the
  // engine on, check the handset) rather than a shrug.
  U: 'Unverified',
}

const GRADE_TONE: Record<DistanceGrade, 'success' | 'info' | 'warning' | 'neutral'> = {
  A: 'success',
  B: 'info',
  C: 'warning',
  U: 'neutral',
}

function km(value: number | null): string {
  return value === null
    ? '—'
    : `${value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`
}

function pct(value: number | null): string {
  return value === null ? '—' : `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
}

function share(count: number, total: number): string {
  return total === 0 ? '—' : `${Math.round((count / total) * 100)}%`
}

type TableRow = DistanceReportRow & { id: number }

const COLUMNS: DataColumn<TableRow>[] = [
  {
    key: 'trip_id',
    header: 'Trip',
    render: (row) => <Identifier size="xs">#{row.trip_id}</Identifier>,
  },
  {
    key: 'completed_at',
    header: 'Completed',
    render: (row) => (row.completed_at ? formatTimestamp(row.completed_at) : '—'),
  },
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
  {
    key: 'grade',
    header: 'Grade',
    render: (row) => (
      // Label and letter together, never the colour alone (screen-rules §6).
      <Badge tone={GRADE_TONE[row.grade]} size="sm" title={row.reason}>
        {row.grade} · {GRADE_LABEL[row.grade]}
      </Badge>
    ),
  },
  { key: 'billed_km', header: 'Would bill', render: (row) => km(row.billed_km) },
  { key: 'gps_km', header: 'Trace', render: (row) => km(row.gps_km) },
  { key: 'odometer_km', header: 'Odometer', render: (row) => km(row.odometer_km) },
  { key: 'route_km', header: 'Road', render: (row) => km(row.route_km) },
  { key: 'coverage_percent', header: 'Coverage', render: (row) => pct(row.coverage_percent) },
  {
    key: 'provider',
    header: 'Engine',
    render: (row) => row.provider ?? '—',
  },
  {
    key: 'reason',
    header: 'Why',
    render: (row) => (
      <span
        title={row.reason}
        style={{
          display: 'inline-block',
          maxWidth: 360,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          verticalAlign: 'bottom',
          color: 'var(--text-secondary)',
        }}
      >
        {row.reason}
      </span>
    ),
  },
]

/**
 * One horizontal distribution: a label, a bar proportional to the share, and
 * the count in words. The bar is decoration over the number, never the only
 * carrier of it.
 */
function Distribution({
  title,
  buckets,
  total,
}: {
  title: string
  buckets: { label: string; count: number }[]
  total: number
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ font: 'var(--type-label)', color: 'var(--text-heading)' }}>{title}</div>
      {buckets.map((bucket) => {
        const width = total === 0 ? 0 : Math.round((bucket.count / total) * 100)
        return (
          <div
            key={bucket.label}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(96px, 1fr) 3fr minmax(72px, auto)',
              alignItems: 'center',
              gap: 'var(--space-3)',
              font: 'var(--type-body-dense)',
            }}
          >
            <span style={{ color: 'var(--text-secondary)' }}>{bucket.label}</span>
            <div
              aria-hidden="true"
              style={{
                height: 8,
                borderRadius: 'var(--radius-pill)',
                background: 'var(--surface-sunken)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${width}%`,
                  height: '100%',
                  background: 'var(--kr-green)',
                  borderRadius: 'var(--radius-pill)',
                }}
              />
            </div>
            <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {bucket.count.toLocaleString('en-US')}
              <span style={{ color: 'var(--text-secondary)' }}>
                {' '}
                · {share(bucket.count, total)}
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

function deviationBuckets(buckets: DistanceDeviationBuckets) {
  return [
    { label: 'Within 5%', count: buckets.within_5 },
    { label: '5–15% off', count: buckets['5_to_15'] },
    { label: '15–30% off', count: buckets['15_to_30'] },
    { label: 'Over 30% off', count: buckets.over_30 },
    { label: 'No comparison', count: buckets.unknown },
  ]
}

function Summary({ summary, covers }: { summary: DistanceReportSummary; covers?: string }) {
  const { resolved, grades, providers } = summary
  const engineOff = providers.haversine > 0

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 'var(--space-4)',
        }}
      >
        <KPIStat
          label="Trips resolved"
          value={resolved.toLocaleString('en-US')}
          icon="route"
          hint={
            summary.unresolved === 0
              ? 'Every completed trip in the period has a resolution'
              : `${summary.unresolved.toLocaleString('en-US')} completed but not yet resolved — check the queue worker`
          }
        />
        <KPIStat
          label="A · GPS-verified"
          value={grades.A.toLocaleString('en-US')}
          icon="circle-check"
          tone="accent"
          hint={`${share(grades.A, resolved)} of resolved trips — measured, and the road agrees`}
        />
        <KPIStat
          label="B · Bounded"
          value={grades.B.toLocaleString('en-US')}
          icon="scale"
          hint={`${share(grades.B, resolved)} — a detour, a road the map lacks, or an odometer inside the corridor`}
        />
        <KPIStat
          label="C · Held"
          value={grades.C.toLocaleString('en-US')}
          icon="triangle-alert"
          hint={`${share(grades.C, resolved)} — the evidence speaks against the figure; nothing bills from these`}
        />
        <KPIStat
          label="U · Unverified"
          value={grades.U.toLocaleString('en-US')}
          icon="circle-help"
          hint={`${share(grades.U, resolved)} — no trace and no road to check against; bills under an odometer contract, held under a measured one`}
        />
        <KPIStat
          label="Mean coverage"
          value={pct(summary.mean_coverage_percent)}
          icon="satellite"
          hint={
            summary.no_trace === 0
              ? 'Share of each trip the handset was reporting'
              : `${summary.no_trace.toLocaleString('en-US')} with no trace at all`
          }
        />
        <KPIStat
          label="Engine"
          value={
            resolved === 0
              ? '—'
              : engineOff && providers.osrm === 0
                ? 'Off'
                : `${providers.osrm.toLocaleString('en-US')} road-matched`
          }
          icon="cpu"
          hint={
            resolved === 0
              ? 'No trips resolved yet'
              : engineOff
                ? `${providers.haversine.toLocaleString('en-US')} measured by straight line only — switch on trace matching once OSRM is self-hosted`
                : 'Every trace snapped to roads by OSRM'
          }
        />
      </div>

      <Card
        title="Where the trace sits"
        subtitle={`Over ${resolved.toLocaleString('en-US')} resolved trip${resolved === 1 ? '' : 's'}${
          covers === 'All clients' ? ', across every client' : ''
        }. Nothing here is billed yet.`}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 'var(--space-6)',
          }}
        >
          <Distribution
            title="Coverage of the trip by pings"
            total={resolved}
            buckets={[
              { label: '95% and up', count: summary.coverage['95_up'] },
              { label: '80–95%', count: summary.coverage['80_to_95'] },
              { label: '50–80%', count: summary.coverage['50_to_80'] },
              { label: 'Under 50%', count: summary.coverage.under_50 },
              { label: 'Unknown', count: summary.coverage.unknown },
            ]}
          />
          <Distribution
            title="Trace against the odometer"
            total={resolved}
            buckets={deviationBuckets(summary.trace_vs_odometer)}
          />
          <Distribution
            title="Trace against the road"
            total={resolved}
            buckets={deviationBuckets(summary.trace_vs_route)}
          />
        </div>
      </Card>
    </>
  )
}

export function DistanceReport({
  from,
  to,
  client,
  reloadToken,
}: {
  from: string
  to: string
  /** Platform staff may narrow to one client; '' spans all (ADR-0007). */
  client: string
  /** Bumped by the parent when Run report is pressed. */
  reloadToken: number
}) {
  const [grade, setGrade] = useState<'' | DistanceGrade>('')
  const [engine, setEngine] = useState<'' | 'osrm' | 'haversine'>('')
  const [rows, setRows] = useState<DistanceReportRow[] | null>(null)
  const [meta, setMeta] = useState<DistanceReportMeta | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const query = (cursor?: string) => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (client) params.set('tenant_id', client)
    if (grade) params.set('grade', grade)
    if (engine) params.set('provider', engine)
    if (cursor) params.set('cursor', cursor)
    return `/reports/distance?${params.toString()}`
  }

  useEffect(() => {
    let cancelled = false

    apiClient
      .get<ApiSuccess<DistanceReportRow[], DistanceReportMeta>>(query())
      .then((response) => {
        if (cancelled) return
        setRows(response.data.data)
        setMeta(response.data.meta ?? null)
        setNextCursor(response.data.meta?.cursor.next ?? null)
        setError(null)
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(fieldFirstMessage(failure, 'Could not run this report.'))
      })

    return () => {
      cancelled = true
    }
    // `client`, `grade` and `engine` re-fetch immediately: each changes
    // whose or which trips these are, and a distribution left on screen
    // under the wrong heading is the confusion ADR-0007 exists to prevent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, client, grade, engine, reloadToken])

  const loadMore = () => {
    if (!nextCursor) return
    setLoadingMore(true)
    apiClient
      .get<ApiSuccess<DistanceReportRow[], DistanceReportMeta>>(query(nextCursor))
      .then((response) => {
        setRows((current) => [...(current ?? []), ...response.data.data])
        setNextCursor(response.data.meta?.cursor.next ?? null)
      })
      .catch((failure: unknown) =>
        setError(fieldFirstMessage(failure, 'Could not load more rows.')),
      )
      .finally(() => setLoadingMore(false))
  }

  if (error) {
    return (
      <Card title="Report problem">
        <p style={{ color: 'var(--kr-error)' }}>{error}</p>
      </Card>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <ReportScopeNotice covers={meta?.covers} scope={meta?.scope} />

      {meta && <Summary summary={meta.summary} covers={meta.covers} />}

      <Card padding="none">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 220px))',
            gap: 'var(--space-4)',
            padding: 'var(--pad-card-compact)',
            borderBottom: '1px solid var(--border-default)',
          }}
        >
          <FormField label="Grade" htmlFor="d-grade">
            <Select
              id="d-grade"
              placeholder="All grades"
              value={grade}
              onChange={(e) => setGrade(e.target.value as '' | DistanceGrade)}
              options={(['A', 'B', 'C', 'U'] as DistanceGrade[]).map((g) => ({
                value: g,
                label: `${g} · ${GRADE_LABEL[g]}`,
              }))}
            />
          </FormField>
          <FormField label="Engine" htmlFor="d-engine">
            <Select
              id="d-engine"
              placeholder="Any engine"
              value={engine}
              onChange={(e) => setEngine(e.target.value as '' | 'osrm' | 'haversine')}
              options={[
                { value: 'osrm', label: 'OSRM · road-matched' },
                { value: 'haversine', label: 'Straight line only' },
              ]}
            />
          </FormField>
        </div>

        {rows !== null && rows.length === 0 ? (
          <EmptyState
            icon="file-search"
            title="No resolved trips"
            description="No completed trip in this period has a distance resolution yet. Widen the range, or check that the queue worker is running."
            compact
          />
        ) : (
          <>
            <DataTable<TableRow>
              columns={COLUMNS}
              rows={(rows ?? []).map((row) => ({ ...row, id: row.trip_id }))}
              dense
              emptyMessage={rows === null ? 'Running…' : 'No resolved trips'}
            />
            <LoadMore hasMore={nextCursor !== null} loading={loadingMore} onLoadMore={loadMore} />
          </>
        )}
      </Card>
    </div>
  )
}
