import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '../lib/apiClient'
import { apiError } from '../lib/apiError'
import { bookingStatusLabel, bookingStatusTone, pickupLabel } from '../lib/bookingStatus'
import type { ApiSuccess } from '../types/api'
import type { Booking } from '../types/booking'
import type { Driver } from '../types/driver'
import type { CursorMeta, Trip } from '../types/trip'
import type { Vehicle } from '../types/vehicle'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { Icon } from '../components/core/Icon'
import { Identifier } from '../components/core/Identifier'
import { Alert } from '../components/feedback/Alert'
import { Dialog } from '../components/feedback/Dialog'
import { EmptyState } from '../components/feedback/EmptyState'
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
}

/**
 * Only active vehicles and drivers are offered. This is a courtesy filter,
 * not a rule — the server rejects anything inactive or already committed.
 */
async function fetchBoard(): Promise<Board> {
  const [bookings, vehicles, drivers] = await Promise.all([
    apiClient.get<ApiSuccess<Booking[], CursorMeta>>('/bookings?dispatchable=1'),
    apiClient.get<ApiSuccess<Vehicle[]>>('/vehicles'),
    apiClient.get<ApiSuccess<Driver[]>>('/drivers'),
  ])

  return {
    queue: bookings.data.data,
    vehicles: vehicles.data.data.filter((v) => v.status === 'active'),
    drivers: drivers.data.data.filter((d) => d.status === 'active'),
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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [assigned, setAssigned] = useState<{ booking: Booking; trip: Trip } | null>(null)

  // Kept free of setState so the effect below only ever sets state from a
  // promise callback, never synchronously in its body.
  const apply = useCallback((board: Board) => {
    setQueue(board.queue)
    setVehicles(board.vehicles)
    setDrivers(board.drivers)
    setLoadError(null)
  }, [])

  const load = useCallback(
    () => fetchBoard().then(apply).catch(onLoadFailure(setLoadError)),
    [apply],
  )

  useEffect(() => {
    let cancelled = false

    fetchBoard()
      .then((board) => {
        if (!cancelled) apply(board)
      })
      .catch((error: unknown) => {
        if (!cancelled) onLoadFailure(setLoadError)(error)
      })

    return () => {
      cancelled = true
    }
  }, [apply])

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
          subtitle={queue ? `${queue.length} awaiting a vehicle · immediate first` : undefined}
          padding="none"
          actions={
            <Button variant="secondary" size="sm" iconLeft="refresh-cw" onClick={() => void load()}>
              Refresh
            </Button>
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
            ? `This commits ${vehicle.registration_number} and ${driver.name} to ${booking.origin} → ${booking.destination}. Neither can be dispatched again until the trip is completed or cancelled.`
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
