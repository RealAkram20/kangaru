import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { apiClient } from '../lib/apiClient'
import { canManageBilling } from '../lib/billing'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import { formatTimestamp, formatUgx } from '../lib/format'
import {
  formatDistance,
  formatDuration,
  formatOdometer,
  isDestructiveTransition,
  tripStatusIcon,
  tripStatusLabel,
  tripStatusTone,
} from '../lib/tripStatus'
import type { ApiSuccess, FilterOption, ScopedCursorMeta, TenancyScope } from '../types/api'
import type { CursorMeta, Trip, TripEvent, TripStatus } from '../types/trip'
import { InvoiceTripDialog } from './trips/InvoiceTripDialog'
import { TransitionDialog } from './trips/TransitionDialog'
import { Alert } from '../components/feedback/Alert'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { Icon } from '../components/core/Icon'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { LoadMore } from '../components/data/LoadMore'
import { Input } from '../components/forms/Input'
import { Select } from '../components/forms/Select'

/**
 * The client column, prepended only on a cross-client listing.
 *
 * Shanitah's own staff belong to no tenant and so read every client's
 * trips in one table (ADR-0006). A client's own listing is all one
 * client's, and a column repeating their own name on every row is noise.
 */
const CLIENT_COLUMN: DataColumn<Trip> = {
  key: 'tenant_id',
  header: 'Client',
  render: (row) => row.client?.name ?? '—',
}

/**
 * `client` is a tenant id, or '' for every client. Only platform staff can
 * send it — the endpoint refuses it from anyone else — and the narrowing
 * happens server-side, unlike the search box which only ever sifted the
 * page already fetched.
 */
function tripsUrl(client: string, search: string, cursor: string | null = null): string {
  const params = new URLSearchParams()
  if (client !== '') params.set('tenant_id', client)
  // Server-side: a trip list is append-only and long, and searching the 25
  // rows in hand while reporting the rest as "no match" is a wrong answer.
  if (search !== '') params.set('q', search)
  // Opaque, and sent back unaltered: it encodes a sort position rather
  // than an offset, so trips created while somebody is paging do not shift
  // the page under them.
  if (cursor !== null) params.set('cursor', cursor)

  const query = params.toString()

  return query === '' ? '/trips' : `/trips?${query}`
}

const COLUMNS: DataColumn<Trip>[] = [
  {
    key: 'status',
    header: 'Status',
    render: (row) => (
      <Badge tone={tripStatusTone(row.status)} icon={tripStatusIcon(row.status)}>
        {tripStatusLabel(row.status)}
      </Badge>
    ),
  },
  {
    key: 'origin',
    header: 'Route',
    render: (row) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {row.origin}
        <Icon name="arrow-right" size={13} style={{ color: 'var(--text-secondary)' }} />
        {row.destination}
      </span>
    ),
  },
  {
    key: 'vehicle_id',
    header: 'Vehicle',
    render: (row) => row.vehicle?.registration_number ?? '—',
  },
  {
    key: 'driver_id',
    header: 'Driver',
    render: (row) => row.driver?.name ?? '—',
  },
  {
    key: 'odometer_start',
    header: 'Odometer',
    numeric: true,
    render: (row) => `${formatOdometer(row.odometer_start)} / ${formatOdometer(row.odometer_end)}`,
  },
  {
    key: 'distance_km',
    header: 'Distance',
    numeric: true,
    render: (row) => formatDistance(row.distance_km),
  },
  {
    key: 'duration_minutes',
    header: 'Duration',
    numeric: true,
    render: (row) => formatDuration(row.duration_minutes),
  },
  {
    key: 'started_at',
    header: 'Started',
    render: (row) => (row.started_at ? formatTimestamp(row.started_at) : '—'),
  },
  {
    key: 'completed_at',
    header: 'Completed',
    render: (row) => (row.completed_at ? formatTimestamp(row.completed_at) : '—'),
  },
]

export function TripsPage() {
  const { user } = useAuth()
  const [trips, setTrips] = useState<Trip[] | null>(null)
  // Whose trips these are, reported by the API rather than inferred from
  // the signed-in user (ADR-0006). Defaults to one client's, which shows a
  // column too few rather than mislabelling rows.
  const [scope, setScope] = useState<TenancyScope>('tenant')
  const [clients, setClients] = useState<FilterOption[]>([])
  // '' is every client. Narrowed server-side, unlike the search box.
  const [client, setClient] = useState('')
  const [next, setNext] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // Held back until typing settles — see BookingsPage. Every keystroke
  // would otherwise be a request, and their answers can land out of order.
  const search = useDebouncedValue(query.trim())
  const [selected, setSelected] = useState<Trip | null>(null)
  const [transitionTo, setTransitionTo] = useState<TripStatus | null>(null)
  const [invoicing, setInvoicing] = useState<Trip | null>(null)

  const columns = useMemo(
    () => (scope === 'platform' ? [CLIENT_COLUMN, ...COLUMNS] : COLUMNS),
    [scope],
  )

  /**
   * Re-reads from the first page.
   *
   * Drops any pages already loaded rather than re-fetching all of them:
   * whatever triggered this changed a trip's status, the list is ordered
   * by creation and filtered by nothing, and stitching a fresh first page
   * onto stale later ones can show the same trip twice.
   */
  const refresh = useCallback(async () => {
    try {
      const response = await apiClient.get<ApiSuccess<Trip[], ScopedCursorMeta>>(tripsUrl(client, search))
      setTrips(response.data.data)
      setScope(response.data.meta?.scope ?? 'tenant')
      setClients(response.data.meta?.filters?.clients ?? [])
      setNext(response.data.meta?.cursor?.next ?? null)
      // Keep the open panel pointing at the refreshed row, so its actions
      // reflect the status the server now holds.
      setSelected((current) =>
        current ? (response.data.data.find((trip) => trip.id === current.id) ?? null) : null,
      )
    } catch {
      setError('Could not load trips.')
    }
  }, [client, search])

  const loadMore = useCallback(async () => {
    if (next === null) return

    setLoadingMore(true)
    try {
      const response = await apiClient.get<ApiSuccess<Trip[], ScopedCursorMeta>>(
        tripsUrl(client, search, next),
      )
      // Appended, so the trips already read stay put — this is the one
      // path that must not replace the list.
      setTrips((current) => [...(current ?? []), ...response.data.data])
      setNext(response.data.meta?.cursor?.next ?? null)
    } catch {
      setError('Could not load trips.')
    } finally {
      setLoadingMore(false)
    }
  }, [client, search, next])

  // Promise chain rather than `void refresh()` so the state update lands
  // in a callback — setState straight from an effect body cascades renders.
  useEffect(() => {
    let cancelled = false

    apiClient
      .get<ApiSuccess<Trip[], ScopedCursorMeta>>(tripsUrl(client, search))
      .then((response) => {
        if (cancelled) return

        setTrips(response.data.data)
        setScope(response.data.meta?.scope ?? 'tenant')
        setClients(response.data.meta?.filters?.clients ?? [])
        setNext(response.data.meta?.cursor?.next ?? null)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load trips.')
      })

    return () => {
      cancelled = true
    }
    // Re-fetches on a client change: the narrowing is server-side, so the
    // other clients' rows were never here to filter.
  }, [client, search])

  // The response to a transition is the updated trip, so the row and the
  // open panel are refreshed from it rather than re-fetching the list.
  const applyTransition = (updated: Trip) => {
    setTrips((current) => current?.map((t) => (t.id === updated.id ? updated : t)) ?? null)
    setSelected(updated)
    setTransitionTo(null)
  }

  // Already what the server matched — route, registration, driver, status
  // and, for a cross-client reader, the client's name. Filtering again here
  // would only be able to narrow the page in hand.
  const rows = trips ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {notice && (
        <Alert tone="success" title="Invoice issued" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Card
        title="Trips"
        subtitle={trips ? `${trips.length} total — select a trip to see its timeline` : undefined}
        actions={
          <>
            {/* Server-side, so it sits ahead of the search box — see BookingsPage. */}
            {scope === 'platform' && clients.length > 0 && (
              <Select
                aria-label="Client"
                value={client}
                onChange={(e) => setClient(e.target.value)}
                options={[
                  { value: '', label: 'All clients' },
                  ...clients.map((c) => ({ value: String(c.value), label: c.label })),
                ]}
                style={{ width: 200 }}
              />
            )}
            <Input
              iconLeft="search"
              placeholder={
                scope === 'platform'
                  ? 'Filter by client, route, vehicle, driver or status'
                  : 'Filter by route, vehicle, driver or status'
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: 300 }}
            />
          </>
        }
        padding="none"
      >
        {error ? (
          <p style={{ padding: 'var(--space-6)', color: 'var(--kr-error)' }}>{error}</p>
        ) : (
          <DataTable<Trip>
            columns={columns}
            rows={rows}
            dense
            onRowClick={(row) => setSelected((current) => (current?.id === row.id ? null : row))}
            emptyMessage={trips === null ? 'Loading…' : query ? 'No trips match your filter' : 'No trips yet'}
          />
        )}

        {/* Outside the filtered set — see BookingsPage. A search matching
            nothing on this page must still be able to fetch the next. */}
        <LoadMore hasMore={next !== null} loading={loadingMore} onLoadMore={() => void loadMore()} />
      </Card>

      {/* Keyed by id so switching trips remounts with fresh state rather
          than clearing the previous trip's events inside an effect. */}
      {selected && (
        <TripTimeline
          key={selected.id}
          trip={selected}
          onClose={() => setSelected(null)}
          onTransition={setTransitionTo}
          onInvoice={() => setInvoicing(selected)}
          canInvoice={selected.status === 'trip_completed' && canManageBilling(user)}
        />
      )}

      {selected && transitionTo && (
        <TransitionDialog
          trip={selected}
          to={transitionTo}
          onClose={() => setTransitionTo(null)}
          onDone={applyTransition}
        />
      )}

      {invoicing && (
        <InvoiceTripDialog
          trip={invoicing}
          onClose={() => setInvoicing(null)}
          onIssued={(invoice) => {
            setInvoicing(null)
            setNotice(
              `${invoice.invoice_number} raised for ${formatUgx(invoice.total_minor)}. See it on the Invoices page.`,
            )
            // The trip moved to Invoice Generated inside the same backend
            // transaction, so the row here is stale — re-read rather than
            // guess at the new status.
            void refresh()
          }}
        />
      )}
    </div>
  )
}

/**
 * The trip's bank-required facts, the actions its current state permits,
 * and the append-only `trip_events` timeline.
 *
 * The action buttons come from `trip.allowed_transitions`, which the API
 * derives from TripStatus — this component has no copy of the lifecycle
 * graph and cannot drift from it. What the *user* may do is still the
 * server's call; an unauthorised attempt comes back 403.
 */
function TripTimeline({
  trip,
  onClose,
  onTransition,
  onInvoice,
  canInvoice,
}: {
  trip: Trip
  onClose: () => void
  onTransition: (to: TripStatus) => void
  onInvoice: () => void
  canInvoice: boolean
}) {
  const [events, setEvents] = useState<TripEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // `invoice_generated` is filtered out rather than rendered: it is a legal
  // next state, but not one a client may ask the transitions endpoint for.
  const actions = trip.allowed_transitions.filter((to) => to !== 'invoice_generated')

  useEffect(() => {
    let cancelled = false

    apiClient
      .get<ApiSuccess<TripEvent[], CursorMeta>>(`/trips/${trip.id}/events`)
      .then((response) => {
        if (!cancelled) setEvents(response.data.data)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this trip’s timeline.')
      })

    return () => {
      cancelled = true
    }
  }, [trip.id])

  return (
    <Card
      title={`Trip #${trip.id} — ${trip.origin} → ${trip.destination}`}
      subtitle={`${trip.vehicle?.registration_number ?? 'No vehicle'} · ${trip.driver?.name ?? 'No driver'}`}
      actions={
        <button
          onClick={onClose}
          aria-label="Close timeline"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            font: 'var(--type-label)',
            color: 'var(--text-secondary)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <Icon name="x" size={14} />
          Close
        </button>
      }
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <Fact label="Opening odometer" value={formatOdometer(trip.odometer_start)} />
        <Fact label="Closing odometer" value={formatOdometer(trip.odometer_end)} />
        <Fact label="Distance travelled" value={formatDistance(trip.distance_km)} />
        <Fact label="Duration" value={formatDuration(trip.duration_minutes)} />
        <Fact label="Commenced" value={trip.started_at ? formatTimestamp(trip.started_at) : '—'} />
        <Fact label="Completed" value={trip.completed_at ? formatTimestamp(trip.completed_at) : '—'} />
      </div>

      {(actions.length > 0 || canInvoice) && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--gap-inline)',
            paddingBottom: 'var(--space-6)',
            borderBottom: '1px solid var(--border-default)',
            marginBottom: 'var(--space-6)',
          }}
        >
          {actions.map((to) => (
            <Button
              key={to}
              size="sm"
              variant={isDestructiveTransition(to) ? 'secondary' : 'primary'}
              iconLeft={tripStatusIcon(to)}
              onClick={() => onTransition(to)}
            >
              {tripStatusLabel(to)}
            </Button>
          ))}
          {/* Invoice Generated is the one allowed transition with no button
              of its own: Modules\Billing applies it inside the transaction
              that issues the invoice, and the transitions endpoint refuses
              it outright. Offering it here would be a button that always
              422s. */}
          {canInvoice && (
            <Button size="sm" iconLeft="receipt" onClick={onInvoice}>
              Generate invoice
            </Button>
          )}
        </div>
      )}

      {error && <p style={{ color: 'var(--kr-error)' }}>{error}</p>}
      {!error && events === null && <p style={{ color: 'var(--text-secondary)' }}>Loading timeline…</p>}

      {events && (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {events.map((event, index) => (
            <li key={event.id} style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: 'var(--surface-sunken)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-secondary)',
                    flexShrink: 0,
                  }}
                >
                  <Icon name={tripStatusIcon(event.to_status)} size={12} />
                </span>
                {index < events.length - 1 && (
                  <span style={{ flex: 1, width: 1, background: 'var(--border-default)', minHeight: 16 }} />
                )}
              </div>
              <div style={{ paddingBottom: index < events.length - 1 ? 'var(--space-4)' : 0, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <Badge tone={tripStatusTone(event.to_status)} size="sm">
                    {tripStatusLabel(event.to_status)}
                  </Badge>
                  <span style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
                    {formatTimestamp(event.created_at)}
                  </span>
                  {event.from_status && (
                    <span style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
                      from {tripStatusLabel(event.from_status as TripStatus)}
                    </span>
                  )}
                </div>
                <p style={{ font: 'var(--type-body-dense)', color: 'var(--text-body)', marginTop: 4 }}>
                  {event.user ? event.user.name : 'System'}
                  {event.notes && <span style={{ color: 'var(--text-secondary)' }}> — {event.notes}</span>}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>{label}</p>
      <p
        style={{
          font: 'var(--type-body)',
          color: 'var(--text-heading)',
          fontVariantNumeric: 'tabular-nums',
          marginTop: 2,
        }}
      >
        {value}
      </p>
    </div>
  )
}
