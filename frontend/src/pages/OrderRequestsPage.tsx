import { useCallback, useEffect, useState } from 'react'
import { isAxiosError } from 'axios'
import { apiClient } from '../lib/apiClient'
import { formatTimestamp } from '../lib/format'

/**
 * The walk-in order queue (ADR-0012 §4): what the public form feeds and a
 * platform dispatcher works through by phone. Oldest first, because the
 * request that has waited longest is the next call to make.
 *
 * The route is not behind RequireNavAccess (same reasoning as Roles): a
 * custom role holding `order_requests.manage` is invisible to a slug list,
 * so the page gates on whether the API answers.
 */

interface OrderRequestRow {
  id: number
  reference: string
  service_type: string
  status: string
  allowed_transitions: string[]
  contact_name: string
  contact_phone: string
  contact_email: string | null
  pickup_location: string | null
  dropoff_location: string | null
  scheduled_for: string | null
  details: Record<string, string | number> | null
  notes: string | null
  dispatcher_notes: string | null
  handled_by: { id: number; name: string } | null
  created_at: string
}

const SERVICE_LABELS: Record<string, string> = {
  ride: 'Ride',
  delivery: 'Delivery',
  self_drive: 'Self drive',
}

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  converted: 'Converted',
  closed: 'Closed',
}

const TRANSITION_ACTIONS: Record<string, string> = {
  contacted: 'Mark contacted',
  converted: 'Mark converted',
  closed: 'Close',
}

async function fetchQueue(statusFilter: string): Promise<OrderRequestRow[]> {
  const query = statusFilter ? `?status=${statusFilter}` : ''
  const response = await apiClient.get(`/order-requests${query}`)

  return response.data.data.order_requests as OrderRequestRow[]
}

export function OrderRequestsPage() {
  const [rows, setRows] = useState<OrderRequestRow[] | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [refused, setRefused] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyResult = useCallback((fetched: OrderRequestRow[]) => {
    setRows(fetched)
    setError(null)
  }, [])

  const fail = useCallback((failure: unknown) => {
    // 403 is an answer, not a fault: the reader does not hold
    // `order_requests.manage` (same stance as AuditLogPage).
    if (isAxiosError(failure) && failure.response?.status === 403) {
      setRefused(true)

      return
    }
    setError('The queue could not be loaded. Please try again.')
  }, [])

  const load = useCallback(
    () => fetchQueue(statusFilter).then(applyResult, fail),
    [statusFilter, applyResult, fail],
  )

  useEffect(() => {
    void load()
  }, [load])

  const move = (row: OrderRequestRow, to: string) =>
    apiClient
      .patch(`/order-requests/${row.id}`, { status: to })
      .then(load)
      .catch(() => setError(`${row.reference} could not be updated. Reload and try again.`))

  if (refused) {
    return (
      <p className="text-text-secondary">
        Walk-in orders are handled by the platform dispatch desk. Your account does not have access
        to this queue.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-border-input bg-surface-page px-3 py-2 text-text-body"
          >
            <option value="">All</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error !== null && (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </p>
      )}

      {rows === null ? (
        <div className="space-y-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-surface-sunken" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-card px-6 py-12 text-center">
          <p className="font-medium text-text-heading">No walk-in orders here</p>
          <p className="mt-1 text-sm text-text-secondary">
            New requests from the public order page land in this queue and notify you.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id} className="rounded-xl border border-border bg-surface-card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono font-semibold text-text-heading">
                      {row.reference}
                    </span>
                    <span className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-text-secondary">
                      {SERVICE_LABELS[row.service_type] ?? row.service_type}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        row.status === 'new'
                          ? 'bg-brand-green-tint text-brand-green-dark'
                          : 'bg-surface-sunken text-text-secondary'
                      }`}
                    >
                      {STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-text-body">
                    {row.contact_name} · {row.contact_phone}
                  </p>
                  {row.pickup_location !== null && (
                    <p className="mt-1 text-sm text-text-secondary">
                      {row.pickup_location}
                      {row.dropoff_location !== null && ` → ${row.dropoff_location}`}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-text-secondary">
                    Received {formatTimestamp(row.created_at)}
                    {row.scheduled_for !== null &&
                      ` · wanted for ${formatTimestamp(row.scheduled_for)}`}
                    {row.handled_by !== null && ` · handled by ${row.handled_by.name}`}
                  </p>
                  {row.notes !== null && (
                    <p className="mt-2 text-sm italic text-text-secondary">"{row.notes}"</p>
                  )}
                </div>
                {row.allowed_transitions.length > 0 && (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {row.allowed_transitions.map((to) => (
                      <button
                        key={to}
                        type="button"
                        onClick={() => void move(row, to)}
                        className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-text-body transition-colors hover:border-brand-green hover:text-brand-green"
                      >
                        {TRANSITION_ACTIONS[to] ?? to}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
