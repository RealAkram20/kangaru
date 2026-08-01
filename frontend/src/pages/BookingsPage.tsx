import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { apiClient } from '../lib/apiClient'
import { apiError, fieldErrors } from '../lib/apiError'
import { bookingStatusIcon, bookingStatusLabel, bookingStatusTone, pickupLabel } from '../lib/bookingStatus'
import type { ApiSuccess } from '../types/api'
import type { Booking } from '../types/booking'
import type { CursorMeta } from '../types/trip'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { Alert } from '../components/feedback/Alert'
import { Dialog } from '../components/feedback/Dialog'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { FormField } from '../components/forms/FormField'
import { Input } from '../components/forms/Input'

/**
 * Roles the backend's BookingPolicy lets approve or reject. Mirrored here
 * only to decide whether to *render* the buttons — the server is still the
 * authority and returns 403 regardless (AGENTS.md: never rely solely on
 * frontend permissions).
 */
const APPROVER_ROLES = ['super_admin', 'operations_manager', 'corporate_admin', 'branch_manager']

async function fetchBookings(): Promise<Booking[]> {
  const response = await apiClient.get<ApiSuccess<Booking[], CursorMeta>>('/bookings')

  return response.data.data
}

function onLoadFailure(setError: (message: string) => void) {
  return (error: unknown) => setError(apiError(error, 'Could not load bookings.').message)
}

export function BookingsPage() {
  const { user } = useAuth()
  const [bookings, setBookings] = useState<Booking[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [decision, setDecision] = useState<{ booking: Booking; kind: 'rejection' | 'cancellation' } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Kept free of setState so the effect below only ever sets state from a
  // promise callback, never synchronously in its body.
  const apply = useCallback((rows: Booking[]) => {
    setBookings(rows)
    setLoadError(null)
  }, [])

  const load = useCallback(
    () => fetchBookings().then(apply).catch(onLoadFailure(setLoadError)),
    [apply],
  )

  useEffect(() => {
    let cancelled = false

    fetchBookings()
      .then((rows) => {
        if (!cancelled) apply(rows)
      })
      .catch((error: unknown) => {
        if (!cancelled) onLoadFailure(setLoadError)(error)
      })

    return () => {
      cancelled = true
    }
  }, [apply])

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
    [canApprove, approve],
  )

  const filtered = useMemo(() => {
    if (!bookings) return []
    const q = query.trim().toLowerCase()
    if (!q) return bookings
    return bookings.filter(
      (b) =>
        b.origin.toLowerCase().includes(q) ||
        b.destination.toLowerCase().includes(q) ||
        b.passenger_name.toLowerCase().includes(q) ||
        bookingStatusLabel(b.status).toLowerCase().includes(q),
    )
  }, [bookings, query])

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
            <Input
              iconLeft="search"
              placeholder="Filter by route, passenger or status"
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
          rows={filtered}
          dense
          emptyMessage={
            bookings === null ? 'Loading…' : query ? 'No bookings match your filter' : 'No bookings yet'
          }
        />
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
