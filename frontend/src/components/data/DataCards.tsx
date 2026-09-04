import type { ReactNode } from 'react'
import type { DataColumn } from './DataTable'

/**
 * What a list looks like below `COMPACT_MAX_WIDTH`.
 *
 * A ten-column table does not survive a 360px screen: `/trips` renders 1905px
 * of table, so reading one row means scrolling across five screens and losing
 * the column headings on the way. Below the breakpoint each row becomes a card
 * instead — the fields that identify it, then the rest as labelled pairs.
 *
 * Which field goes where is declared on the column (`card`), so a page states
 * its own priorities and this component holds no per-page knowledge. A table
 * that declares nothing still renders every column as a labelled pair, which
 * is worse than a curated card but far better than the horizontal scroll it
 * replaces — the degradation is graceful rather than blank.
 */
export function DataCards<T extends { id?: string | number }>({
  columns,
  rows,
  onRowClick,
  emptyMessage,
}: {
  columns: DataColumn<T>[]
  rows: T[]
  onRowClick?: (row: T) => void
  emptyMessage: string
}) {
  const shown = columns.filter((c) => c.card !== 'hide')
  const status = shown.filter((c) => c.card === 'status')
  const titles = shown.filter((c) => c.card === 'title')
  // Everything not called out becomes a labelled pair, including the columns
  // of a table that has not been tagged at all.
  const meta = shown.filter((c) => c.card !== 'status' && c.card !== 'title')

  const cell = (column: DataColumn<T>, row: T): ReactNode =>
    column.render ? column.render(row) : String(row[column.key] ?? '')

  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: 'var(--space-10) var(--space-5)',
          textAlign: 'center',
          color: 'var(--text-secondary)',
          font: 'var(--type-body-dense)',
        }}
      >
        {emptyMessage}
      </div>
    )
  }

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {rows.map((row, index) => {
        const interactive = Boolean(onRowClick)
        return (
          <li
            key={row.id ?? index}
            style={{ borderBottom: '1px solid var(--border-default)' }}
          >
            {/*
              A real button when the row does something, a plain div when it
              does not. A div with onClick is unreachable by keyboard and
              announces nothing, and these lists are read by screen reader on
              the same phones as by thumb.

              The constraint that follows: a table with `onRowClick` must not
              also render a button inside a cell, because the card would nest
              one button in another — invalid HTML, and the inner control
              becomes unreachable. Today only Trips and Invoices set
              `onRowClick` and neither has an in-cell control; the pages that
              do have row actions (Bookings, Staff, Roles, …) have no row
              click. If you need both, mark the actions column `card: 'hide'`
              and put the action in the detail panel the row opens.
            */}
            <CardBody interactive={interactive} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {(status.length > 0 || titles.length > 0) && (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                  }}
                >
                  {status.map((c) => (
                    <span key={c.id ?? c.key}>{cell(c, row)}</span>
                  ))}
                </div>
              )}

              {titles.map((c) => (
                <div
                  key={c.id ?? c.key}
                  style={{
                    font: 'var(--type-body)',
                    fontWeight: 'var(--weight-semibold)',
                    color: 'var(--text-heading)',
                    // Long routes ("Misindye Church of Uganda Primary School,
                    // Seeta → Mutundwe") must wrap here. The table forces
                    // nowrap on every cell, which is right for a column and
                    // wrong for a heading.
                    overflowWrap: 'anywhere',
                  }}
                >
                  {cell(c, row)}
                </div>
              ))}

              {meta.length > 0 && (
                <dl
                  style={{
                    display: 'grid',
                    // Two fixed columns, not `auto-fit, minmax(130px, 1fr)`.
                    // `1fr` is `minmax(auto, 1fr)`, so a long value like a
                    // full timestamp raised the track's min-content width past
                    // 130px and auto-fit dropped to a single column — six
                    // facts down the page and a 404px card. `minmax(0, 1fr)`
                    // lets the track be narrower than its content and the
                    // values wrap instead.
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: 'var(--space-2) var(--space-4)',
                    margin: 0,
                  }}
                >
                  {meta.map((c) => (
                    <div key={c.id ?? c.key} style={{ minWidth: 0 }}>
                      <dt
                        style={{
                          font: 'var(--type-caption)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {c.header}
                      </dt>
                      <dd
                        style={{
                          margin: 0,
                          font: 'var(--type-body-dense)',
                          color: 'var(--text-body)',
                          fontVariantNumeric: c.numeric ? 'tabular-nums' : 'normal',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {cell(c, row)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardBody>
          </li>
        )
      })}
    </ul>
  )
}

function CardBody({
  interactive,
  onClick,
  children,
}: {
  interactive: boolean
  onClick?: () => void
  children: ReactNode
}) {
  const style = {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 'var(--space-2)',
    width: '100%',
    textAlign: 'left' as const,
    // 12px vertical either side of the content clears the 44px touch floor
    // for the whole card, which is the target here — not the text inside it.
    padding: 'var(--space-3) var(--space-4)',
    background: 'transparent',
    border: 'none',
    font: 'inherit',
    color: 'inherit',
  }

  if (!interactive) return <div style={style}>{children}</div>

  return (
    <button type="button" onClick={onClick} style={{ ...style, cursor: 'pointer' }}>
      {children}
    </button>
  )
}
