import { Card } from '../../components/core/Card'
import { DataTable, type DataColumn } from '../../components/data/DataTable'
import { EmptyState } from '../../components/feedback/EmptyState'
import type { PositionalReportRow } from '../../types/report'

/**
 * The table shared by every report whose columns arrive from the server.
 *
 * Extracted when the financial report became the second such report
 * (AGENTS.md: "Never duplicate UI. If a component appears more than once,
 * convert it into a reusable component"). The driver, vehicle and financial
 * reports differ in their headline figures and in nothing else about how a
 * row is drawn, so the difference lives in the caller and the sameness
 * lives here.
 *
 * Columns come from `headers` rather than a list held in the client. The
 * server already defines them once for the screen, the CSV, the workbook
 * and the PDF; a fourth copy here is the one that would drift, and its
 * symptom is a correctly-populated table under the wrong headings — worse
 * than an error, because it looks right.
 */
export function PositionalReportTable({
  rows,
  headers,
  emptyTitle,
  emptyDescription,
}: {
  /** Null while the first fetch is in flight. */
  rows: PositionalReportRow[] | null
  headers: string[]
  emptyTitle: string
  emptyDescription: string
}) {
  // DataTable keys rows off `id`; a positional row has none of its own, so
  // the index stands in — stable because the server returns them ordered.
  const tableRows = (rows ?? []).map((cells, index) => ({ id: index, cells }))

  const columns: DataColumn<{ id: number; cells: PositionalReportRow }>[] = headers.map(
    (header, index) => ({
      key: 'cells',
      header,
      // Right-align the figures, left-align the names. Decided from the
      // value rather than a hardcoded column index, so adding a column
      // upstream cannot silently mis-align the table.
      numeric: typeof rows?.[0]?.[index] === 'number',
      render: (row) => {
        const cell = row.cells[index]
        if (cell === null || cell === '') return '—'

        // Thousands separators on every numeric cell. A financial report
        // is the reason: `35000` and `350000` are hard to tell apart at a
        // glance, and money is exactly where that misreading is expensive.
        // Applied by type rather than by column so it needs no per-report
        // configuration.
        return typeof cell === 'number' ? cell.toLocaleString('en-US') : String(cell)
      },
    }),
  )

  return (
    <Card padding="none">
      {rows !== null && rows.length === 0 ? (
        <EmptyState icon="file-search" title={emptyTitle} description={emptyDescription} />
      ) : (
        <DataTable
          columns={columns}
          rows={tableRows}
          dense
          emptyMessage={rows === null ? 'Running…' : emptyTitle}
        />
      )}
    </Card>
  )
}
