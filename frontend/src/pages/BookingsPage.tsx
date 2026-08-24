import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { ClientFilterSelect } from '../components/filters/ClientFilterSelect'
import { apiClient } from '../lib/apiClient'
import { apiError, fieldErrors } from '../lib/apiError'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import { categoryLabel, categoryOptions, useVehicleCategories } from '../lib/vehicleCategories'
import {
  bookingStatusIcon,
  bookingStatusLabel,
  bookingStatusTone,
  pickupLabel,
} from '../lib/bookingStatus'
import type { ApiSuccess, FilterOption, ScopedCursorMeta, TenancyScope } from '../types/api'
import type { Booking, BookingServiceType } from '../types/booking'
import type { Colleague } from '../types/staff'
import type { VehicleCategory } from '../types/vehicleCategory'
import { isCorporateRole } from '../lib/navigation'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { Alert } from '../components/feedback/Alert'
import { Dialog } from '../components/feedback/Dialog'
import { DataTable, type DataColumn } from '../components/data/DataTable'
import { LoadMore } from '../components/data/LoadMore'
import { ColleagueField } from '../components/forms/ColleagueField'
import { FormField } from '../components/forms/FormField'
import { PlaceField } from '../components/forms/PlaceField'
import type { PlaceHit } from './public/places'
import { coordinatesFor, withCoordinateErrorsOnFields } from './public/orderCoordinates'
import { Checkbox } from '../components/forms/Checkbox'
import { Input } from '../components/forms/Input'
import { Select } from '../components/forms/Select'
import { Icon } from '../components/core/Icon'
import { PageFill } from '../components/layout/PageFill'

/**
 * The three services a booking can ask for (ADR-0064) — the same triad the
 * public order page offers, wearing the same Lucide icons, so a dispatcher
 * moving between the walk-in queue and this one reads one vocabulary.
 */
const SERVICES: { value: BookingServiceType; label: string; icon: string }[] = [
  { value: 'ride', label: 'Ride', icon: 'car' },
  { value: 'delivery', label: 'Delivery', icon: 'package' },
  { value: 'self_drive', label: 'Self-drive', icon: 'key-round' },
]

function serviceMeta(service: BookingServiceType) {
  return SERVICES.find((entry) => entry.value === service) ?? SERVICES[0]
}

/** The current minute, in the `datetime-local` input's own format. */
function nowForPickupInput(): string {
  const now = new Date()
  const pad = (part: number) => String(part).padStart(2, '0')

  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}`
  )
}

/**
 * How far from "now" a chosen pickup time still *means* now.
 *
 * The field is prefilled with the current time (owner's ask, 24 Aug), and a
 * prefilled clock is stale the moment it renders: a dispatcher who opens the
 * dialog, takes a two-minute phone call and submits has a value in the past,
 * and sending it verbatim earns the exact "must be in the future" refusal
 * the prefill was meant to end. So a time within this window of the submit
 * moment is sent as null — the backend's word for "immediately" — and only
 * a genuinely chosen future time is sent as a schedule. A time *further* in
 * the past is still sent and refused: that one is a typo, not staleness,
 * and silently turning last Tuesday into "now" dispatches a car nobody
 * expects.
 */
const PICKUP_MEANS_NOW_MS = 5 * 60 * 1000

/**
 * What `scheduled_for` should carry: null for "now" — untouched prefill,
 * cleared box, or a time within the means-now window either side — and an
 * ISO timestamp only for a pickup somebody actually scheduled. See
 * PICKUP_MEANS_NOW_MS for why the window exists and why a far-past time is
 * still sent (to be refused loudly rather than quietly re-read as "now").
 */
function pickupTimeForPayload(value: string, edited: boolean): string | null {
  if (!edited || value === '') return null

  const chosen = new Date(value)

  if (Math.abs(chosen.getTime() - Date.now()) <= PICKUP_MEANS_NOW_MS) return null

  return chosen.toISOString()
}

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
  /**
   * The clients a fleet's desk may raise a *new* booking for — active
   * contracts only (ADR-0064 §5), so the dialog never offers a client the
   * server would refuse. Narrower than `clients`, whose job is filtering
   * existing rows.
   */
  bookable: FilterOption[]
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
    bookable: response.data.meta?.bookable_clients ?? [],
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
  const [bookableClients, setBookableClients] = useState<FilterOption[]>([])
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
  const [decision, setDecision] = useState<{
    booking: Booking
    kind: 'rejection' | 'cancellation'
  } | null>(null)
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
    setBookableClients(list.bookable)
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
    () =>
      fetchBookings(client, search, null).then(
        (list) => apply(list, false),
        onLoadFailure(setLoadError),
      ),
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
  /**
   * ADR-0051 §3. One fetch for the page: the table renders the requested
   * vehicle type by name, and the new-booking dialog offers the choices.
   *
   * Readable by anyone holding `bookings.create`, which is what opened this
   * endpoint to the two corporate roles — names only, never the fleet
   * counts, because the fleet's composition is roster information.
   */
  const { categories, error: categoriesError } = useVehicleCategories()

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
              card: 'hide',
              header: 'Client',
              render: (row: Booking) => row.client?.name ?? '—',
            } satisfies DataColumn<Booking>,
          ]
        : []),
      {
        key: 'status',
        card: 'status',
        header: 'Status',
        render: (row) => (
          <Badge tone={bookingStatusTone(row.status)} icon={bookingStatusIcon(row.status)}>
            {bookingStatusLabel(row.status)}
          </Badge>
        ),
      },
      {
        key: 'service_type',
        card: 'meta',
        header: 'Service',
        // The icon repeats the word rather than replacing it — a queue is
        // scanned, and meaning never travels by glyph (or colour) alone.
        render: (row) => {
          const meta = serviceMeta(row.service_type)

          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name={meta.icon} size={16} />
              {meta.label}
            </span>
          )
        },
      },
      {
        key: 'scheduled_for',
        card: 'meta',
        header: 'Pickup',
        // A rental has no pickup moment — its dates are the hire period,
        // shown where the route would be.
        render: (row) =>
          row.service_type === 'self_drive' ? <span title="See the hire period.">—</span> : pickupLabel(row),
      },
      {
        key: 'origin',
        card: 'title',
        header: 'Route',
        render: (row) =>
          row.service_type === 'self_drive' ? (
            row.details?.start_date ? (
              <span title="Hire period.">{`${row.details.start_date} → ${row.details.end_date ?? '—'}`}</span>
            ) : (
              <span title="No hire period recorded.">—</span>
            )
          ) : (
            `${row.origin ?? '—'} → ${row.destination ?? '—'}`
          ),
      },
      // The person the desk rings: the passenger on a ride, the sender on a
      // delivery, the renter on a self-drive.
      { key: 'passenger_name', card: 'meta', header: 'Contact' },
      {
        key: 'passenger_count',
        card: 'meta',
        header: 'Pax',
        numeric: true,
        // Seats are a ride's question. A stored count exists on every row
        // (the column defaults to 1), so rendering it on a parcel would
        // invent a passenger nobody booked.
        render: (row) => (row.service_type === 'ride' ? row.passenger_count : <span>—</span>),
      },
      {
        key: 'vehicle_category',
        card: 'meta',
        header: 'Vehicle',
        // ADR-0051. An em dash for "no preference stated" rather than a
        // blank cell: the column has to distinguish a client who did not
        // mind from one whose request is sitting there unmet, and a blank
        // reads as missing data.
        render: (row) =>
          row.vehicle_category === null ? (
            <span title="No preference stated.">—</span>
          ) : (
            <>{categoryLabel(categories, row.vehicle_category)}</>
          ),
      },
      {
        key: 'requested_by_user_id',
        card: 'meta',
        header: 'Requested by',
        render: (row) => row.requested_by?.name ?? '—',
      },
      {
        key: 'decision_reason',
        card: 'hide',
        header: 'Reason',
        wrap: true,
        render: (row) => row.decision_reason ?? '—',
      },
      {
        key: 'id',
        card: 'meta',
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
    [canApprove, approve, scope, categories],
  )

  // The rows are already what the server matched, so there is nothing left
  // to filter here. The in-browser version this replaces searched only the
  // page in hand and reported everything beyond it as "no match".
  const rows = bookings ?? []

  return (
    <PageFill>
      {loadError && (
        <Alert tone="error" title="Bookings unavailable">
          {loadError}
        </Alert>
      )}
      {actionError && (
        <Alert tone="warning" title="Action refused" onDismiss={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      <PageFill.Flex>
        <Card
          fill
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
              <ClientFilterSelect
                scope={scope}
                clients={clients}
                value={client}
                onChange={setClient}
              />
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
          /*
          The cursor now belongs to the *searched* query, so "load more"
          continues the search rather than escaping it — which is why the
          in-browser filter had to go first. Paging a client-side filter
          would have loaded the next 25 unfiltered rows into a filtered
          list.

          In the card's footer rather than after the table, so it stays put
          while the rows scroll.
        */
          footer={
            <LoadMore
              hasMore={next !== null}
              loading={loadingMore}
              onLoadMore={() => void loadMore()}
            />
          }
        >
          <DataTable<Booking>
            columns={columns}
            rows={rows}
            dense
            fill
            emptyMessage={
              bookings === null
                ? 'Loading…'
                : query
                  ? 'No bookings match your filter'
                  : 'No bookings yet'
            }
          />
        </Card>
      </PageFill.Flex>

      {creating && (
        <NewBookingDialog
          categories={categories}
          categoriesError={categoriesError}
          clients={bookableClients}
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
    </PageFill>
  )
}

function NewBookingDialog({
  categories,
  categoriesError,
  clients,
  onClose,
  onCreated,
}: {
  /**
   * Lifted from the page (ADR-0051 §3), so the table's Vehicle column and
   * this form's select share one request. Null while it is still loading.
   */
  categories: VehicleCategory[] | null
  categoriesError: string | null
  /**
   * The clients a fleet's desk may book for — `meta.bookable_clients`,
   * active contracts only (ADR-0064 §5), so nothing here is an answer the
   * server would refuse. Empty for a client's own user, whose booking is
   * always their own client's and who is never shown the picker.
   */
  clients: FilterOption[]
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const { user: me } = useAuth()
  /**
   * A client's booking is for one of the client's own people, and the
   * server enforces exactly that — a Corporate Admin or Employee who names
   * nobody gets a 422 on `passenger_user_id`. Shanitah's own desk still
   * types a name, because the walk-ins and callers they book for have no
   * account anywhere (ADR-0012).
   *
   * `isCorporateRole` decides which form is shown; it does not decide the
   * rule. Getting it wrong here shows the wrong field, never the wrong
   * permission.
   */
  /*
   * Since 24 August this is **not** only a client's form.
   *
   * `/colleagues` used to answer an empty list to any platform-level actor, so
   * offering the field to a dispatcher would have offered a search that never
   * found anybody. It now answers with the people of the clients that fleet
   * actively serves, which is precisely who a dispatcher taking a call from a
   * bank is booking for — and naming them is what stops "J. Mukasa" and
   * "Joseph Mukasa" being two passengers in the same report.
   *
   * A client is still **required** to name a colleague and a fleet is not:
   * `StoreBookingRequest` refuses a corporate actor who names nobody, and
   * accepts a fleet's typed name because the walk-ins and callers Shanitah's
   * desk books for have no account anywhere (ADR-0012). So a dispatcher gets
   * the search as an accelerator over a box they can still type into, which is
   * exactly what `PlaceField` is to an address.
   */
  const picksColleague = isCorporateRole(me?.role) || me?.access_level === 'fleet'
  /**
   * A fleet's desk books **for a corporate client** (ADR-0064) — the booking
   * lands on that client's account, so naming them is required before
   * anything else. A client's own user never sees the picker: their one
   * client is applied server-side and was never a choice.
   */
  const picksClient = me?.access_level === 'fleet'
  const [client, setClientChoice] = useState('')
  const [service, setService] = useState<BookingServiceType>('ride')
  const [colleague, setColleague] = useState<Colleague | null>(null)
  /**
   * Whether the number in the box was put there by picking a passenger.
   *
   * The prefill has to answer two questions at once and they pull opposite
   * ways. Picking Alice and then Bob **must not** leave Alice's number under
   * Bob's name — a car goes out and the driver rings the wrong person, and
   * nothing about the screen looks wrong. But a dispatcher who takes the
   * number off the caller *first* and then names the passenger must not have
   * their typing deleted, which is what a blanket clear did: every client
   * account on this platform has a null `phone`, so picking anybody wiped the
   * box.
   *
   * One flag settles both. Clear only what this prefill wrote; never touch
   * what a person typed.
   */
  const [phoneFromColleague, setPhoneFromColleague] = useState(false)
  const [form, setForm] = useState({
    passenger_name: '',
    passenger_phone: '',
    passenger_count: '1',
    // ADR-0051. Empty means "no preference", which is the ordinary case and
    // a real answer — never defaulted to a category, because a preselected
    // vehicle is a request nobody made.
    vehicle_category: '',
    origin: '',
    destination: '',
    // Prefilled with the current minute (owner's ask, 24 Aug) — the value
    // reads as "now", and pickupTimeForPayload() is what keeps a stale
    // prefill from being submitted as a schedule in the past.
    scheduled_for: nowForPickupInput(),
    notes: '',
    // Delivery (ADR-0064). The recipient is required; the rest says what
    // the parcel is and which end settles the bill.
    recipient_name: '',
    recipient_phone: '',
    item_type: '',
    package_size: '',
    payer: '',
    payment_method: '',
    // Self drive (ADR-0064). The hire period, and which identity documents
    // the renter will bring — checked as originals at collection.
    start_date: '',
    end_date: '',
    kyc_documents: '',
  })
  const [confirmWithPin, setConfirmWithPin] = useState(false)
  /**
   * Whether anybody touched the pickup time. Untouched, the prefill means
   * "now" however stale it has gone — the whole failure this replaces was a
   * dispatcher submitting a minutes-old prefill and being told their "now"
   * was in the past.
   */
  const [pickupEdited, setPickupEdited] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  /**
   * The suggestion a dispatcher took, if any (ADR-0020 §2). Kept beside the
   * text rather than merged into it, because the coordinates are only sent
   * while the two still agree — typing over a picked place drops them.
   */
  const [originPlace, setOriginPlace] = useState<PlaceHit | null>(null)

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }))

  const submit = async () => {
    setSubmitting(true)
    setErrors({})
    setMessage(null)

    // A rental has no route; everything else journeys (ADR-0064). The
    // per-service keys are assembled here rather than sent wholesale — the
    // server would drop a stale key anyway, but a payload that says only
    // what this service means is one nobody has to reason backwards from.
    const journeys = service !== 'self_drive'

    try {
      await apiClient.post('/bookings', {
        service_type: service,
        // Which client this is for — a fleet desk's required answer, and
        // not an input at all from a client's own user (ADR-0064).
        ...(picksClient ? { tenant_id: client === '' ? null : Number(client) } : {}),
        // Sent only where there is one. The server takes the passenger's
        // *name* off this account and ignores the one below, so the two
        // can never drift into being two passengers.
        ...(colleague === null ? {} : { passenger_user_id: colleague.id }),
        passenger_name: form.passenger_name,
        passenger_phone: form.passenger_phone,
        ...(service === 'ride' ? { passenger_count: Number(form.passenger_count) || 1 } : {}),
        // Null, not '': the column stores "no preference stated", and the
        // office has to be able to tell that apart from a preference the
        // dispatcher did not honour (ADR-0051 §1).
        vehicle_category: form.vehicle_category === '' ? null : form.vehicle_category,
        ...(journeys
          ? {
              origin: form.origin,
              // Only while the typed text still matches what was picked —
              // the same rule the public order form uses (ADR-0020 §2).
              ...coordinatesFor(form.origin, originPlace, 'origin_latitude', 'origin_longitude'),
              destination: form.destination,
              // Null means immediate. The prefill, a cleared box and a
              // near-now choice all mean "now" — see pickupTimeForPayload.
              scheduled_for: pickupTimeForPayload(form.scheduled_for, pickupEdited),
            }
          : {}),
        notes: form.notes === '' ? null : form.notes,
        ...(service === 'delivery'
          ? {
              details: {
                recipient_name: form.recipient_name,
                recipient_phone: form.recipient_phone,
                item_type: form.item_type === '' ? null : form.item_type,
                package_size: form.package_size === '' ? null : form.package_size,
                payer: form.payer === '' ? null : form.payer,
                payment_method: form.payment_method === '' ? null : form.payment_method,
                confirm_with_pin: confirmWithPin,
              },
            }
          : {}),
        ...(service === 'self_drive'
          ? {
              details: {
                start_date: form.start_date === '' ? null : form.start_date,
                end_date: form.end_date === '' ? null : form.end_date,
                kyc_documents: form.kyc_documents === '' ? null : form.kyc_documents,
              },
            }
          : {}),
      })

      await onCreated()
    } catch (error) {
      const failure = apiError(error, 'Could not create this booking.')
      // A service-area refusal (ADR-0021) rejects `origin_latitude`, and
      // there is no such input — the dispatcher types an address. Left
      // alone it would render as nothing visibly wrong.
      setErrors(withCoordinateErrorsOnFields(fieldErrors(failure)))
      setMessage(failure.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      title="New booking"
      // No description sentence: the pickup field now shows "now" and says
      // its own one line (screen-rules §9 — the sentence this replaced only
      // existed because empty-means-now was invisible from the form).
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

        {/*
          The same three services the public order page offers (ADR-0064),
          visible side by side rather than folded into a dropdown — a
          dispatcher on a call should see that delivery and self-drive exist
          without opening anything.
        */}
        <div role="radiogroup" aria-label="Service" style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {SERVICES.map((entry) => {
            const selected = service === entry.value

            return (
              <button
                key={entry.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  setService(entry.value)
                  // Another service's requireds are not this form's errors.
                  setErrors({})
                  setMessage(null)
                }}
                style={{
                  flex: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-2)',
                  height: 'var(--control-h-md)',
                  font: 'var(--type-control)',
                  color: selected ? 'var(--text-body)' : 'var(--text-secondary)',
                  background: selected ? 'var(--surface-subtle)' : 'var(--surface-card)',
                  border: '1px solid ' + (selected ? 'var(--action-primary)' : 'var(--border-input)'),
                  // The second ring is what makes the chosen one readable at
                  // a glance without carrying the state by colour alone —
                  // the icon-and-word pair still says which is which.
                  boxShadow: selected ? '0 0 0 1px var(--action-primary)' : 'none',
                  borderRadius: 'var(--radius-input)',
                  cursor: 'pointer',
                  transition: 'var(--transition-control)',
                }}
              >
                <Icon name={entry.icon} size={16} />
                {entry.label}
              </button>
            )
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          {picksClient && (
            <div style={{ gridColumn: '1 / -1' }}>
              {/*
                First, because everything else is on this client's account —
                and the passenger search below narrows to the answer. The
                options are `meta.bookable_clients` — only the clients this
                fleet actively serves, so the dropdown cannot offer an
                answer the server refuses (owner's instruction, 24 Aug).
              */}
              <FormField label="Client" htmlFor="b-client" required error={errors.tenant_id}>
                <Select
                  id="b-client"
                  value={client}
                  placeholder="Choose a client"
                  options={clients.map((option) => ({
                    value: String(option.value),
                    label: option.label,
                  }))}
                  onChange={(event) => {
                    setClientChoice(event.target.value)
                    // A picked colleague belongs to the previous answer.
                    // The typed text survives — it is only ever a name.
                    setColleague(null)
                  }}
                />
              </FormField>
            </div>
          )}
          {picksColleague ? (
            <ColleagueField
              value={form.passenger_name}
              chosen={colleague}
              label={service === 'delivery' ? 'Sender' : service === 'self_drive' ? 'Renter' : 'Passenger'}
              tenantId={picksClient && client !== '' ? client : undefined}
              // A dispatcher is searching the staff of the clients their fleet
              // serves, which are not their colleagues. `isCorporateRole`
              // rather than the level, so the wording follows the same
              // condition that decides whether a colleague is required.
              placeholder={
                isCorporateRole(me?.role) ? 'Search your colleagues' : "Search a client's staff"
              }
              // The server rejects a missing colleague on this field; the
              // typed name is only ever a search term here.
              error={errors.passenger_user_id ?? errors.passenger_name}
              onChange={(value, picked) => {
                setColleague(picked)
                setPhoneFromColleague(picked?.phone != null)
                setForm((current) => ({
                  ...current,
                  passenger_name: value,
                  /*
                    Prefilled from the account, still editable, and never
                    destructive - see `phoneFromColleague` above.

                    - the colleague has a number: it wins, because the box is
                      about whoever the passenger now is;
                    - they have none and the box holds a previous colleague's:
                      cleared, or that number follows the wrong passenger out
                      of the door;
                    - they have none and somebody typed it: left alone.
                  */
                  passenger_phone:
                    picked?.phone ??
                    (phoneFromColleague ? '' : current.passenger_phone),
                }))
              }}
            />
          ) : (
            <FormField
              label={service === 'delivery' ? 'Sender' : service === 'self_drive' ? 'Renter' : 'Passenger'}
              htmlFor="b-name"
              required
              error={errors.passenger_name}
            >
              <Input id="b-name" value={form.passenger_name} onChange={set('passenger_name')} />
            </FormField>
          )}
          <FormField
            label="Contact number"
            htmlFor="b-phone"
            required
            error={errors.passenger_phone}
          >
            <Input
              id="b-phone"
              value={form.passenger_phone}
              // Not `set('passenger_phone')`: typing here makes the number a
              // person's answer rather than an account's, and the next pick
              // must stop treating it as its own to clear.
              onChange={(event) => {
                setPhoneFromColleague(false)
                setForm((current) => ({ ...current, passenger_phone: event.target.value }))
              }}
              placeholder="+256700000000"
            />
          </FormField>
          {/* A rental has no route — the renter collects the vehicle (ADR-0064). */}
          {service !== 'self_drive' && (
            <>
              <PlaceField
                label="Pick-up"
                value={form.origin}
                required
                error={errors.origin}
                hint="Pick a suggestion and the board can rank drivers by how near they are."
                /*
                  The crosshair, on pick-up alone. A desk taking a call is usually
                  where the caller is, and the coordinates it fills in are the ones
                  the recommender ranks by — which is the difference between "no
                  driver ranked by distance" and a nearest car.

                  Not offered on the destination below: nobody orders a car to
                  where they already are.
                */
                locatable
                onChange={(value, place) => {
                  setForm((current) => ({ ...current, origin: value }))
                  setOriginPlace(place)
                }}
              />
              {/*
                The same suggestions as the pick-up. It was a bare `Input`, so a
                destination was whatever a dispatcher typed at speed on a phone
                call — "muko", "Mukono town", "mukono tc" — three spellings of one
                place that no report can add up and no driver can be certain of.

                The place it resolves to is **not** sent yet: `bookings` carries
                `origin_latitude`/`origin_longitude` and no destination pair, and
                inventing one here would mean a column, a migration and a decision
                about what the matcher does with it. The value today is the
                address itself, spelled the way the geocoder spells it.
              */}
              <PlaceField
                label={service === 'delivery' ? 'Deliver to' : 'Destination'}
                value={form.destination}
                required
                error={errors.destination}
                onChange={(value) => setForm((current) => ({ ...current, destination: value }))}
              />
            </>
          )}
          {service === 'ride' && (
            <FormField label="Passengers" htmlFor="b-count" error={errors.passenger_count}>
              <Input
                id="b-count"
                type="number"
                min={1}
                value={form.passenger_count}
                onChange={set('passenger_count')}
              />
            </FormField>
          )}
          {service === 'delivery' && (
            <>
              <FormField
                label="Recipient"
                htmlFor="b-recipient"
                required
                error={errors['details.recipient_name']}
              >
                <Input
                  id="b-recipient"
                  value={form.recipient_name}
                  onChange={set('recipient_name')}
                />
              </FormField>
              <FormField
                label="Recipient number"
                htmlFor="b-recipient-phone"
                required
                error={errors['details.recipient_phone']}
              >
                <Input
                  id="b-recipient-phone"
                  value={form.recipient_phone}
                  onChange={set('recipient_phone')}
                  placeholder="+256700000000"
                />
              </FormField>
              <FormField label="Item" htmlFor="b-item" error={errors['details.item_type']}>
                <Select
                  id="b-item"
                  value={form.item_type}
                  placeholder="What is being sent?"
                  options={[
                    { value: 'documents', label: 'Documents' },
                    { value: 'food', label: 'Food' },
                    { value: 'parcel', label: 'Parcel' },
                    { value: 'electronics', label: 'Electronics' },
                    { value: 'furniture', label: 'Furniture' },
                    { value: 'appliances', label: 'Appliances' },
                    { value: 'other', label: 'Other' },
                  ]}
                  onChange={set('item_type')}
                />
              </FormField>
              <FormField label="Size" htmlFor="b-size" error={errors['details.package_size']}>
                <Select
                  id="b-size"
                  value={form.package_size}
                  placeholder="How big?"
                  options={[
                    { value: 'small', label: 'Small — fits a rider' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'large', label: 'Large' },
                    { value: 'heavy', label: 'Heavy' },
                  ]}
                  onChange={set('package_size')}
                />
              </FormField>
              {/*
                Which end settles the bill, and on which rail — a parcel is
                the one service where the person ordering is often not the
                person paying, and the rider is told before setting off.
              */}
              <FormField label="Who pays" htmlFor="b-payer" error={errors['details.payer']}>
                <Select
                  id="b-payer"
                  value={form.payer}
                  placeholder="Not agreed yet"
                  options={[
                    { value: 'sender', label: 'Sender' },
                    { value: 'receiver', label: 'Receiver' },
                  ]}
                  onChange={set('payer')}
                />
              </FormField>
              <FormField
                label="Payment method"
                htmlFor="b-method"
                error={errors['details.payment_method']}
              >
                <Select
                  id="b-method"
                  value={form.payment_method}
                  placeholder="Not agreed yet"
                  options={[
                    { value: 'cash', label: 'Cash' },
                    { value: 'mobile_money', label: 'Mobile money' },
                    { value: 'card', label: 'Card' },
                  ]}
                  onChange={set('payment_method')}
                />
              </FormField>
              <div style={{ gridColumn: '1 / -1' }}>
                <Checkbox
                  id="b-pin"
                  checked={confirmWithPin}
                  onChange={(event) => setConfirmWithPin(event.target.checked)}
                  label="Confirm handover with a PIN"
                  hint="The recipient gives the rider a four-digit code instead of a signature."
                />
              </div>
            </>
          )}
          {service === 'self_drive' && (
            <>
              <FormField
                label="From"
                htmlFor="b-start"
                required
                error={errors['details.start_date']}
              >
                <Input
                  id="b-start"
                  type="date"
                  value={form.start_date}
                  onChange={set('start_date')}
                />
              </FormField>
              <FormField label="To" htmlFor="b-end" required error={errors['details.end_date']}>
                <Input id="b-end" type="date" value={form.end_date} onChange={set('end_date')} />
              </FormField>
              <div style={{ gridColumn: '1 / -1' }}>
                <FormField
                  label="Identity documents"
                  htmlFor="b-kyc"
                  hint="What the renter will bring — the desk checks originals at collection."
                  error={errors['details.kyc_documents']}
                >
                  <Input
                    id="b-kyc"
                    value={form.kyc_documents}
                    onChange={set('kyc_documents')}
                    placeholder="National ID, driving permit"
                  />
                </FormField>
              </div>
            </>
          )}
          {/*
            ADR-0051. What the client wants sent, as distinct from how many
            seats they need — a bank moving four people to a branch and one
            moving four people plus a cash escort book identically today.

            The hint is the honest half: this ranks candidates, it does not
            reserve anything, and promising otherwise on a form is how a
            dispatcher ends up explaining a sedan on the phone.
          */}
          {/* On a delivery the parcel's size is the sizing — see above. */}
          {service !== 'delivery' && (
            <FormField
              label="Vehicle type"
              htmlFor="b-category"
              hint={
                categoriesError === null
                  ? 'Optional. Dispatch prefers this kind and says so when none is free.'
                  : categoriesError
              }
              error={errors.vehicle_category}
            >
              <Select
                id="b-category"
                value={form.vehicle_category}
                disabled={categories === null || categoriesError !== null}
                placeholder={categories === null ? 'Loading…' : 'No preference'}
                options={categoryOptions(categories ?? [])}
                onChange={set('vehicle_category')}
              />
            </FormField>
          )}
          {/* A rental's clock is the hire period above, not a pickup time. */}
          {service !== 'self_drive' && (
            <FormField
              label="Pickup time"
              htmlFor="b-when"
              hint="Leave as it is for a pickup now."
              error={errors.scheduled_for}
            >
              <Input
                id="b-when"
                type="datetime-local"
                value={form.scheduled_for}
                // Not `set('scheduled_for')`: touching the field is what
                // turns the prefilled "now" into a chosen time — see
                // `pickupEdited` above.
                onChange={(event) => {
                  setPickupEdited(true)
                  setForm((current) => ({ ...current, scheduled_for: event.target.value }))
                }}
              />
            </FormField>
          )}
        </div>

        <FormField
          label="Notes"
          htmlFor="b-notes"
          hint="Anything the dispatcher should know"
          error={errors.notes}
        >
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
      // A rental has no route to recite; naming the service and the renter
      // is what tells two open dialogs apart.
      description={
        booking.service_type === 'self_drive'
          ? `Self-drive rental for ${booking.passenger_name}.`
          : `${booking.origin} → ${booking.destination} for ${booking.passenger_name}.`
      }
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
