import { useEffect, useState } from 'react'
import { Card } from '../../components/core/Card'
import { KPIStat } from '../../components/data/KPIStat'
import { apiClient } from '../../lib/apiClient'
import { apiError } from '../../lib/apiError'
import { formatUgx } from '../../lib/format'
import type { ApiSuccess } from '../../types/api'
import type {
  FinancialPeriod,
  FinancialReportMeta,
  PositionalReportRow,
} from '../../types/report'
import { PositionalReportTable } from './PositionalReportTable'

/**
 * PROJECT.md's fourth Phase 1 report: invoiced, credited and outstanding
 * per period.
 *
 * The table is the shared positional one — this component is only its
 * headline figures, which are the one thing a financial report does not
 * share with the fleet reports.
 */
export function FinancialReport({
  from,
  to,
  groupBy,
  reloadToken,
}: {
  from: string
  to: string
  groupBy: FinancialPeriod
  /** Bumped by the parent when Run report is pressed. */
  reloadToken: number
}) {
  const [rows, setRows] = useState<PositionalReportRow[] | null>(null)
  const [meta, setMeta] = useState<FinancialReportMeta | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    params.set('group_by', groupBy)

    apiClient
      .get<ApiSuccess<PositionalReportRow[], FinancialReportMeta>>(
        `/reports/financial?${params.toString()}`,
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
  }, [from, to, groupBy, reloadToken])

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
            label="Invoiced"
            value={formatUgx(meta.summary.invoiced_minor)}
            icon="receipt"
            hint={`${meta.summary.invoices.toLocaleString('en-US')} invoice${
              meta.summary.invoices === 1 ? '' : 's'
            } issued`}
          />
          <KPIStat
            label="Credited"
            value={formatUgx(meta.summary.credited_minor)}
            icon="rotate-ccw"
            hint={`${meta.summary.credit_notes.toLocaleString('en-US')} credit note${
              meta.summary.credit_notes === 1 ? '' : 's'
            }`}
          />
          <KPIStat
            label="Outstanding"
            value={formatUgx(meta.summary.outstanding_minor)}
            icon="scale"
            // The caveat is driven by the server's own flag rather than
            // hardcoded here. Nothing in the platform records money coming
            // in yet, so "outstanding" cannot mean "unpaid" — and a finance
            // user reading it as such would be reading a number the system
            // cannot produce. When payments land the flag flips and this
            // corrects itself instead of becoming a stale warning.
            hint={
              meta.summary.payments_recorded
                ? 'Issued less credited and less payments received'
                : 'Issued less credited — payments are not yet recorded'
            }
          />
          <KPIStat
            label="Periods"
            value={meta.summary.periods.toLocaleString('en-US')}
            icon="calendar"
            hint="Periods with billing activity"
          />
        </div>
      )}

      <PositionalReportTable
        rows={rows}
        headers={meta?.headers ?? []}
        emptyTitle="No billing activity"
        emptyDescription="No invoice or credit note was issued between the selected dates. Widen the range and run the report again."
      />
    </div>
  )
}
