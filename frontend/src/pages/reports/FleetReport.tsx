import { useEffect, useState } from 'react'
import { Card } from '../../components/core/Card'
import { KPIStat } from '../../components/data/KPIStat'
import { apiClient } from '../../lib/apiClient'
import { apiError } from '../../lib/apiError'
import { formatDuration } from '../../lib/tripStatus'
import type { ApiSuccess } from '../../types/api'
import type { FleetReportMeta, PositionalReportRow, ReportType } from '../../types/report'
import { PositionalReportTable } from './PositionalReportTable'
import { ReportScopeNotice } from './ReportScopeNotice'

/**
 * The driver and vehicle reports.
 *
 * The table itself is PositionalReportTable, shared with the financial
 * report — this component is only the two reports' headline figures and
 * the fetch that produces them.
 */
export function FleetReport({
  report,
  from,
  to,
  reloadToken,
}: {
  report: Extract<ReportType, 'drivers' | 'vehicles'>
  from: string
  to: string
  /** Bumped by the parent when Run report is pressed. */
  reloadToken: number
}) {
  const [rows, setRows] = useState<PositionalReportRow[] | null>(null)
  const [meta, setMeta] = useState<FleetReportMeta | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)

    apiClient
      .get<ApiSuccess<PositionalReportRow[], FleetReportMeta>>(
        `/reports/${report}?${params.toString()}`,
      )
      .then((response) => {
        if (cancelled) return
        setRows(response.data.data)
        setMeta(response.data.meta ?? null)
        setError(null)
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(apiError(failure, 'Could not run this report.').message)
      })

    return () => {
      cancelled = true
    }
  }, [report, from, to, reloadToken])

  if (error) {
    return (
      <Card title="Report problem">
        <p style={{ color: 'var(--kr-error)' }}>{error}</p>
      </Card>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Above the figures, not below them: it says what they are of. */}
      <ReportScopeNotice covers={meta?.covers} scope={meta?.scope} />

      {meta && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: 'var(--space-4)',
          }}
        >
          <KPIStat
            label={report === 'drivers' ? 'Drivers active' : 'Vehicles active'}
            value={meta.summary.entities_active.toLocaleString('en-US')}
            icon={report === 'drivers' ? 'users' : 'truck'}
            // "Active" is not the size of the fleet — it is how much of it
            // did any work in the period, which is the more useful number
            // and the easier one to misread.
            hint="Commenced at least one trip in this period"
          />
          <KPIStat
            label="Trips"
            value={meta.summary.trips.toLocaleString('en-US')}
            icon="navigation"
          />
          <KPIStat
            label="Distance"
            value={`${meta.summary.distance_km.toLocaleString('en-US')} km`}
            icon="route"
          />
          <KPIStat
            label="Time on the road"
            value={formatDuration(meta.summary.duration_minutes)}
            icon="clock"
          />
          <KPIStat
            label="Variances flagged"
            value={meta.summary.variance_flagged.toLocaleString('en-US')}
            icon={meta.summary.variance_flagged === 0 ? 'circle-check' : 'triangle-alert'}
            hint="Odometer readings the GPS route disagrees with"
          />
        </div>
      )}

      <PositionalReportTable
        rows={rows}
        headers={meta?.headers ?? []}
        emptyTitle={report === 'drivers' ? 'No driver activity' : 'No vehicle activity'}
        emptyDescription="Nothing commenced a trip between the selected dates. Widen the range and run the report again."
      />
    </div>
  )
}
