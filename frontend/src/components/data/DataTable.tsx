import { useMemo, useState, type HTMLAttributes, type ReactNode } from 'react'
import { Icon } from '../core/Icon'

export interface DataColumn<T> {
  key: Extract<keyof T, string>
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
}

export interface DataTableProps<T extends { id?: string | number }> extends HTMLAttributes<HTMLDivElement> {
  columns?: DataColumn<T>[]
  rows?: T[]
  /** 8px cell padding instead of 12px — for long operational lists. */
  dense?: boolean
  onRowClick?: (row: T) => void
  emptyMessage?: string
}

type SortState<T> = { key: Extract<keyof T, string>; dir: 'asc' | 'desc' } | null

export function DataTable<T extends { id?: string | number }>({
  columns = [],
  rows = [],
  dense = false,
  onRowClick,
  emptyMessage = 'No records',
  style,
  ...rest
}: DataTableProps<T>) {
  const [hover, setHover] = useState<number | null>(null)
  const [sort, setSort] = useState<SortState<T>>(null)
  const pad = dense ? 'var(--pad-cell-dense) var(--space-3)' : 'var(--pad-cell) var(--space-4)'

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return rows
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => (String(a[sort.key]) > String(b[sort.key]) ? dir : -dir))
  }, [rows, sort, columns])

  return (
    <div style={{ width: '100%', overflowX: 'auto', ...style }} {...rest}>
      <table style={{ width: '100%', borderCollapse: 'collapse', font: 'var(--type-body-dense)' }}>
        <thead>
          <tr style={{ background: 'var(--surface-sunken)' }}>
            {columns.map((c) => (
              <th
                key={c.key}
                onClick={() =>
                  c.sortable &&
                  setSort((s) => ({ key: c.key, dir: s && s.key === c.key && s.dir === 'asc' ? 'desc' : 'asc' }))
                }
                style={{
                  textAlign: c.align || 'left',
                  padding: pad,
                  font: 'var(--type-overline)',
                  textTransform: 'uppercase',
                  letterSpacing: 'var(--tracking-caps)',
                  color: 'var(--text-secondary)',
                  borderBottom: '1px solid var(--border-default)',
                  whiteSpace: 'nowrap',
                  width: c.width,
                  cursor: c.sortable ? 'pointer' : 'default',
                  userSelect: 'none',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {c.header}
                  {c.sortable && (
                    <Icon
                      name={sort && sort.key === c.key ? (sort.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'chevrons-up-down'}
                      size={12}
                      style={{ color: sort && sort.key === c.key ? 'var(--text-accent)' : 'var(--text-placeholder)' }}
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
                  key={c.key}
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
