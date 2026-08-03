import { useEffect, useState } from 'react'
import { Card } from '../../components/core/Card'
import { KPIStat } from '../../components/data/KPIStat'
import { apiClient } from '../../lib/apiClient'
import { fieldFirstMessage } from '../../lib/apiError'
import { formatUgx } from '../../lib/format'
import type { ApiSuccess } from '../../types/api'
import type { FinancialPeriod, FinancialReportMeta, PositionalReportRow } from '../../types/report'
import { PositionalReportTable } from './PositionalReportTable'
import { ReportScopeNotice } from './ReportScopeNotice'

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
  client,
  reloadToken,
}: {
  from: string
  to: string
  groupBy: FinancialPeriod
  /**
   * The client whose figures these are, as a tenant id, or '' for none
   * chosen (ADR-0007).
   *
   * Only platform staff can set it; for a client's own user it is always
   * '' and the server scopes them to their own tenant regardless. Empty
   * from a platform user is a deliberate 422 — see `reportFailureMessage`.
   */
  client: string
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
    if (client) params.set('tenant_id', client)

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
        if (!cancelled) setError(fieldFirstMessage(failure, 'Could not run this report.'))
      })

    return () => {
      cancelled = true
    }
    // `client` re-fetches immediately rather than waiting for Run report:
    // changing whose figures these are invalidates every number on screen,
    // and leaving one client's totals under another's name is the exact
    // confusion ADR-0007 exists to prevent.
  }, [from, to, groupBy, client, reloadToken])

  if (error) {
    return (
      <Card title="Report problem">
        <p style={{ color: 'var(--kr-error)' }}>{error}</p>
      </Card>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/*
        Above the money, not below it. This is the report where a figure
        read under the wrong client's name is most costly, and the reason
        ADR-0007 refuses to produce a cross-client total at all.
      */}
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
