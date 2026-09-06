import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDriverAnswer } from '../dispatch/useDriverAnswer'
import { apiClient } from '../lib/apiClient'
import { apiError } from '../lib/apiError'
import { bookingStatusLabel, bookingStatusTone, pickupLabel } from '../lib/bookingStatus'
import { categoryLabel, useVehicleCategories } from '../lib/vehicleCategories'
import type { ApiSuccess, FilterOption, ScopedCursorMeta, TenancyScope } from '../types/api'
import type { Booking } from '../types/booking'
import type { CandidateDriver, CandidateVehicle } from '../types/dispatch'
import type { Driver } from '../types/driver'
import type { Trip } from '../types/trip'
import type { Vehicle } from '../types/vehicle'
import type { VehicleCategory } from '../types/vehicleCategory'
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
 * The pickers are **annotated by the server**, not filtered here. Selecting
 * a booking loads `/candidate-vehicles` and `/candidate-drivers`, which
 * decide contracts (ADR-0009) and availability (ADR-0017) together;
 * anything the assignment endpoint would refuse arrives `dispatchable:
 * false` and is rendered as a disabled option carrying its reason.
 *
 * Disabled rather than dropped, deliberately. A dispatcher who knows the
 * fleet will ask where UAA 123B went, and an option that has quietly
 * vanished is the worst available answer.
 *
 * The design mock also shows eligibility filtering by geofence and depot,
 * plus a route preview. Those stay unbuilt: the reference tables and Mapbox
 * integration they need do not exist yet, and a control that looks like it
 * filters but does not would be worse than its absence.
 */
interface Board {
  queue: Booking[]
  vehicles: Vehicle[]
  drivers: Driver[]
  /** Whose queue this is (ADR-0006), reported by the API. */
  scope: TenancyScope
  /** The clients a platform dispatcher may narrow to; empty otherwise. */
  clients: FilterOption[]
}

/**
 * `?dispatchable=1` is always present, so the client filter appends.
 *
 * Narrowing happens server-side. On this screen that matters more than on
 * the listings: the board's whole purpose is to work a queue down, and a
 * dispatcher handling one client's morning cannot do it through a filter
 * that only sifts the first 25 rows.
 */
function queueUrl(client: string): string {
  return client === ''
    ? '/bookings?dispatchable=1'
    : `/bookings?dispatchable=1&tenant_id=${encodeURIComponent(client)}`
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
  }
}

/**
 * Whether each vehicle and driver can take *this* booking (ADR-0009,
 * ADR-0017) — contracts, leave, maintenance, rosters and live trips, all
 * decided by the server.
 *
 * The board used to offer every active vehicle and driver and let the
 * assignment endpoint refuse. That worked, and taught a dispatcher nothing:
 * the rule was discovered by being stopped. These two endpoints already
 * existed for vehicles (ADR-0009) and were never consumed —
 * `Modules/Dispatch/README.md` carried it as deferred item 6.
 */
interface Candidates {
  vehicles: CandidateVehicle[]
  drivers: CandidateDriver[]
}

async function fetchCandidates(bookingId: number): Promise<Candidates> {
  const [vehicles, drivers] = await Promise.all([
    apiClient.get<ApiSuccess<CandidateVehicle[]>>(`/bookings/${bookingId}/candidate-vehicles`),
    apiClient.get<ApiSuccess<CandidateDriver[]>>(`/bookings/${bookingId}/candidate-drivers`),
  ])

  return { vehicles: vehicles.data.data, drivers: drivers.data.data }
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
  const [loadError, setLoadError] = useState<string | null>(null)
  /*
    `trip: null` is the ordinary outcome since ADR-0068 — the driver's phone
    is ringing and no trip exists yet. `driver` is carried from the form
    rather than read off a response, because the offer payload deliberately
    names no driver: it is built to be safe on a lock screen, and the desk
    already knows who it just chose.
  */
  const [assigned, setAssigned] = useState<
    { booking: Booking; trip: Trip | null; driver: string } | null
  >(null)

  // One fetch for the board, passed down. The picker labels a vehicle by
  // category and used to print the stored key at a dispatcher — `boda`,
  // where the office says "Boda boda" (ADR-0050).
  const { categories } = useVehicleCategories()

  // Kept free of setState so the effect below only ever sets state from a
  // promise callback, never synchronously in its body.
  const apply = useCallback((board: Board) => {
    setQueue(board.queue)
    setVehicles(board.vehicles)
    setDrivers(board.drivers)
    setScope(board.scope)
    setClients(board.clients)
    setLoadError(null)
  }, [])

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
  const onAssigned = async (booking: Booking, trip: Trip | null, driver: string) => {
    setAssigned({ booking, trip, driver })
    setSelected(null)
    await load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {loadError && (
        <Alert tone="error" title="Dispatch board unavailable">
          {loadError}
        </Alert>
      )}

      {assigned && (
        <DispatchedNotice
          booking={assigned.booking}
          trip={assigned.trip}
          driver={assigned.driver}
          onDismiss={() => setAssigned(null)}
        />
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
              <Button
                variant="secondary"
                size="sm"
                iconLeft="refresh-cw"
                onClick={() => void load()}
              >
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
        </Card>

        {selected ? (
          <AssignmentPanel
            key={selected.id}
            booking={selected}
            vehicles={vehicles}
            drivers={drivers}
            categories={categories}
            onCancel={() => setSelected(null)}
            onAssigned={onAssigned}
          />
        ) : (
          <Card>
            <EmptyState
              compact
              icon="pointer"
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
      {/*
        A ringing phone outranks the status, and replaces it rather than
        sitting beside it: while a driver is deciding, "Approved" is true and
        useless, and two badges on one row is the dispatcher reading twice to
        learn once.
      */}
      {booking.is_ringing ? (
        <Badge tone="info" size="sm">
          Ringing a driver
        </Badge>
      ) : (
        <Badge tone={bookingStatusTone(booking.status)} size="sm">
          {bookingStatusLabel(booking.status)}
        </Badge>
      )}
    </button>
  )
}

/**
 * Turns a candidate into a `<Select>` option, disabled when the server has
 * already said it will refuse it.
 *
 * Disabled rather than omitted, which is the whole point of ADR-0017 on this
 * screen: a dispatcher who knows the fleet will ask where UAA 123B went, and
 * an option that has quietly vanished is the worst available answer. The
 * note rides in the label because a `<option>` cannot carry a tooltip that
 * survives the native dropdown.
 */
function candidateOption(
  value: number,
  label: string,
  row: { dispatchable: boolean; note: string | null },
) {
  return {
    value: String(value),
    label: row.dispatchable || row.note === null ? label : `${label} — ${row.note}`,
    disabled: !row.dispatchable,
  }
}

function AssignmentPanel({
  booking,
  vehicles,
  drivers,
  categories,
  onCancel,
  onAssigned,
}: {
  booking: Booking
  vehicles: Vehicle[]
  drivers: Driver[]
  categories: VehicleCategory[] | null
  onCancel: () => void
  onAssigned: (booking: Booking, trip: Trip | null, driver: string) => void
}) {
  const [vehicleId, setVehicleId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidates | null>(null)

  /**
   * Candidates are per booking, so they load when one is selected rather
   * than with the board.
   *
   * "Is this vehicle free" has no answer except relative to a window, and
   * the window comes from the booking. Fetching them with the board would
   * mean answering the question before it had been asked.
   */
  useEffect(() => {
    let cancelled = false

    fetchCandidates(booking.id)
      .then((next) => {
        if (!cancelled) setCandidates(next)
      })
      .catch(() => {
        // Deliberately silent, and deliberately not fatal. The assignment
        // endpoint enforces availability regardless; losing the preview
        // costs a dispatcher the annotation, not the ability to work. An
        // error banner over a panel that still functions would be noise.
        if (!cancelled) setCandidates({ vehicles: [], drivers: [] })
      })

    return () => {
      cancelled = true
    }
  }, [booking.id])

  const vehicle = vehicles.find((v) => String(v.id) === vehicleId)
  const driver = drivers.find((d) => String(d.id) === driverId)
  const ready = vehicle !== undefined && driver !== undefined

  /**
   * The server's ordering is kept, not re-sorted here: allocated first, then
   * dispatchable, then registration (ADR-0009 §1). Re-sorting client-side is
   * how a board and an API come to disagree about what "first" means.
   *
   * Falls back to the plain fleet list until the candidates arrive — and if
   * they never do, which is the catch above. A picker that renders empty
   * while a request is in flight looks broken; one that renders unannotated
   * is merely the board as it was before ADR-0017.
   */
  const vehicleOptions = useMemo(() => {
    if (candidates === null || candidates.vehicles.length === 0) {
      return vehicles.map((v) => ({
        value: String(v.id),
        label: `${v.registration_number} · ${v.make} ${v.model} · ${categoryLabel(categories, v.category)} (${v.seating_capacity} seats)`,
      }))
    }

    return candidates.vehicles.map((v) =>
      candidateOption(
        v.id,
        `${v.registration_number} · ${v.make} ${v.model} · ${categoryLabel(categories, v.category)} (${v.seating_capacity} seats)`,
        v,
      ),
    )
  }, [candidates, vehicles, categories])

  const driverOptions = useMemo(() => {
    if (candidates === null || candidates.drivers.length === 0) {
      return drivers.map((d) => ({ value: String(d.id), label: `${d.name} · ${d.license_number}` }))
    }

    return candidates.drivers.map((d) =>
      candidateOption(d.id, `${d.name} · ${d.license_number}`, d),
    )
  }, [candidates, drivers])

  const submit = async () => {
    setSubmitting(true)
    setConflict(null)

    try {
      const response = await apiClient.post<ApiSuccess<Trip | DispatchOffer>>(
        `/bookings/${booking.id}/assignment`,
        {
          vehicle_id: Number(vehicleId),
          driver_id: Number(driverId),
        },
      )

      setConfirming(false)

      /*
        **202 means a phone is ringing; 201 means a trip exists** (ADR-0068).
        Branching on the status code rather than sniffing the body: the two
        payloads both carry an `id` and a `status`, so a shape check would be
        a guess where HTTP is already telling us plainly.

        201 is the driver-has-no-app case, where the desk still has to
        telephone them — the message in `DispatchedNotice` says so.
      */
      const trip = response.status === 202 ? null : (response.data.data as Trip)

      onAssigned(booking, trip, driverName(driverOptions, driverId))
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

      <Card
        title="Assign a vehicle and driver"
        subtitle="Unavailable vehicles and drivers are listed but cannot be picked"
      >
        {conflict && (
          <Alert
            tone="warning"
            title="Assignment refused"
            style={{ marginBottom: 'var(--space-4)' }}
          >
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
              options={vehicleOptions}
            />
          </FormField>

          <FormField label="Driver" htmlFor="dispatch-driver" required>
            <Select
              id="dispatch-driver"
              placeholder="Select a driver"
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              options={driverOptions}
            />
          </FormField>

          {vehicle && vehicle.seating_capacity < booking.passenger_count && (
            <Alert tone="warning" title="Seats may be short">
              {vehicle.registration_number} seats {vehicle.seating_capacity}, and this booking is
              for {booking.passenger_count} passengers.
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

/**
 * What happened to the booking that was just dispatched.
 *
 * ## Why it is not the success alert it replaced
 *
 * That one said *"Booking dispatched"* and never changed. But `assigned` is
 * the office putting a job on somebody's name — the driver still has to
 * accept, and may decline or never look. A job nobody took therefore read
 * exactly like a job already being driven, and the desk learned the
 * difference when the client rang.
 *
 * ## Three states, three tones, and one of them is an instruction
 *
 * Waiting is `info` and says who is being waited on. Accepted is `success`
 * and is the end of it. **Declined is `warning` and names the next act** —
 * it is the only one of the three the dispatcher has to do something about,
 * and a notice that reported a refusal without saying so would leave them
 * reading it twice.
 *
 * No countdown. An assignment has no deadline in this platform — unlike a
 * walk-in offer, which expires in `dispatch.offer_ttl_seconds` — so a clock
 * here would be inventing a rule the platform does not have
 * (`docs/screen-rules.md` §1).
 *
 * Dismissable throughout. The job carries on without this panel; a
 * dispatcher who has seen it and moved on should not have to keep it.
 */
/**
 * The label of the driver the dispatcher just chose.
 *
 * Read from the form's own options rather than from the response, because a
 * ringing offer names no driver — `DispatchOfferResource` is built to be safe
 * on a lock screen and withholds everything it can.
 */
function driverName(options: { value: string; label: string }[], id: string): string {
  return options.find((o) => o.value === id)?.label.split(' · ')[0] ?? 'the driver'
}

/**
 * The 202 body: an offer put in front of a driver, with a clock on it.
 *
 * Only the fields this page reads. The board does not render the offer —
 * `is_ringing` on the booking row is what carries the state — so a fuller
 * mirror of `DispatchOfferResource` here would be a second copy to keep in
 * step for no reader.
 */
type DispatchOffer = {
  id: number
  status: string
  expires_in_seconds: number
}

function DispatchedNotice({
  booking,
  trip,
  driver: chosen,
  onDismiss,
}: {
  booking: Booking
  trip: Trip | null
  driver: string
  onDismiss: () => void
}) {
  const answer = useDriverAnswer(trip)

  const route = `${booking.origin} → ${booking.destination}`

  /*
    No trip yet: the assignment is a question the driver has not answered.
    The board's own row carries the standing state (a "Ringing a driver"
    badge, refreshed on every load); this notice is the acknowledgement of
    the press, and it says what is actually true rather than "Booking
    dispatched", which is the sentence that sent an owner looking for a
    delivery nobody had been asked about.
  */
  if (trip === null) {
    return (
      <Alert tone="info" title={`Ringing ${chosen}`} onDismiss={onDismiss}>
        {route}. They have not answered yet — if they decline, it goes to the
        next driver.
      </Alert>
    )
  }

  const driver = trip.driver?.name ?? chosen
  const vehicle = trip.vehicle?.registration_number ?? 'the selected vehicle'

  if (answer === 'declined') {
    return (
      <Alert tone="warning" title={`${driver} declined trip #${trip.id}`} onDismiss={onDismiss}>
        {route} still needs a vehicle. Assign somebody else from the queue.
      </Alert>
    )
  }

  if (answer === 'accepted') {
    return (
      <Alert tone="success" title={`${driver} accepted trip #${trip.id}`} onDismiss={onDismiss}>
        {route}, in {vehicle}.
      </Alert>
    )
  }

  /*
    A trip existed the moment the desk pressed Assign, which since ADR-0068
    means one thing: this driver has no app account, so nothing rang and
    nothing is going to. Telling a dispatcher to wait for an acceptance that
    cannot arrive is the failure this whole change was made to remove, in
    miniature.
  */
  return (
    <Alert tone="warning" title={`${driver} has no app — call them`} onDismiss={onDismiss}>
      {route}, in {vehicle}. Trip #{trip.id} is on their name already.
    </Alert>
  )
}
