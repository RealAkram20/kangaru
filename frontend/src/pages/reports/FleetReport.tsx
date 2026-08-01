import { useEffect, useState } from 'react'
import { Card } from '../../components/core/Card'
import { DataTable, type DataColumn } from '../../components/data/DataTable'
import { KPIStat } from '../../components/data/KPIStat'
import { EmptyState } from '../../components/feedback/EmptyState'
import { apiClient } from '../../lib/apiClient'
import { apiError } from '../../lib/apiError'
import { formatDuration } from '../../lib/tripStatus'
import type { ApiSuccess } from '../../types/api'
import type { FleetReportMeta, FleetReportRow, ReportType } from '../../types/report'

/**
 * The driver and vehicle reports.
 *
 * Columns are rendered from `meta.headers` rather than a list held here.
 * The server already defines them once for the screen, the CSV, the
 * workbook and the PDF; a fourth copy in the client is the one that would
 * drift, and the symptom would be a correctly-populated table under the
 * wrong headings.
 */
export function FleetReport({
  report,
  from,
  to,
  reloadToken,
}: {
  report: Exclude<ReportType, 'trips'>
  from: string
  to: string
  /** Bumped by the parent when Run report is pressed. */
  reloadToken: number
}) {
  const [rows, setRows] = useState<FleetReportRow[] | null>(null)
  const [meta, setMeta] = useState<FleetReportMeta | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)

    apiClient
      .get<ApiSuccess<FleetReportRow[], FleetReportMeta>>(`/reports/${report}?${params.toString()}`)
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

  // DataTable keys rows off `id`; a positional row has none of its own, so
  // the index stands in — stable because the server returns them ordered.
  const tableRows = (rows ?? []).map((row, index) => ({ id: index, cells: row }))

  const columns: DataColumn<{ id: number; cells: FleetReportRow }>[] = (meta?.headers ?? []).map(
    (header, index) => ({
      key: 'cells',
      header,
      // Right-align the figures, left-align the names. Decided from the
      // value rather than a hardcoded column index, so adding a column
      // upstream cannot silently mis-align the table.
      numeric: typeof (rows?.[0]?.[index]) === 'number',
      render: (row) => {
        const cell = row.cells[index]
        return cell === null || cell === '' ? '—' : String(cell)
      },
    }),
  )

  if (error) {
    return (
      <Card title="Report problem">
        <p style={{ color: 'var(--kr-error)' }}>{error}</p>
      </Card>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
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
          <KPIStat label="Trips" value={meta.summary.trips.toLocaleString('en-US')} icon="navigation" />
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

      <Card padding="none">
        {rows !== null && rows.length === 0 ? (
          <EmptyState
            icon="file-search"
            title={report === 'drivers' ? 'No driver activity' : 'No vehicle activity'}
            description="Nothing commenced a trip between the selected dates. Widen the range and run the report again."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={tableRows}
            dense
            emptyMessage={rows === null ? 'Running…' : 'No activity in this period'}
          />
        )}
      </Card>
    </div>
  )
}
