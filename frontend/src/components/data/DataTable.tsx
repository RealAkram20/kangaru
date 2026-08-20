import { useMemo, useState, type HTMLAttributes, type ReactNode } from 'react'
import { Icon } from '../core/Icon'
import { useIsCompact } from '../../lib/useMediaQuery'
import { DataCards } from './DataCards'
import './dataTable.css'

export interface DataColumn<T> {
  /** Which field of the row this column reads, and its default identity. */
  key: Extract<keyof T, string>
  /**
   * Identity, when `key` cannot be it.
   *
   * `key` normally does both jobs — it names the field *and* distinguishes
   * the column — and for a table with one column per field that is fine.
   * It breaks for a table whose columns all read the **same** field and
   * differ only by position: `PositionalReportTable` builds its columns
   * from server-supplied headers over a `cells` array, so every column was
   * `key: 'cells'`, every `<th>` and `<td>` shared a React key, and the
   * financial report logged ten duplicate-key errors per render.
   *
   * It was cosmetic — React still drew the right table — but two things
   * made it worth separating rather than tolerating. Duplicate sibling keys
   * defeat reconciliation, so the correctness was luck that a later change
   * could remove; and `sortable` was unusable on such a table, because the
   * sort lookup below matched the first column every time.
   *
   * Defaults to `key`, so every existing caller is unaffected.
   */
  id?: string
  /**
   * What this column sorts on, when `row[key]` is not it.
   *
   * The other half of the same problem. Giving the columns distinct `id`s
   * fixes which one is *marked* as sorted, but the comparison still read
   * `row[sort.key]` — `cells` for every column of a positional table — so
   * every header sorted by the stringified whole row. Identity and value
   * both have to come off `key` for shared-field columns to work.
   *
   * Defaults to `row[key]`.
   */
  sortValue?: (row: T) => string | number
  header: string
  /** Right-aligns and applies tabular-nums — use for distance, duration, money. */
  numeric?: boolean
  align?: 'left' | 'center' | 'right'
  width?: number | string
  sortable?: boolean
  /** Allow the cell to wrap; default is nowrap. */
  wrap?: boolean
  /** Custom cell renderer — Badge, Identifier, row actions. */
  render?: (row: T) => ReactNode
  /**
   * Where this column goes when the list becomes cards on a small screen.
   *
   * Below `COMPACT_MAX_WIDTH` a row is a card, not a table row, and a card
   * has a shape a table does not: something that says what state this is in,
   * something that names it, and the rest as labelled detail.
   *
   * - `status` — a Badge or similar, in a row at the top of the card.
   * - `title`  — what identifies the row. Rendered as the card's heading and
   *              allowed to wrap, unlike its `nowrap` table cell.
   * - `meta`   — a labelled pair in the grid below. The default.
   * - `hide`   — dropped on small screens. For columns that are noise on a
   *              phone: a client column reading "—" for every row, or a
   *              row-actions cell whose actions live in the detail panel.
   *
   * Untagged tables still render every column as a labelled pair, so a page
   * that has not been curated degrades to something readable rather than to
   * a 1905px horizontal scroll.
   */
  card?: 'status' | 'title' | 'meta' | 'hide'
}

export interface DataTableProps<T extends { id?: string | number }> extends HTMLAttributes<HTMLDivElement> {
  columns?: DataColumn<T>[]
  rows?: T[]
  /** 8px cell padding instead of 12px — for long operational lists. */
  dense?: boolean
  onRowClick?: (row: T) => void
  emptyMessage?: string
  /**
   * Scroll the rows inside this table instead of growing the page.
   *
   * The wrapper becomes the vertical scroller and fills its parent, so a
   * 25-row list no longer makes the whole page tall. Implies `stickyHeader`:
   * a scrolling body whose column headings leave the screen is worse than
   * the page scroll it replaces.
   *
   * Needs a parent with a bounded height — `Card fill` inside `PageFill.Flex`.
   */
  fill?: boolean
  /**
   * Pin the column headings while the rows scroll.
   *
   * On by default whenever `fill` is set; set it independently only for a
   * table scrolling inside some other bounded box.
   */
  stickyHeader?: boolean
}

/**
 * Tracks the sorted column by `id` and the field to sort on by `key`. They
 * are usually the same string; they are not when several columns read one
 * field, which is exactly the case that made matching on `key` wrong.
 */
type SortState<T> = { id: string; key: Extract<keyof T, string>; dir: 'asc' | 'desc' } | null

export function DataTable<T extends { id?: string | number }>({
  columns = [],
  rows = [],
  dense = false,
  onRowClick,
  emptyMessage = 'No records',
  fill = false,
  stickyHeader = fill,
  style,
  className,
  ...rest
}: DataTableProps<T>) {
  const [hover, setHover] = useState<number | null>(null)
  const [sort, setSort] = useState<SortState<T>>(null)
  const compact = useIsCompact()
  const pad = dense ? 'var(--pad-cell-dense) var(--space-3)' : 'var(--pad-cell) var(--space-4)'

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => (c.id ?? c.key) === sort.id)
    if (!col) return rows
    const dir = sort.dir === 'asc' ? 1 : -1
    const value = (row: T) => col.sortValue?.(row) ?? row[sort.key]

    return [...rows].sort((a, b) => {
      const [left, right] = [value(a), value(b)]

      // Numbers compared as numbers. Stringifying them sorts 10 before 9,
      // which on a report of distances or money is the kind of wrong that
      // looks deliberate.
      if (typeof left === 'number' && typeof right === 'number') {
        return (left - right) * dir
      }

      return String(left).localeCompare(String(right)) * dir
    })
  }, [rows, sort, columns])

  /*
    Below the breakpoint this is not a table at all.

    Rendered instead of the table rather than beside it and hidden with CSS:
    a display:none table still mounts every cell, and these lists run to 25
    rows of Badges and Identifiers on the cheap Android handsets this has to
    work on. `sorted` is reused so a column sorted on a desktop keeps its
    order through a rotation into cards.
  */
  if (compact) {
    return (
      <div
        className={[fill ? 'kr-scroll' : null, className].filter(Boolean).join(' ') || undefined}
        style={{ ...(fill ? { flex: 1, minHeight: 0, overflowY: 'auto' } : null), ...style }}
      >
        <DataCards<T>
          columns={columns}
          rows={sorted}
          onRowClick={onRowClick}
          emptyMessage={emptyMessage}
        />
      </div>
    )
  }

  return (
    <div
      /* Merged rather than set: `className` is part of the public props, and
         spreading `...rest` over it would let a caller silently drop the
         scroll styling that `fill` depends on. */
      className={[fill ? 'kr-scroll' : null, className].filter(Boolean).join(' ') || undefined}
      style={{
        width: '100%',
        overflowX: 'auto',
        ...(fill
          ? {
              // This element is the scrollport, which is also what
              // `position: sticky` on the headings resolves against.
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
            }
          : null),
        ...style,
      }}
      {...rest}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', font: 'var(--type-body-dense)' }}>
        <thead>
          <tr style={{ background: 'var(--surface-sunken)' }}>
            {columns.map((c) => (
              <th
                key={c.id ?? c.key}
                onClick={() =>
                  c.sortable &&
                  setSort((s) => ({
                    id: c.id ?? c.key,
                    key: c.key,
                    dir: s && s.id === (c.id ?? c.key) && s.dir === 'asc' ? 'desc' : 'asc',
                  }))
                }
                style={{
                  textAlign: c.align || 'left',
                  padding: pad,
                  font: 'var(--type-overline)',
                  textTransform: 'uppercase',
                  letterSpacing: 'var(--tracking-caps)',
                  color: 'var(--text-secondary)',
                  whiteSpace: 'nowrap',
                  width: c.width,
                  cursor: c.sortable ? 'pointer' : 'default',
                  userSelect: 'none',
                  ...(stickyHeader
                    ? {
                        position: 'sticky',
                        top: 0,
                        // The `<tr>`'s background does not travel with a
                        // sticky cell, so the rows would show through it.
                        background: 'var(--surface-sunken)',
                        // Above the rows, which would otherwise paint over
                        // the heading as they scroll beneath it.
                        zIndex: 1,
                        // Not `borderBottom`: under `border-collapse:
                        // collapse` the border belongs to the table grid
                        // rather than to the cell, so it stays with the rows
                        // and scrolls out from under a sticky heading —
                        // leaving the headings floating with no rule beneath
                        // them. An inset shadow is painted by the cell itself
                        // and sticks with it.
                        boxShadow: 'inset 0 -1px 0 var(--border-default)',
                      }
                    : { borderBottom: '1px solid var(--border-default)' }),
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {c.header}
                  {c.sortable && (
                    <Icon
                      name={sort && sort.id === (c.id ?? c.key) ? (sort.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'chevrons-up-down'}
                      size={12}
                      style={{ color: sort && sort.id === (c.id ?? c.key) ? 'var(--text-accent)' : 'var(--text-placeholder)' }}
                    />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                style={{ padding: 'var(--space-10)', textAlign: 'center', color: 'var(--text-secondary)' }}
              >
                {emptyMessage}
              </td>
            </tr>
          )}
          {sorted.map((row, ri) => (
            <tr
              key={row.id ?? ri}
              onMouseEnter={() => setHover(ri)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onRowClick?.(row)}
              style={{
                background: hover === ri ? 'var(--surface-sunken)' : 'transparent',
                cursor: onRowClick ? 'pointer' : 'default',
                transition: 'background-color var(--dur-fast) var(--ease-standard)',
              }}
            >
              {columns.map((c) => (
                <td
                  key={c.id ?? c.key}
                  className={c.numeric ? 'kr-tabular' : undefined}
                  style={{
                    padding: pad,
                    textAlign: c.align || (c.numeric ? 'right' : 'left'),
                    borderBottom: '1px solid var(--border-default)',
                    color: 'var(--text-body)',
                    whiteSpace: c.wrap ? 'normal' : 'nowrap',
                    fontVariantNumeric: c.numeric ? 'tabular-nums' : 'normal',
                  }}
                >
                  {c.render ? c.render(row) : String(row[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
