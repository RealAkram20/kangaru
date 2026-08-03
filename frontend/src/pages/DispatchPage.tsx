import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '../lib/apiClient'
import { apiError } from '../lib/apiError'
import { bookingStatusLabel, bookingStatusTone, pickupLabel } from '../lib/bookingStatus'
import type { ApiSuccess, FilterOption, ScopedCursorMeta, TenancyScope } from '../types/api'
import type { Booking } from '../types/booking'
import type { Driver } from '../types/driver'
import type { Trip } from '../types/trip'
import type { Vehicle } from '../types/vehicle'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { Icon } from '../components/core/Icon'
import { Identifier } from '../components/core/Identifier'
import { Alert } from '../components/feedback/Alert'
import { Dialog } from '../components/feedback/Dialog'
import { EmptyState } from '../components/feedback/EmptyState'
import { LoadMore } from '../components/data/LoadMore'
import { FormField } from '../components/forms/FormField'
import { Select } from '../components/forms/Select'

/**
 * Manual dispatch board, following
 * `KangaruRide Design System/ui_kits/platform/DispatchScreen.jsx`: queue on
 * the left, the selected booking and its assignment controls on the right.
 *
 * The design mock also shows eligibility filtering (category, geofence,
 * depot, distance) and a route preview. Neither is built: the reference
 * tables and Mapbox integration they need do not exist yet, and a control
 * that looks like it filters but does not would be worse than its absence.
 * Every active vehicle and driver is offered, and the server decides.
 */
interface Board {
  queue: Booking[]
  vehicles: Vehicle[]
  drivers: Driver[]
  /** Whose queue this is (ADR-0006), reported by the API. */
  scope: TenancyScope
  /** The clients a platform dispatcher may narrow to; empty otherwise. */
  clients: FilterOption[]
  /** Opaque cursor for the rest of the queue, or null at its end. */
  next: string | null
}

/**
 * `?dispatchable=1` is always present, so everything else appends.
 *
 * Narrowing happens server-side. On this screen that matters more than on
 * the listings: the board's whole purpose is to work a queue down, and a
 * dispatcher handling one client's morning cannot do it through a filter
 * that only sifts the first 25 rows.
 */
function queueUrl(client: string, cursor: string | null = null): string {
  const params = new URLSearchParams({ dispatchable: '1' })
  if (client !== '') params.set('tenant_id', client)
  if (cursor !== null) params.set('cursor', cursor)

  return `/bookings?${params.toString()}`
}

/**
 * Only active vehicles and drivers are offered. This is a courtesy filter,
 * not a rule — the server rejects anything inactive or already committed.
 */
async function fetchBoard(client: string): Promise<Board> {
  const [bookings, vehicles, drivers] = await Promise.all([
    apiClient.get<ApiSuccess<Booking[], ScopedCursorMeta>>(queueUrl(client)),
    apiClient.get<ApiSuccess<Vehicle[]>>('/vehicles'),
    apiClient.get<ApiSuccess<Driver[]>>('/drivers'),
  ])

  return {
    queue: bookings.data.data,
    vehicles: vehicles.data.data.filter((v) => v.status === 'active'),
    drivers: drivers.data.data.filter((d) => d.status === 'active'),
    scope: bookings.data.meta?.scope ?? 'tenant',
    clients: bookings.data.meta?.filters?.clients ?? [],
    next: bookings.data.meta?.cursor?.next ?? null,
  }
}

function onLoadFailure(setError: (message: string) => void) {
  return (error: unknown) => setError(apiError(error, 'Could not load the dispatch board.').message)
}

export function DispatchPage() {
  const [queue, setQueue] = useState<Booking[] | null>(null)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [selected, setSelected] = useState<Booking | null>(null)
  const [scope, setScope] = useState<TenancyScope>('tenant')
  const [clients, setClients] = useState<FilterOption[]>([])
  // '' is every client — the right default for a desk working the whole
  // queue, which is what a cross-client board is for.
  const [client, setClient] = useState('')
  const [next, setNext] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [assigned, setAssigned] = useState<{ booking: Booking; trip: Trip } | null>(null)

  // Kept free of setState so the effect below only ever sets state from a
  // promise callback, never synchronously in its body.
  const apply = useCallback((board: Board) => {
    setQueue(board.queue)
    setVehicles(board.vehicles)
    setDrivers(board.drivers)
    setScope(board.scope)
    setClients(board.clients)
    setNext(board.next)
    setLoadError(null)
  }, [])

  /**
   * Fetches the next page of the queue alone — the vehicle and driver
   * lists are not paged and re-reading them here would be two requests for
   * nothing. Appends, so the rows a dispatcher has already read (and the
   * one they may have selected) stay put; everything else on this board —
   * narrowing, refreshing, assigning — replaces the queue instead, because
   * the list it was paging through no longer describes the query.
   */
  const loadMore = useCallback(async () => {
    if (next === null) return

    setLoadingMore(true)
    try {
      const response = await apiClient.get<ApiSuccess<Booking[], ScopedCursorMeta>>(
        queueUrl(client, next),
      )
      setQueue((current) => [...(current ?? []), ...response.data.data])
      setNext(response.data.meta?.cursor?.next ?? null)
    } catch (error) {
      onLoadFailure(setLoadError)(error)
    } finally {
      setLoadingMore(false)
    }
  }, [client, next])

  const load = useCallback(
    () => fetchBoard(client).then(apply).catch(onLoadFailure(setLoadError)),
    [apply, client],
  )

  useEffect(() => {
    let cancelled = false

    fetchBoard(client)
      .then((board) => {
        if (!cancelled) apply(board)
      })
      .catch((error: unknown) => {
        if (!cancelled) onLoadFailure(setLoadError)(error)
      })

    return () => {
      cancelled = true
    }
    // Narrowing is a new query, so the queue is re-fetched rather than
    // filtered — the other clients' bookings were never here.
  }, [apply, client])

  /**
   * Changing client clears the selection as well as re-querying.
   *
   * A booking picked under "All clients" is not in the narrowed queue, and
   * leaving the assignment panel open against a row that is no longer
   * listed is how a dispatcher commits a vehicle to something they can no
   * longer see. Done here rather than in an effect keyed on `client` —
   * that is a setState in an effect body, which ESLint rejects and which
   * would also run once on mount for no reason.
   */
  const chooseClient = (next: string) => {
    setClient(next)
    setSelected(null)
  }

  // Re-fetch rather than splicing the assigned booking out of local state:
  // another dispatcher may have taken something else while this one was
  // deciding, and a stale queue is exactly what causes a 409 on the next
  // click.
  const onAssigned = async (booking: Booking, trip: Trip) => {
    setAssigned({ booking, trip })
    setSelected(null)
    await load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {loadError && <Alert tone="error" title="Dispatch board unavailable">{loadError}</Alert>}

      {assigned && (
        <Alert tone="success" title="Booking dispatched" onDismiss={() => setAssigned(null)}>
          {assigned.booking.origin} → {assigned.booking.destination} is now trip #{assigned.trip.id},
          assigned to {assigned.trip.driver?.name ?? 'the selected driver'} in{' '}
          {assigned.trip.vehicle?.registration_number ?? 'the selected vehicle'}.
        </Alert>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          gap: 'var(--space-4)',
          alignItems: 'start',
        }}
      >
        <Card
          title="Booking queue"
          // The `+` is the honest reading while a next page exists: the
          // count is what has been fetched, not the queue's true depth.
          subtitle={
            queue ? `${queue.length}${next !== null ? '+' : ''} awaiting a vehicle · immediate first` : undefined
          }
          padding="none"
          actions={
            <>
              {/*
                Narrows the queue server-side. On this board more than
                anywhere else: a dispatcher works one client's morning down
                to nothing, and a control that only sifted the loaded page
                would quietly stop finding work after the first 25.
              */}
              {scope === 'platform' && clients.length > 0 && (
                <Select
                  aria-label="Client"
                  value={client}
                  onChange={(e) => chooseClient(e.target.value)}
                  size="sm"
                  options={[
                    { value: '', label: 'All clients' },
                    ...clients.map((c) => ({ value: String(c.value), label: c.label })),
                  ]}
                  style={{ width: 180 }}
                />
              )}
              <Button variant="secondary" size="sm" iconLeft="refresh-cw" onClick={() => void load()}>
                Refresh
              </Button>
            </>
          }
        >
          {queue === null ? (
            <p style={{ padding: 'var(--space-6)', color: 'var(--text-secondary)' }}>Loading…</p>
          ) : queue.length === 0 ? (
            <EmptyState
              compact
              icon="route"
              title="Queue clear"
              description="Every booking has a driver and a vehicle."
            />
          ) : (
            queue.map((booking) => (
              <QueueRow
                key={booking.id}
                booking={booking}
                selected={selected?.id === booking.id}
                onSelect={() => setSelected(booking)}
              />
            ))
          )}
          {/*
            The queue was capped at the first 25 rows with no way on, which
            on a busy morning silently hid the day's later pickups — a
            dispatcher cannot work down a queue they cannot reach the end
            of. Renders nothing once every page is in.
          */}
          <LoadMore
            hasMore={next !== null}
            loading={loadingMore}
            onLoadMore={() => void loadMore()}
          />
        </Card>

        {selected ? (
          <AssignmentPanel
            key={selected.id}
            booking={selected}
            vehicles={vehicles}
            drivers={drivers}
            onCancel={() => setSelected(null)}
            onAssigned={onAssigned}
          />
        ) : (
          <Card>
            <EmptyState
              compact
              icon="hand-pointer"
              title="Select a booking"
              description="Pick a request from the queue to choose its vehicle and driver."
            />
          </Card>
        )}
      </div>
    </div>
  )
}

function QueueRow({
  booking,
  selected,
  onSelect,
}: {
  booking: Booking
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        display: 'flex',
        width: '100%',
        textAlign: 'left',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        background: selected ? 'var(--surface-accent)' : 'transparent',
        border: 'none',
        borderLeft: '3px solid ' + (selected ? 'var(--action-primary)' : 'transparent'),
        borderBottom: '1px solid var(--border-default)',
        cursor: 'pointer',
      }}
    >
      <Identifier size="xs">{pickupLabel(booking)}</Identifier>
      <span style={{ flex: 1, minWidth: 0 }}>
        {/*
          Which client this request is, above the route rather than beside
          it. On a cross-client queue (ADR-0006) this is the first thing a
          dispatcher must read: the failure it prevents is not a leak but a
          mistake — assigning a vehicle to what they took for the Bank's
          airport run when it was another client's.

          Rendered only when the API sent it, which it does only for a
          platform reader. A client's own queue is all one client's and a
          column repeating their own name on every row is noise.
        */}
        {booking.client && (
          <span
            style={{
              display: 'block',
              font: 'var(--type-caption-strong, var(--type-caption))',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {booking.client.name}
          </span>
        )}
        <span style={{ display: 'block', font: 'var(--type-label)', color: 'var(--text-body)' }}>
          {booking.origin} → {booking.destination}
        </span>
        <span style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>
          {booking.passenger_name}
          {booking.passenger_count > 1 && ` (${booking.passenger_count})`}
        </span>
      </span>
      <Badge tone={bookingStatusTone(booking.status)} size="sm">
        {bookingStatusLabel(booking.status)}
      </Badge>
    </button>
  )
}

function AssignmentPanel({
  booking,
  vehicles,
  drivers,
  onCancel,
  onAssigned,
}: {
  booking: Booking
  vehicles: Vehicle[]
  drivers: Driver[]
  onCancel: () => void
  onAssigned: (booking: Booking, trip: Trip) => void
}) {
  const [vehicleId, setVehicleId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)

  const vehicle = vehicles.find((v) => String(v.id) === vehicleId)
  const driver = drivers.find((d) => String(d.id) === driverId)
  const ready = vehicle !== undefined && driver !== undefined

  const submit = async () => {
    setSubmitting(true)
    setConflict(null)

    try {
      const response = await apiClient.post<ApiSuccess<Trip>>(`/bookings/${booking.id}/assignment`, {
        vehicle_id: Number(vehicleId),
        driver_id: Number(driverId),
      })

      setConfirming(false)
      onAssigned(booking, response.data.data)
    } catch (error) {
      // VEHICLE_UNAVAILABLE / DRIVER_UNAVAILABLE / INVALID_BOOKING_TRANSITION
      // all land here. The server's message names the conflicting trip, so
      // it is shown verbatim — that is the sentence a dispatcher needs.
      setConflict(apiError(error, 'This booking could not be dispatched.').message)
      setConfirming(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Card
        title={`${booking.origin} → ${booking.destination}`}
        subtitle={booking.passenger_name}
        actions={<Identifier kind="chip">BKG-{booking.id}</Identifier>}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 'var(--space-4)',
          }}
        >
          {/*
            First fact, not last: this panel is what a dispatcher reads
            immediately before committing a vehicle, and on a cross-client
            queue "whose trip is this" outranks every other detail here.
          */}
          {booking.client && <Fact label="Client" value={booking.client.name} />}
          <Fact label="Pickup" value={pickupLabel(booking)} />
          <Fact label="Passengers" value={String(booking.passenger_count)} />
          <Fact label="Contact" value={booking.passenger_phone} />
          <Fact label="Requested by" value={booking.requested_by?.name ?? '—'} />
        </div>
        {booking.notes && (
          <p
            style={{
              font: 'var(--type-body-dense)',
              color: 'var(--text-secondary)',
              marginTop: 'var(--space-4)',
            }}
          >
            <Icon name="sticky-note" size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
            {booking.notes}
          </p>
        )}
      </Card>

      <Card title="Assign a vehicle and driver" subtitle="Availability is confirmed by the server on assignment">
        {conflict && (
          <Alert tone="warning" title="Assignment refused" style={{ marginBottom: 'var(--space-4)' }}>
            {conflict}
          </Alert>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <FormField label="Vehicle" htmlFor="dispatch-vehicle" required>
            <Select
              id="dispatch-vehicle"
              placeholder="Select a vehicle"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              options={vehicles.map((v) => ({
                value: String(v.id),
                label: `${v.registration_number} · ${v.make} ${v.model} · ${v.category} (${v.seating_capacity} seats)`,
              }))}
            />
          </FormField>

          <FormField label="Driver" htmlFor="dispatch-driver" required>
            <Select
              id="dispatch-driver"
              placeholder="Select a driver"
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              options={drivers.map((d) => ({
                value: String(d.id),
                label: `${d.name} · ${d.license_number}`,
              }))}
            />
          </FormField>

          {vehicle && vehicle.seating_capacity < booking.passenger_count && (
            <Alert tone="warning" title="Seats may be short">
              {vehicle.registration_number} seats {vehicle.seating_capacity}, and this booking is for{' '}
              {booking.passenger_count} passengers.
            </Alert>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 'var(--gap-inline)',
            marginTop: 'var(--space-6)',
          }}
        >
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button iconLeft="user-check" disabled={!ready} onClick={() => setConfirming(true)}>
            Assign
          </Button>
        </div>
      </Card>

      <Dialog
        open={confirming}
        title="Confirm assignment"
        description={
          vehicle && driver
            ? // The client is named in the confirmation itself, not only on
              // the panel behind it. This sentence is the last thing read
              // before a vehicle is committed, and on a cross-client queue
              // it is the sentence that catches the wrong-client mistake.
              `This commits ${vehicle.registration_number} and ${driver.name} to ${booking.origin} → ${booking.destination}${
                booking.client ? ` for ${booking.client.name}` : ''
              }. Neither can be dispatched again until the trip is completed or cancelled.`
            : undefined
        }
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={submitting}>
              Back
            </Button>
            <Button iconLeft="check" loading={submitting} onClick={() => void submit()}>
              Confirm assignment
            </Button>
          </>
        }
      />
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>{label}</p>
      <p style={{ font: 'var(--type-label)', color: 'var(--text-body)', marginTop: 2 }}>{value}</p>
    </div>
  )
}
