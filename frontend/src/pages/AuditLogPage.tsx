import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { Identifier } from '../components/core/Identifier'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { Alert } from '../components/feedback/Alert'
import { EmptyState } from '../components/feedback/EmptyState'
import { FormField } from '../components/forms/FormField'
import { Select } from '../components/forms/Select'
import { apiClient } from '../lib/apiClient'
import { apiError } from '../lib/apiError'
import { formatTimestamp } from '../lib/format'
import type { ApiSuccess } from '../types/api'
import type { AuditAction, AuditLogEntry, AuditLogMeta } from '../types/auditLog'

/**
 * The audit log reader (AGENTS.md Observability).
 *
 * "Every mutation to rate cards, contracts, invoices, payments,
 * roles/permissions, and credit limits is written to an append-only
 * `audit_logs` table: who, what, before/after diff, when, from which IP.
 * Tenant admins can query their own tenant's audit log. This must exist
 * before the first bank demo." The table and the API have existed for
 * several passes; this is the half a bank is actually shown.
 *
 * Holds no copy of what may be filtered on. The available types and actions
 * arrive in `meta.filters`, because a client-side list is precisely how the
 * server's own whitelist went stale — it read `company|user` while the
 * table filled up with roles, invoices and rate cards.
 */

/** DataTable keys rows off `id`, which an audit row already has. */
type Row = AuditLogEntry

const ACTION_TONE: Record<AuditAction, 'success' | 'info' | 'error'> = {
  created: 'success',
  updated: 'info',
  deleted: 'error',
}

const ACTION_ICON: Record<AuditAction, string> = {
  created: 'plus',
  updated: 'pencil',
  deleted: 'trash-2',
}

/** `rate_card_version` -> `Rate card version`. */
function humaniseType(type: string): string {
  const spaced = type.replace(/_/g, ' ')

  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * One field's before/after, rendered as text.
 *
 * Values are whatever the model held, so objects and arrays turn up — a
 * role's `permissions` is a JSON array, and it is the single most
 * interesting diff in the table. JSON.stringify rather than String(), which
 * would render it `[object Object]`.
 */
function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value === '' ? '(empty)' : value
  if (typeof value === 'object') return JSON.stringify(value)

  return String(value)
}

export function AuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null)
  const [meta, setMeta] = useState<AuditLogMeta | null>(null)
  const [filters, setFilters] = useState({ auditable_type: '', action: '' })
  const [error, setError] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)

  const applyResult = useCallback(
    (result: { entries: AuditLogEntry[]; meta: AuditLogMeta | null }, append: boolean) => {
      setEntries((current) => (append ? [...(current ?? []), ...result.entries] : result.entries))
      setMeta(result.meta)
      setError(null)
      setRefused(false)
    },
    [],
  )

  const fail = useCallback((failure: unknown) => {
    const problem = apiError(failure, 'Could not load the audit log.')
    // 403 is an answer, not a fault: the reader simply does not hold
    // `audit.view`.
    if (problem.code === 'FORBIDDEN') {
      setRefused(true)
      setEntries([])

      return
    }
    setError(problem.message)
  }, [])

  const load = useCallback(
    (next: typeof filters, cursor: string | null) =>
      fetchEntries(next, cursor).then((result) => applyResult(result, cursor !== null), fail),
    [applyResult, fail],
  )

  useEffect(() => {
    void load({ auditable_type: '', action: '' }, null)
  }, [load])

  const apply = (next: typeof filters) => {
    setFilters(next)
    setEntries(null)
    setExpanded(null)
    void load(next, null)
  }

  const loadMore = async () => {
    setLoadingMore(true)
    await load(filters, meta?.cursor.next ?? null)
    setLoadingMore(false)
  }

  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      {
        key: 'created_at',
        header: 'When',
        render: (row) => formatTimestamp(row.created_at),
      },
      {
        key: 'user_id',
        header: 'Who',
        render: (row) =>
          // A mutation with no actor came from a seeder, a queue job or a
          // console command. Naming it beats an empty cell that reads like
          // missing data.
          row.user ? row.user.name : <span style={{ color: 'var(--text-secondary)' }}>System</span>,
      },
      {
        key: 'action',
        header: 'Action',
        render: (row) => (
          <Badge tone={ACTION_TONE[row.action]} icon={ACTION_ICON[row.action]} size="sm">
            {row.action}
          </Badge>
        ),
      },
      {
        key: 'auditable_type',
        header: 'Record',
        render: (row) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {humaniseType(row.auditable_type)}
            <Identifier size="xs" tone="muted">
              #{row.auditable_id}
            </Identifier>
          </span>
        ),
      },
      {
        key: 'ip_address',
        header: 'From',
        // AGENTS.md asks for "from which IP". Null on anything a console
        // wrote, which is not a gap but the absence of a request.
        render: (row) =>
          row.ip_address ? (
            <Identifier size="xs">{row.ip_address}</Identifier>
          ) : (
            <span style={{ color: 'var(--text-secondary)' }}>—</span>
          ),
      },
      {
        key: 'id',
        header: 'Changes',
        render: (row) => (
          <Button
            size="sm"
            variant="ghost"
            iconLeft={expanded === row.id ? 'chevron-up' : 'chevron-down'}
            onClick={() => setExpanded((current) => (current === row.id ? null : row.id))}
          >
            {expanded === row.id ? 'Hide' : 'Show'}
          </Button>
        ),
      },
    ],
    [expanded],
  )

  if (refused) {
    return (
      <Card>
        <EmptyState
          icon="lock"
          title="The audit log is not available to your account"
          description="Reading the audit trail is reserved for administrators. Ask a Super Admin or your Corporate Admin if you need access."
        />
      </Card>
    )
  }

  const openEntry = entries?.find((entry) => entry.id === expanded) ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error && (
        <Alert tone="error" title="Audit log" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card
        title="Audit log"
        subtitle={
          meta?.scope === 'platform'
            ? 'Every tenant, plus platform-level changes such as roles. Append-only — nothing here can be edited or removed.'
            : 'Your organisation’s record of who changed what. Append-only — nothing here can be edited or removed.'
        }
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: 'var(--space-4)',
            alignItems: 'end',
          }}
        >
          <FormField label="Record type" htmlFor="a-type">
            <Select
              id="a-type"
              placeholder="Everything"
              value={filters.auditable_type}
              onChange={(e) => apply({ ...filters, auditable_type: e.target.value })}
              // Straight from the server: this page holds no list of what
              // is auditable, so a newly audited model appears here without
              // a frontend release.
              options={(meta?.filters.auditable_types ?? []).map((type) => ({
                value: type,
                label: humaniseType(type),
              }))}
            />
          </FormField>
          <FormField label="Action" htmlFor="a-action">
            <Select
              id="a-action"
              placeholder="Any action"
              value={filters.action}
              onChange={(e) => apply({ ...filters, action: e.target.value })}
              options={(meta?.filters.actions ?? []).map((action) => ({
                value: action,
                label: humaniseType(action),
              }))}
            />
          </FormField>
          {(filters.auditable_type || filters.action) && (
            <div>
              <Button
                variant="secondary"
                iconLeft="x"
                onClick={() => apply({ auditable_type: '', action: '' })}
              >
                Clear filters
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card padding="none">
        {entries !== null && entries.length === 0 ? (
          <EmptyState
            icon="file-clock"
            title={
              filters.auditable_type || filters.action
                ? 'Nothing matches these filters'
                : 'Nothing has been recorded yet'
            }
            description={
              filters.auditable_type || filters.action
                ? 'Widen the filters, or clear them to see the whole trail.'
                : 'Changes to companies, staff, roles, rate cards and invoices appear here as they happen.'
            }
          />
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={entries ?? []}
            dense
            emptyMessage={entries === null ? 'Loading…' : 'Nothing matches these filters'}
          />
        )}

        {openEntry && <ChangeDetail entry={openEntry} />}

        {meta?.cursor.next && (
          <div
            style={{
              padding: 'var(--space-3) var(--space-4)',
              borderTop: '1px solid var(--border-default)',
            }}
          >
            <Button
              size="sm"
              variant="secondary"
              loading={loadingMore}
              onClick={() => void loadMore()}
            >
              Load more
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}

async function fetchEntries(
  filters: { auditable_type: string; action: string },
  cursor: string | null,
): Promise<{ entries: AuditLogEntry[]; meta: AuditLogMeta | null }> {
  const params = new URLSearchParams()
  if (filters.auditable_type) params.set('auditable_type', filters.auditable_type)
  if (filters.action) params.set('action', filters.action)
  if (cursor) params.set('cursor', cursor)

  const response = await apiClient.get<ApiSuccess<AuditLogEntry[], AuditLogMeta>>(
    `/audit-logs?${params.toString()}`,
  )

  return { entries: response.data.data, meta: response.data.meta ?? null }
}

/**
 * The before/after diff — the part a bank actually asks to see.
 *
 * Rendered as one row per changed field rather than two JSON blobs: the
 * question in the room is "what changed", and a reader should not have to
 * diff two objects by eye to answer it. A create has no before and a delete
 * has no after, so the column simply reads as a dash.
 */
function ChangeDetail({ entry }: { entry: AuditLogEntry }) {
  const before = entry.changes?.before ?? null
  const after = entry.changes?.after ?? null
  const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort()

  return (
    <div
      style={{
        padding: 'var(--space-4) var(--space-5)',
        background: 'var(--surface-sunken)',
        borderTop: '1px solid var(--border-default)',
      }}
    >
      <p
        style={{
          font: 'var(--type-label)',
          color: 'var(--text-body)',
          marginBottom: 'var(--space-3)',
        }}
      >
        {humaniseType(entry.auditable_type)} #{entry.auditable_id} — {entry.action}
      </p>

      {fields.length === 0 ? (
        <p style={{ font: 'var(--type-body-dense)', color: 'var(--text-secondary)' }}>
          No field-level detail was recorded for this change.
        </p>
      ) : (
        <table
          style={{ width: '100%', borderCollapse: 'collapse', font: 'var(--type-body-dense)' }}
        >
          <thead>
            <tr>
              {['Field', 'Before', 'After'].map((header) => (
                <th
                  key={header}
                  style={{
                    textAlign: 'left',
                    padding: 'var(--pad-cell-dense) var(--space-3)',
                    font: 'var(--type-overline)',
                    textTransform: 'uppercase',
                    letterSpacing: 'var(--tracking-caps)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field} style={{ borderTop: '1px solid var(--border-default)' }}>
                <td
                  style={{
                    padding: 'var(--pad-cell-dense) var(--space-3)',
                    color: 'var(--text-body)',
                  }}
                >
                  {field}
                </td>
                <td
                  style={{
                    padding: 'var(--pad-cell-dense) var(--space-3)',
                    color: 'var(--text-secondary)',
                    wordBreak: 'break-word',
                  }}
                >
                  {displayValue(before?.[field])}
                </td>
                <td
                  style={{
                    padding: 'var(--pad-cell-dense) var(--space-3)',
                    color: 'var(--text-body)',
                    fontWeight: 'var(--weight-medium)',
                    wordBreak: 'break-word',
                  }}
                >
                  {displayValue(after?.[field])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
