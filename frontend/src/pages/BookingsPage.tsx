import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { apiClient } from '../lib/apiClient'
import { apiError, fieldErrors } from '../lib/apiError'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import { bookingStatusIcon, bookingStatusLabel, bookingStatusTone, pickupLabel } from '../lib/bookingStatus'
import type { ApiSuccess, FilterOption, ScopedCursorMeta, TenancyScope } from '../types/api'
import type { Booking } from '../types/booking'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { Alert } from '../components/feedback/Alert'
import { Dialog } from '../components/feedback/Dialog'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { LoadMore } from '../components/data/LoadMore'
import { FormField } from '../components/forms/FormField'
import { Input } from '../components/forms/Input'
import { Select } from '../components/forms/Select'

/**
 * Roles the backend's BookingPolicy lets approve or reject. Mirrored here
 * only to decide whether to *render* the buttons — the server is still the
 * authority and returns 403 regardless (AGENTS.md: never rely solely on
 * frontend permissions).
 */
const APPROVER_ROLES = ['super_admin', 'operations_manager', 'corporate_admin', 'branch_manager']

interface BookingList {
  rows: Booking[]
  /**
   * Whose bookings these are, straight from the API (ADR-0006). Read
   * rather than worked out from the signed-in user, so this page holds no
   * copy of the rule that decides who reads across clients.
   */
  scope: TenancyScope
  /** The clients this reader may narrow to; empty for a client's own user. */
  clients: FilterOption[]
  /** Opaque cursor for the next page, or null at the end of the list. */
  next: string | null
}

/**
 * `client` narrows server-side, which is the point: the filter box below
 * only ever searched the page already fetched, and at fifty clients that
 * is the wrong answer rather than a slow one.
 *
 * `cursor` continues the same query. It is opaque and must be sent back
 * unaltered — it encodes the sort position, not an offset, which is why
 * rows inserted while somebody is paging do not shift the page under them.
 */
async function fetchBookings(
  client: string,
  search: string,
  cursor: string | null,
): Promise<BookingList> {
  const params = new URLSearchParams()
  if (client !== '') params.set('tenant_id', client)
  // Server-side since the queue can be longer than a page: the old
  // in-browser filter searched the 25 rows in hand and reported the rest
  // as "no match", which is a wrong answer rather than a slow one.
  if (search !== '') params.set('q', search)
  if (cursor !== null) params.set('cursor', cursor)

  const query = params.toString()

  const response = await apiClient.get<ApiSuccess<Booking[], ScopedCursorMeta>>(
    query === '' ? '/bookings' : `/bookings?${query}`,
  )

  return {
    rows: response.data.data,
    // Defaulted, not assumed: an older API that does not send it is one
    // client's listing, which is the safe reading — it shows a column too
    // few rather than mislabelling rows.
    scope: response.data.meta?.scope ?? 'tenant',
    clients: response.data.meta?.filters?.clients ?? [],
    next: response.data.meta?.cursor?.next ?? null,
  }
}

function onLoadFailure(setError: (message: string) => void) {
  return (error: unknown) => setError(apiError(error, 'Could not load bookings.').message)
}

export function BookingsPage() {
  const { user } = useAuth()
  const [bookings, setBookings] = useState<Booking[] | null>(null)
  const [scope, setScope] = useState<TenancyScope>('tenant')
  const [clients, setClients] = useState<FilterOption[]>([])
  // '' is "every client", which is what a dispatch desk wants on open.
  const [client, setClient] = useState('')
  const [next, setNext] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // What the box shows vs. what the last request used. Every keystroke
  // would otherwise be a request, and their answers can arrive out of
  // order — "E" resolving after "Entebbe" leaves the wrong rows on screen.
  const search = useDebouncedValue(query.trim())
  const [creating, setCreating] = useState(false)
  const [decision, setDecision] = useState<{ booking: Booking; kind: 'rejection' | 'cancellation' } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Kept free of setState so the effect below only ever sets state from a
  // promise callback, never synchronously in its body.
  //
  // `append` is what distinguishes a next page from a fresh query. Paging
  // accumulates so the rows already read stay on screen; anything else —
  // changing client, acting on a booking — replaces, because the list it
  // was paging through no longer describes the query.
  const apply = useCallback((list: BookingList, append: boolean) => {
    setBookings((current) => (append ? [...(current ?? []), ...list.rows] : list.rows))
    setScope(list.scope)
    setClients(list.clients)
    setNext(list.next)
    setLoadError(null)
  }, [])

  /**
   * Re-reads from the first page.
   *
   * Called after approving, rejecting or cancelling. It deliberately drops
   * any pages already loaded rather than re-fetching all of them: the act
   * that triggered it changed a status, which changes the ordering, and
   * stitching a refreshed first page onto stale later ones can show the
   * same booking twice.
   */
  const load = useCallback(
    () => fetchBookings(client, search, null).then((list) => apply(list, false), onLoadFailure(setLoadError)),
    [apply, client, search],
  )

  // Re-runs when the chosen client changes, because the narrowing happens
  // on the server now — the rows for another client were never fetched.
  useEffect(() => {
    let cancelled = false

    fetchBookings(client, search, null)
      .then((list) => {
        if (!cancelled) apply(list, false)
      })
      .catch((error: unknown) => {
        if (!cancelled) onLoadFailure(setLoadError)(error)
      })

    return () => {
      cancelled = true
    }
  }, [apply, client, search])

  const loadMore = useCallback(async () => {
    if (next === null) return

    setLoadingMore(true)
    try {
      apply(await fetchBookings(client, search, next), true)
    } catch (error) {
      onLoadFailure(setLoadError)(error)
    } finally {
      setLoadingMore(false)
    }
  }, [apply, client, search, next])

  const canApprove = user !== null && APPROVER_ROLES.includes(user.role)

  const approve = useCallback(
    async (booking: Booking) => {
      setActionError(null)
      try {
        await apiClient.post(`/bookings/${booking.id}/approval`)
        await load()
      } catch (error) {
        setActionError(apiError(error, 'Could not approve this booking.').message)
      }
    },
    [load],
  )

  const columns = useMemo<DataColumn<Booking>[]>(
    () => [
      // First column, and only on a cross-client listing. Shanitah's own
      // staff read every client's bookings in one table (ADR-0006); without
      // this the table is a merged queue with nothing distinguishing one
      // client's request from another's.
      ...(scope === 'platform'
        ? [
            {
              key: 'tenant_id',
              header: 'Client',
              render: (row: Booking) => row.client?.name ?? '—',
            } satisfies DataColumn<Booking>,
          ]
        : []),
      {
        key: 'status',
        header: 'Status',
        render: (row) => (
          <Badge tone={bookingStatusTone(row.status)} icon={bookingStatusIcon(row.status)}>
            {bookingStatusLabel(row.status)}
          </Badge>
        ),
      },
      { key: 'scheduled_for', header: 'Pickup', render: (row) => pickupLabel(row) },
      {
        key: 'origin',
        header: 'Route',
        render: (row) => `${row.origin} → ${row.destination}`,
      },
      { key: 'passenger_name', header: 'Passenger' },
      { key: 'passenger_count', header: 'Pax', numeric: true },
      {
        key: 'requested_by_user_id',
        header: 'Requested by',
        render: (row) => row.requested_by?.name ?? '—',
      },
      {
        key: 'decision_reason',
        header: 'Reason',
        wrap: true,
        render: (row) => row.decision_reason ?? '—',
      },
      {
        key: 'id',
        header: 'Actions',
        render: (row) => {
          // Only a pending booking can still be approved or rejected; the
          // backend enforces this with a 409 either way.
          if (row.status !== 'pending') return null

          return (
            <span style={{ display: 'inline-flex', gap: 6 }}>
              {canApprove && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => void approve(row)}>
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setDecision({ booking: row, kind: 'rejection' })}
                  >
                    Reject
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDecision({ booking: row, kind: 'cancellation' })}
              >
                Cancel
              </Button>
            </span>
          )
        },
      },
    ],
    [canApprove, approve, scope],
  )

  // The rows are already what the server matched, so there is nothing left
  // to filter here. The in-browser version this replaces searched only the
  // page in hand and reported everything beyond it as "no match".
  const rows = bookings ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {loadError && <Alert tone="error" title="Bookings unavailable">{loadError}</Alert>}
      {actionError && (
        <Alert tone="warning" title="Action refused" onDismiss={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      <Card
        title="Bookings"
        subtitle={bookings ? `${bookings.length} total` : undefined}
        padding="none"
        actions={
          <>
            {/*
              Before the search box, because it narrows what is fetched
              rather than what is displayed. The two read as one control
              otherwise, and a dispatcher would reasonably expect typing a
              client's name to do the same job — it does not, and cannot,
              past the first page.
            */}
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
                  ? 'Filter by client, route, passenger or status'
                  : 'Filter by route, passenger or status'
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: 280 }}
            />
            <Button iconLeft="plus" onClick={() => setCreating(true)}>
              New booking
            </Button>
          </>
        }
      >
        <DataTable<Booking>
          columns={columns}
          rows={rows}
          dense
          emptyMessage={
            bookings === null ? 'Loading…' : query ? 'No bookings match your filter' : 'No bookings yet'
          }
        />

        {/*
          The cursor now belongs to the *searched* query, so "load more"
          continues the search rather than escaping it — which is why the
          in-browser filter had to go first. Paging a client-side filter
          would have loaded the next 25 unfiltered rows into a filtered
          list.
        */}
        <LoadMore hasMore={next !== null} loading={loadingMore} onLoadMore={() => void loadMore()} />
      </Card>

      {creating && (
        <NewBookingDialog
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false)
            await load()
          }}
        />
      )}

      {decision && (
        <DecisionDialog
          booking={decision.booking}
          kind={decision.kind}
          onClose={() => setDecision(null)}
          onDecided={async () => {
            setDecision(null)
            await load()
          }}
        />
      )}
    </div>
  )
}

function NewBookingDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({
    passenger_name: '',
    passenger_phone: '',
    passenger_count: '1',
    origin: '',
    destination: '',
    scheduled_for: '',
    notes: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }))

  const submit = async () => {
    setSubmitting(true)
    setErrors({})
    setMessage(null)

    try {
      await apiClient.post('/bookings', {
        passenger_name: form.passenger_name,
        passenger_phone: form.passenger_phone,
        passenger_count: Number(form.passenger_count) || 1,
        origin: form.origin,
        destination: form.destination,
        // Empty means immediate. The backend treats a missing
        // `scheduled_for` as "now", so send null rather than "".
        scheduled_for: form.scheduled_for === '' ? null : new Date(form.scheduled_for).toISOString(),
        notes: form.notes === '' ? null : form.notes,
      })

      await onCreated()
    } catch (error) {
      const failure = apiError(error, 'Could not create this booking.')
      setErrors(fieldErrors(failure))
      setMessage(failure.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      title="New booking"
      description="Leave the pickup time empty to request transport immediately."
      onClose={onClose}
      width={600}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button iconLeft="check" loading={submitting} onClick={() => void submit()}>
            Create booking
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {message && Object.keys(errors).length === 0 && (
          <Alert tone="error" title="Booking not created">
            {message}
          </Alert>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <FormField label="Passenger" htmlFor="b-name" required error={errors.passenger_name}>
            <Input id="b-name" value={form.passenger_name} onChange={set('passenger_name')} />
          </FormField>
          <FormField label="Contact number" htmlFor="b-phone" required error={errors.passenger_phone}>
            <Input
              id="b-phone"
              value={form.passenger_phone}
              onChange={set('passenger_phone')}
              placeholder="+256700000000"
            />
          </FormField>
          <FormField label="Pick-up" htmlFor="b-origin" required error={errors.origin}>
            <Input id="b-origin" value={form.origin} onChange={set('origin')} />
          </FormField>
          <FormField label="Destination" htmlFor="b-destination" required error={errors.destination}>
            <Input id="b-destination" value={form.destination} onChange={set('destination')} />
          </FormField>
          <FormField label="Passengers" htmlFor="b-count" error={errors.passenger_count}>
            <Input id="b-count" type="number" min={1} value={form.passenger_count} onChange={set('passenger_count')} />
          </FormField>
          <FormField
            label="Pickup time"
            htmlFor="b-when"
            hint="Empty = now"
            error={errors.scheduled_for}
          >
            <Input
              id="b-when"
              type="datetime-local"
              value={form.scheduled_for}
              onChange={set('scheduled_for')}
            />
          </FormField>
        </div>

        <FormField label="Notes" htmlFor="b-notes" hint="Anything the dispatcher should know" error={errors.notes}>
          <Input id="b-notes" value={form.notes} onChange={set('notes')} />
        </FormField>
      </div>
    </Dialog>
  )
}

function DecisionDialog({
  booking,
  kind,
  onClose,
  onDecided,
}: {
  booking: Booking
  kind: 'rejection' | 'cancellation'
  onClose: () => void
  onDecided: () => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const rejecting = kind === 'rejection'

  const submit = async () => {
    setSubmitting(true)
    setError(null)

    try {
      await apiClient.post(`/bookings/${booking.id}/${kind}`, { reason })
      await onDecided()
    } catch (failure) {
      setError(apiError(failure, 'Could not record this decision.').message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      tone="warning"
      title={rejecting ? 'Reject this booking' : 'Cancel this booking'}
      description={`${booking.origin} → ${booking.destination} for ${booking.passenger_name}.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Back
          </Button>
          <Button
            variant="destructive"
            loading={submitting}
            disabled={reason.trim() === ''}
            onClick={() => void submit()}
          >
            {rejecting ? 'Reject booking' : 'Cancel booking'}
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="error" title="Not recorded" style={{ marginBottom: 'var(--space-4)' }}>
          {error}
        </Alert>
      )}
      <FormField
        label="Reason"
        htmlFor="decision-reason"
        required
        hint="Recorded against the booking and shown to the requester."
      >
        <Input id="decision-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
    </Dialog>
  )
}
