import { useCallback, useEffect, useState } from 'react'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { Identifier } from '../components/core/Identifier'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { KPIStat } from '../components/data/KPIStat'
import { LoadMore } from '../components/data/LoadMore'
import { Alert } from '../components/feedback/Alert'
import { EmptyState } from '../components/feedback/EmptyState'
import { PanelBoundary } from '../components/feedback/PanelBoundary'
import { apiClient } from '../lib/apiClient'
import { fieldFirstMessage } from '../lib/apiError'
import { formatTimestamp } from '../lib/format'
import type { ApiSuccess } from '../types/api'
import type { DistanceGrade } from '../types/report'
import type { HeldTrip } from '../types/trip'
import { ClearDistanceDialog } from './trips/ClearDistanceDialog'

/**
 * The distance review queue (ADR-0045 §2).
 *
 * The screen `docs/measured-distance-plan.md` Phase 3 asks for and PROJECT.md
 * already sets a metric against — "flagged trips reviewed within two business
 * days" — which until now had nothing to be measured on.
 *
 * **A worklist, not a report.** Oldest first, no filters, one action per row:
 * everything here is waiting on the same decision, and narrowing it would be
 * a way of not seeing part of the backlog. `Reports → Measured distance` is
 * where resolutions are looked at any way you like.
 *
 * Every figure comes from the server. The waiting count is the server's too,
 * so the tile and the rows cannot disagree about the size of the backlog.
 */

const GRADE_TONE: Record<DistanceGrade, 'success' | 'info' | 'warning' | 'neutral'> = {
  A: 'success',
  B: 'info',
  C: 'warning',
  U: 'neutral',
}

function km(value: number | null): string {
  return value === null
    ? '—'
    : `${value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`
}

type QueueRow = HeldTrip & { id: number }

export function DistanceReviewPage() {
  const [rows, setRows] = useState<HeldTrip[] | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clearing, setClearing] = useState<HeldTrip | null>(null)
  const [cleared, setCleared] = useState<string | null>(null)

  const load = useCallback(
    () =>
      apiClient
        .get<ApiSuccess<HeldTrip[], { cursor: { next: string | null }; total: number }>>(
          '/trips/distance-review',
        )
        .then((response) => {
          setRows(response.data.data)
          setTotal(response.data.meta?.total ?? 0)
          setNextCursor(response.data.meta?.cursor.next ?? null)
          setError(null)
        })
        .catch((failure: unknown) =>
          setError(fieldFirstMessage(failure, 'Could not load the review queue.')),
        ),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  const loadMore = () => {
    if (nextCursor === null) return

    setLoadingMore(true)
    apiClient
      .get<ApiSuccess<HeldTrip[], { cursor: { next: string | null }; total: number }>>(
        `/trips/distance-review?cursor=${encodeURIComponent(nextCursor)}`,
      )
      .then((response) => {
        setRows((current) => [...(current ?? []), ...response.data.data])
        setNextCursor(response.data.meta?.cursor.next ?? null)
      })
      .catch((failure: unknown) =>
        setError(fieldFirstMessage(failure, 'Could not load more rows.')),
      )
      .finally(() => setLoadingMore(false))
  }

  // The oldest thing waiting, which is what the two-business-day metric is
  // actually about — a backlog of forty that is all from this morning is a
  // different problem from a backlog of two that has been sitting a week.
  const oldest = rows?.reduce<number | null>(
    (worst, row) => (row.waiting_days === null ? worst : Math.max(worst ?? 0, row.waiting_days)),
    null,
  )

  const columns: DataColumn<QueueRow>[] = [
    {
      key: 'trip_id',
      header: 'Trip',
      render: (row) => <Identifier size="xs">#{row.trip_id}</Identifier>,
    },
    {
      key: 'waiting_days',
      header: 'Waiting',
      render: (row) =>
        row.waiting_days === null ? (
          '—'
        ) : (
          // Two business days is the promise; past it the row says so rather
          // than leaving a reviewer to do the arithmetic.
          <Badge tone={row.waiting_days > 2 ? 'warning' : 'neutral'} size="sm">
            {row.waiting_days === 0
              ? 'Today'
              : `${row.waiting_days} day${row.waiting_days === 1 ? '' : 's'}`}
          </Badge>
        ),
    },
    {
      key: 'grade',
      header: 'Grade',
      render: (row) => (
        <Badge tone={GRADE_TONE[row.grade]} size="sm">
          {row.grade} · {row.grade_label}
        </Badge>
      ),
    },
    { key: 'origin', header: 'From' },
    { key: 'destination', header: 'To' },
    {
      key: 'client',
      header: 'Client',
      // Absent for a client's own user — they have exactly one and it is not
      // a fact worth repeating on every row. Null on a walk-in, which belongs
      // to the platform.
      render: (row) => row.client ?? (row.is_walk_in ? 'Walk-in' : '—'),
    },
    {
      key: 'vehicle_registration',
      header: 'Vehicle',
      render: (row) =>
        row.vehicle_registration ? (
          <Identifier kind="plate" size="xs">
            {row.vehicle_registration}
          </Identifier>
        ) : (
          '—'
        ),
    },
    { key: 'driver_name', header: 'Driver', render: (row) => row.driver_name ?? '—' },
    { key: 'billed_km', header: 'Would bill', render: (row) => km(row.billed_km) },
    { key: 'odometer_km', header: 'Odometer', render: (row) => km(row.odometer_km) },
    {
      key: 'completed_at',
      header: 'Completed',
      render: (row) => (row.completed_at ? formatTimestamp(row.completed_at) : '—'),
    },
    {
      key: 'fare_settled',
      header: '',
      render: (row) => (
        <Button size="sm" variant="secondary" onClick={() => setClearing(row)}>
          Review
        </Button>
      ),
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {error !== null && (
        <Alert tone="error" title="Review queue" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {cleared !== null && (
        <Alert tone="success" title="Cleared" onDismiss={() => setCleared(null)}>
          {cleared}
        </Alert>
      )}

      <PanelBoundary label="the review queue summary">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 'var(--space-4)',
          }}
        >
          <KPIStat
            label="Waiting on review"
            value={total === null ? '—' : total.toLocaleString('en-US')}
            icon="scale"
            hint={
              total === 0
                ? 'Nothing is held. Every completed trip can be billed.'
                : 'Each of these is a fare or an invoice that cannot be raised until somebody decides.'
            }
          />
          <KPIStat
            label="Longest wait"
            value={
              oldest === null || oldest === undefined
                ? '—'
                : `${oldest} day${oldest === 1 ? '' : 's'}`
            }
            icon={
              oldest !== null && oldest !== undefined && oldest > 2 ? 'triangle-alert' : 'clock'
            }
            hint="The platform's promise is two business days from the resolution."
          />
        </div>
      </PanelBoundary>

      <PanelBoundary label="the review queue">
        <Card padding="none">
          {rows !== null && rows.length === 0 ? (
            <EmptyState
              icon="circle-check"
              title="Nothing is waiting on a review"
              description="Every completed trip's distance has either been verified or cleared. Held trips appear here the moment the resolver decides it cannot vouch for one."
            />
          ) : (
            <>
              <DataTable<QueueRow>
                columns={columns}
                rows={(rows ?? []).map((row) => ({ ...row, id: row.trip_id }))}
                dense
                emptyMessage={rows === null ? 'Loading…' : 'Nothing is waiting on a review'}
              />
              <LoadMore hasMore={nextCursor !== null} loading={loadingMore} onLoadMore={loadMore} />
            </>
          )}
        </Card>
      </PanelBoundary>

      {clearing !== null && (
        <ClearDistanceDialog
          trip={clearing}
          onClose={() => setClearing(null)}
          onCleared={(tripId) => {
            setClearing(null)
            setCleared(
              `Trip #${tripId} is cleared. ${
                clearing.is_walk_in
                  ? 'The driver’s fare settles on the figure you saw.'
                  : 'It can now be invoiced.'
              }`,
            )
            // Reloaded rather than spliced out of the list: the count and the
            // rows both come from the server, and inventing the new state
            // here is how the two drift apart.
            void load()
          }}
        />
      )}
    </div>
  )
}
