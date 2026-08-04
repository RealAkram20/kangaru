import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { Identifier } from '../components/core/Identifier'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { LoadMore } from '../components/data/LoadMore'
import { Alert } from '../components/feedback/Alert'
import { EmptyState } from '../components/feedback/EmptyState'
import { FormField } from '../components/forms/FormField'
import { Input } from '../components/forms/Input'
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

interface Filters {
  auditable_type: string
  /**
   * One record's history. Only sent alongside `auditable_type` — ids are
   * per-table, and the server answers 422 for a bare id rather than
   * interleaving Company 3 with Vehicle 3.
   */
  auditable_id: string
  action: string
  user_id: string
  /** Free text, including over the recorded diff. */
  q: string
  /** YYYY-MM-DD. `to` is inclusive of its whole day, server-side. */
  from: string
  to: string
}

const EMPTY_FILTERS: Filters = {
  auditable_type: '',
  auditable_id: '',
  action: '',
  user_id: '',
  q: '',
  from: '',
  to: '',
}

function hasAnyFilter(filters: Filters): boolean {
  return Object.values(filters).some((value) => value !== '')
}

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
  // `draft` is what the controls show; `filters` is what the last request
  // actually used. Split because a date is typed a character at a time —
  // querying on each keystroke would fire "2026-0" as a range, and paging
  // must keep using the filters the current page was fetched with.
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
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
    (next: Filters, cursor: string | null) =>
      fetchEntries(next, cursor).then((result) => applyResult(result, cursor !== null), fail),
    [applyResult, fail],
  )

  useEffect(() => {
    void load(EMPTY_FILTERS, null)
  }, [load])

  const apply = (next: Filters) => {
    setDraft(next)
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
          {/* Spans the row: it is the widest question on this panel and the
              one a bank actually asks — "show me everything about the
              credit limit" — and the structured filters below narrow it. */}
          <FormField
            label="Search"
            htmlFor="a-q"
            hint="Also searches the recorded change itself, including field names."
            style={{ gridColumn: '1 / -1' }}
          >
            <Input
              id="a-q"
              iconLeft="search"
              placeholder="Field, record type, action or person — e.g. credit_limit_minor"
              value={draft.q}
              onChange={(e) => setDraft({ ...draft, q: e.target.value })}
              // Enter applies, matching the button beside it. A search box
              // that ignores Enter is the one control everybody tries first.
              onKeyDown={(e) => {
                if (e.key === 'Enter') apply(draft)
              }}
            />
          </FormField>
          <FormField label="Record type" htmlFor="a-type">
            <Select
              id="a-type"
              placeholder="Everything"
              value={draft.auditable_type}
              // Clearing the type clears the id with it: an id left behind
              // in a disabled box would silently stop being sent, and the
              // next Apply would quietly widen the results.
              onChange={(e) =>
                setDraft({
                  ...draft,
                  auditable_type: e.target.value,
                  auditable_id: e.target.value === '' ? '' : draft.auditable_id,
                })
              }
              // Straight from the server: this page holds no list of what
              // is auditable, so a newly audited model appears here without
              // a frontend release.
              options={(meta?.filters.auditable_types ?? []).map((type) => ({
                value: type,
                label: humaniseType(type),
              }))}
            />
          </FormField>
          <FormField
            label="Record id"
            htmlFor="a-id"
            hint={
              draft.auditable_type
                ? 'One record’s history.'
                : 'Choose a record type first — ids repeat across types.'
            }
          >
            <Input
              id="a-id"
              type="number"
              min={1}
              placeholder="Any"
              value={draft.auditable_id}
              // Disabled rather than hidden: the reason it is unavailable
              // is the hint beside it, and a control that appears only
              // after an unrelated choice is a control nobody finds.
              disabled={draft.auditable_type === ''}
              onChange={(e) => setDraft({ ...draft, auditable_id: e.target.value })}
            />
          </FormField>
          <FormField label="Action" htmlFor="a-action">
            <Select
              id="a-action"
              placeholder="Any action"
              value={draft.action}
              onChange={(e) => setDraft({ ...draft, action: e.target.value })}
              options={(meta?.filters.actions ?? []).map((action) => ({
                value: action,
                label: humaniseType(action),
              }))}
            />
          </FormField>
          <FormField label="Changed by" htmlFor="a-actor">
            <Select
              id="a-actor"
              placeholder="Anyone"
              value={draft.user_id}
              onChange={(e) => setDraft({ ...draft, user_id: e.target.value })}
              // The people in this log, not every account that exists — and
              // served, because a reader holding `audit.view` without
              // `staff.view` cannot call /users.
              options={(meta?.filters.actors ?? []).map((actor) => ({
                value: String(actor.value),
                label: actor.label,
              }))}
            />
          </FormField>
          <FormField label="From" htmlFor="a-from">
            <Input
              id="a-from"
              type="date"
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            />
          </FormField>
          <FormField label="To" htmlFor="a-to" hint="Includes the whole of this day.">
            <Input
              id="a-to"
              type="date"
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            />
          </FormField>
          <div style={{ display: 'flex', gap: 'var(--gap-inline)' }}>
            {/* Explicit, not on change: a date is typed a character at a
                time, and "2026-0" is not a range anybody meant to run. */}
            <Button iconLeft="filter" onClick={() => apply(draft)}>
              Apply filters
            </Button>
            {hasAnyFilter(filters) && (
              <Button variant="secondary" iconLeft="x" onClick={() => apply(EMPTY_FILTERS)}>
                Clear
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card padding="none">
        {entries !== null && entries.length === 0 ? (
          <EmptyState
            icon="file-clock"
            title={
              hasAnyFilter(filters)
                ? 'Nothing matches these filters'
                : 'Nothing has been recorded yet'
            }
            description={
              hasAnyFilter(filters)
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

        <LoadMore
          hasMore={meta?.cursor.next != null}
          loading={loadingMore}
          onLoadMore={() => void loadMore()}
        />
      </Card>
    </div>
  )
}

async function fetchEntries(
  filters: Filters,
  cursor: string | null,
): Promise<{ entries: AuditLogEntry[]; meta: AuditLogMeta | null }> {
  const params = new URLSearchParams()
  // Empty values are omitted rather than sent blank: `from=` fails the
  // server's Y-m-d format rule, so an untouched field would 422.
  if (filters.auditable_type) params.set('auditable_type', filters.auditable_type)
  // Only ever alongside the type: a bare id is a 422 by design, because
  // ids repeat across record types.
  //
  // Belt and braces, and knowingly so — the control is disabled without a
  // type and clearing the type clears the id, so no sequence of clicks
  // reaches here with one and not the other. Deleting this pairing does
  // not turn any test red, which is precisely why it is worth a sentence:
  // it exists for the next edit to the draft-state logic, not for today.
  if (filters.auditable_type && filters.auditable_id) {
    params.set('auditable_id', filters.auditable_id)
  }
  if (filters.action) params.set('action', filters.action)
  if (filters.user_id) params.set('user_id', filters.user_id)
  if (filters.q) params.set('q', filters.q)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
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
