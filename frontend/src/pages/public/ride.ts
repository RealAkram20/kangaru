import { liveRideSource } from './liveRideSource'
import type { VehicleKind } from './MapPanel'

/**
 * The walk-in ride, as the customer's screen sees it: matching, the
 * captain's approach, the trip itself, and the fare at the end.
 *
 * ## What is real and what is not
 *
 * **This is now wired to the platform (ADR-0024).** `createRideSource` hands
 * back `liveRideSource`, which polls `GET /customer/rides/active`; the
 * simulation below is kept for tests and for `VITE_SIMULATE_RIDE=true`.
 *
 * The rest of this note is left as written, because it is the record of what
 * had to exist first and every item on its list is now built: the driver is
 * an authenticated principal (ADR-0016), walk-in trips have a non-tenant
 * owner (ADR-0024 §1), driver presence and position are stored (§2), and
 * matching offers a ride and takes an accept under the same pessimistic lock
 * dispatch already used (§3).
 *
 * Nothing behind this file was real when it was written, and the gap was
 * wider than one missing endpoint. The platform has two public routes —
 * `POST /api/v1/public/order-requests` and `GET /api/v1/public/settings` —
 * and the fulfilment spine underneath is corporate-only: `trips.tenant_id`
 * is a non-nullable foreign key, there is no `trips.customer_id`, `Driver`
 * is a plain model with no guard and no login, and nothing records which
 * drivers are online or where they are. ADR-0012 said as much when it
 * shipped: walk-in fulfilment is "deferred to its own ADR".
 *
 * So `simulatedRideSource` plays the timeline the screens were designed
 * against. It is the only thing in this feature that lies, which is why it
 * is one named function behind one interface rather than timers sprinkled
 * through the components.
 *
 * ## Wiring it to the real thing
 *
 * Replace the body of `createRideSource` with a source that polls (or
 * subscribes to) the customer's ride and maps the server's status onto
 * `RidePhase`. The phase names are deliberately `TripStatus`'s own names,
 * so that mapping is an identity function rather than a translation table
 * somebody has to keep in step. Nothing in `RideScreen` changes: it renders
 * whatever states arrive, in whatever order.
 *
 * The backend work this waits on, in dependency order: the driver becomes
 * an authenticated principal; walk-in trips get an owner that is not a
 * tenant; driver presence and position land in Redis (ADR-0003); matching
 * offers a ride and takes an accept under the same pessimistic lock
 * dispatch already uses.
 */

/**
 * Named after `TripStatus` wherever a case exists there — `driver_en_route`,
 * `driver_arrived`, `passenger_onboard`, `trip_completed`, `cancelled`.
 *
 * `searching`, `offered` and `unmatched` have no `TripStatus` twin on
 * purpose: they happen before a trip exists at all.
 *
 * `offered` is never emitted by the walk-in timeline, and that is the point
 * of automatic dispatch — the system picks a captain, notifies them and
 * takes the accept without the customer watching it. It stays in the type
 * because a real matcher may want to surface a decline that reopens the
 * search, which is a thing the customer would need told about.
 *
 * ## Why the in-journey trio is here
 *
 * `trip_started`, `waiting` and `trip_resumed` are `TripStatus` cases the
 * driver's app posts once the passenger is aboard, and `CustomerRideResource`
 * sends the trip's status through verbatim — so they arrive on this screen
 * whether or not the type admits them. They were missing, and the failure was
 * silent in the worst way: the sheet has no copy for an unknown phase and no
 * captain card either, so the moment a driver tapped "Start trip" the
 * passenger's screen emptied out mid-journey.
 *
 * They are deliberately **not** in `isCancellable`. `TripStatus` allows no
 * edge from `trip_started` to `cancelled` — a journey under way is ended by
 * finishing it, not by calling it off — so offering the button would be
 * offering a refusal.
 */
export type RidePhase =
  | 'searching'
  | 'offered'
  | 'unmatched'
  | 'accepted'
  | 'driver_en_route'
  | 'driver_arrived'
  | 'passenger_onboard'
  | 'trip_started'
  | 'waiting'
  | 'trip_resumed'
  | 'trip_completed'
  | 'cancelled'

export interface Captain {
  name: string
  vehicle: string
  /** The body colour, because "a white Premio" is how you spot it. */
  vehicleColour: string
  plate: string
  rating: number
  kind: VehicleKind
  /** Dialled directly from the ride screen. */
  phone: string
  /** Road distance to the pickup, kilometres. */
  distanceKm: number
  etaMinutes: number
  /** Where to draw them, when the map is showing the approach. */
  lngLat: [number, number] | null
}

/**
 * Every amount is an integer number of shillings. UGX is zero-decimal, so
 * the minor unit *is* the shilling — no cents, and no floats near money
 * (AGENTS.md).
 */
export interface Fare {
  base: number
  distance: number
  time: number
  total: number
  distanceKm: number
  minutes: number
}

export interface RideState {
  phase: RidePhase
  captain: Captain | null
  /** 0–1, drives the matching rail. Monotonic: it never walks backwards. */
  progress: number
  /** Seconds left on the current leg, while one is running. */
  etaSeconds: number | null
  /**
   * What the trip is expected to cost, known from the moment a captain is
   * assigned. Distinct from `fare`, which is what it actually came to —
   * the customer needs the first before they get in and the second after
   * they get out, and conflating them is how a quote becomes a bill.
   */
  estimate: Fare | null
  /** Set once the trip is over. */
  fare: Fare | null
  /** Set when the ride was called off, so the screen can explain itself. */
  cancelledReason: string | null
  /**
   * Whether the *source* can actually call this ride off.
   *
   * Separate from `isCancellable(phase)`, which answers a different question:
   * that one says whether cancelling would make sense at this point in the
   * ride, and this one says whether anything is behind the button.
   *
   * The live source sets it false. ADR-0024 defers customer cancellation by
   * name — cancelling carries a charge rule, and who pays what when somebody
   * calls off a ride ninety seconds before pickup is a commercial decision
   * nobody has made. A button wired to nothing is worse than no button,
   * because it appears to work.
   */
  cancellable: boolean
}

export interface RideSource {
  /** Pushes the current state immediately, then on every change. Returns an unsubscribe. */
  subscribe(listener: (state: RideState) => void): () => void
  /** The one thing the customer can do to a ride in flight. */
  cancel(reason: string): void
  /**
   * Where the trip is heading, told to the source rather than asked of the
   * caller. A drop-off typed by hand has no coordinates until something
   * geocodes it, which can finish after the ride has already started — and
   * rebuilding the source to hand them over would restart the search in
   * front of somebody already watching it.
   */
  setDestination(point: [number, number] | null): void
}

export const INITIAL_RIDE_STATE: RideState = {
  phase: 'searching',
  captain: null,
  progress: 0,
  etaSeconds: null,
  estimate: null,
  fare: null,
  cancelledReason: null,
  cancellable: false,
}

/**
 * Phases where calling the ride off is still the customer's to do — which
 * includes being in the car. Somebody who needs out of a moving vehicle
 * needs it more than somebody still waiting at the kerb, and hiding the
 * control until the trip ends is the wrong way round. What a mid-trip
 * cancellation costs is a rate-card question, not a reason to remove the
 * button.
 */
export function isCancellable(phase: RidePhase): boolean {
  return (
    phase === 'searching' ||
    phase === 'offered' ||
    phase === 'accepted' ||
    phase === 'driver_en_route' ||
    phase === 'driver_arrived' ||
    phase === 'passenger_onboard'
  )
}

/** Reasons offered when somebody calls a ride off, as a closed list. */
export const CANCEL_REASONS = [
  'Waiting too long',
  'The captain is going the wrong way',
  'I ordered by mistake',
  'I found another ride',
  'Something else',
]

/**
 * A stable number from the order reference, so the same order always draws
 * the same captain. Re-rendering, or coming back to the screen, must not
 * reshuffle who is coming to collect you — `Math.random` here would do
 * exactly that, and would make the screen untestable besides.
 */
function seedFrom(reference: string): number {
  let hash = 0
  for (let i = 0; i < reference.length; i += 1) {
    hash = (hash * 31 + reference.charCodeAt(i)) >>> 0
  }
  return hash
}

const CAPTAIN_NAMES = [
  'Moses Kirabo',
  'Sarah Namutebi',
  'Joseph Wasswa',
  'Grace Atim',
  'Ibrahim Ssekandi',
  'Deborah Nakato',
]

const CAPTAIN_VEHICLES: { vehicle: string; kind: VehicleKind }[] = [
  { vehicle: 'Toyota Vitz', kind: 'sedan' },
  { vehicle: 'Toyota Premio', kind: 'sedan' },
  { vehicle: 'Toyota Harrier', kind: 'suv' },
  { vehicle: 'Nissan Note', kind: 'sedan' },
]

/** Body colours, because "a white Premio" is how a car is picked out. */
const VEHICLE_COLOURS = ['White', 'Silver', 'Black', 'Blue', 'Red']

/** Metres per degree of latitude, near enough at Kampala's latitude. */
const METRES_PER_DEGREE = 111_320

/**
 * Places the captain `distanceKm` from the pickup on a bearing fixed by the
 * reference. Longitude is not corrected for latitude here because Kampala
 * sits within half a degree of the equator, where the cosine term is 0.99996
 * — below the precision this decorative position is claiming.
 */
function captainPosition(
  near: [number, number] | null,
  distanceKm: number,
  seed: number,
): [number, number] | null {
  if (near === null) return null
  const bearing = ((seed % 360) * Math.PI) / 180
  const degrees = (distanceKm * 1000) / METRES_PER_DEGREE
  return [near[0] + Math.sin(bearing) * degrees, near[1] + Math.cos(bearing) * degrees]
}

/** Straight-line interpolation between two points, `t` in 0–1. */
function between(
  from: [number, number] | null,
  to: [number, number] | null,
  t: number,
): [number, number] | null {
  if (from === null || to === null) return from ?? to
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]
}

function captainFor(reference: string, near: [number, number] | null): Captain {
  const seed = seedFrom(reference)
  const { vehicle, kind } = CAPTAIN_VEHICLES[seed % CAPTAIN_VEHICLES.length]
  // Unsigned shifts throughout. `seedFrom` fills all 32 bits, so a signed
  // `>>` turns every hash above 2^31 negative, and a negative remainder
  // then indexes off the front of these arrays and walks String.fromCharCode
  // below 'A' — which is how a plate came out as "UJ7 197>".
  // 0.4–2.3 km, one decimal, the range a city match plausibly lands in.
  const distanceKm = Math.round((0.4 + ((seed >>> 3) % 20) / 10) * 10) / 10
  return {
    name: CAPTAIN_NAMES[(seed >>> 5) % CAPTAIN_NAMES.length],
    vehicle,
    plate: `U${String.fromCharCode(65 + (seed % 26))}${String.fromCharCode(
      65 + ((seed >>> 7) % 26),
    )} ${100 + (seed % 900)}${String.fromCharCode(65 + ((seed >>> 11) % 26))}`,
    vehicleColour: VEHICLE_COLOURS[(seed >>> 17) % VEHICLE_COLOURS.length],
    rating: Math.round((4.4 + ((seed >>> 13) % 6) / 10) * 10) / 10,
    kind,
    phone: `+2567${String(10_000_000 + (seed % 90_000_000)).slice(0, 8)}`,
    distanceKm,
    // Kampala traffic, roughly 18 km/h door to door, floored at a minute.
    etaMinutes: Math.max(1, Math.round((distanceKm / 18) * 60)),
    lngLat: captainPosition(near, distanceKm, seed),
  }
}

/**
 * The fare, in the shape a rate card will eventually supply: a base, a rate
 * per kilometre, a rate per minute.
 *
 * Hardcoded, and that is a known debt — AGENTS.md is explicit that prices
 * come from rate cards, and the ride classes on the order form carry
 * hardcoded fares for the same reason (no public rate-card endpoint exists
 * yet). When one does, this reads it, and the rounding rule comes with it.
 */
const FARE_BASE_UGX = 3000
const FARE_PER_KM_UGX = 1800
const FARE_PER_MINUTE_UGX = 200

function fareFor(distanceKm: number, minutes: number): Fare {
  const distance = Math.round(distanceKm * FARE_PER_KM_UGX)
  const time = Math.round(minutes * FARE_PER_MINUTE_UGX)
  return {
    base: FARE_BASE_UGX,
    distance,
    time,
    // Rounded to the nearest 100 shillings, the way a driver with no coins
    // actually settles up. The real rule belongs to the rate card.
    total: Math.round((FARE_BASE_UGX + distance + time) / 100) * 100,
    distanceKm: Math.round(distanceKm * 10) / 10,
    minutes,
  }
}

/** The scripted timeline, in milliseconds from subscribe. */
const SEARCH_MS = 4200
const CONFIRMED_MS = 2600
const EN_ROUTE_MS = 12_000
const ARRIVED_MS = 6000
const ON_TRIP_MS = 14_000

/**
 * Plays the whole ride on a timer. See the file header: this exists because
 * the backend cannot answer the question yet.
 *
 * Driver-side events fire on their own, because they happen *to* the
 * customer — a captain accepting, setting off, arriving, starting and
 * ending the trip. The only thing waiting on a tap is cancelling, which is
 * the only part the customer actually does.
 */
export function simulatedRideSource(
  reference: string,
  near: [number, number] | null,
  initialDestination: [number, number] | null = null,
): RideSource {
  let destination = initialDestination
  let listener: ((state: RideState) => void) | null = null
  let stopped = false
  const timers: number[] = []
  const captain = captainFor(reference, near)
  const tripMinutes = Math.max(4, Math.round(captain.distanceKm * 3.2))
  /*
   * Quoted the moment a captain is assigned and carried on every state
   * after — the customer is entitled to know what the ride costs before
   * they get in, not only after they get out. `INITIAL_RIDE_STATE` is
   * spread into each emit, so this is layered on top of it below.
   */
  const estimate = fareFor(captain.distanceKm * 2.4, tripMinutes)

  /*
   * The countdown the customer reads, not the wall-clock the simulation
   * runs on. A leg is compressed into seconds here so the whole ride can be
   * walked in under a minute, but the ETA must still fall smoothly from the
   * quoted figure to zero — reporting the raw twelve seconds made the
   * heading leap from "6 min" to "1 min" in one tick.
   */
  const remaining = (totalMinutes: number, t: number) =>
    Math.max(0, Math.round((1 - t) * totalMinutes * 60))
  // `cancellable: true` throughout the simulation, because its `cancel()`
  // genuinely calls the ride off. Only the live source answers false, and
  // only because ADR-0024 defers the endpoint (see `RideState.cancellable`).
  const assigned = { ...INITIAL_RIDE_STATE, captain, progress: 1, estimate, cancellable: true }

  const emit = (state: RideState) => {
    if (!stopped && listener !== null) listener(state)
  }

  const at = (ms: number, run: () => void) => {
    timers.push(window.setTimeout(run, ms))
  }

  const stopAll = () => {
    timers.forEach((id) => {
      window.clearTimeout(id)
      window.clearInterval(id)
    })
    timers.length = 0
  }

  return {
    subscribe(next) {
      listener = next
      /*
       * Reset, because a source must survive being re-subscribed. React
       * StrictMode mounts, cleans up and mounts again in development, and
       * with `stopped` latched by that first cleanup every later emit was
       * silently dropped — the screen sat on "Finding you a captain"
       * forever. Tests subscribe once and never saw it.
       */
      stopped = false
      emit(INITIAL_RIDE_STATE)

      const started = Date.now()

      // --- dispatch is looking ---
      const searchTick = window.setInterval(() => {
        const elapsed = Date.now() - started
        if (elapsed >= SEARCH_MS) return
        emit({
          ...INITIAL_RIDE_STATE,
          progress: Math.min(0.95, elapsed / SEARCH_MS),
          cancellable: true,
        })
      }, 120)
      timers.push(searchTick)

      at(SEARCH_MS, () => {
        window.clearInterval(searchTick)
        emit({ ...assigned, phase: 'accepted' })
      })

      // --- the approach, ETA counting down ---
      const enRouteFrom = SEARCH_MS + CONFIRMED_MS
      at(enRouteFrom, () => {
        const origin = captain.lngLat
        const tick = window.setInterval(() => {
          const t = Math.min(1, (Date.now() - started - enRouteFrom) / EN_ROUTE_MS)
          if (t >= 1) {
            window.clearInterval(tick)
            return
          }
          emit({
            ...assigned,
            phase: 'driver_en_route',
            captain: { ...captain, lngLat: between(origin, near, t) },
            progress: 1,
            etaSeconds: remaining(captain.etaMinutes, t),
          })
        }, 500)
        timers.push(tick)
        emit({
          ...assigned,
          phase: 'driver_en_route',
          captain,
          progress: 1,
          etaSeconds: captain.etaMinutes * 60,
        })
      })

      at(enRouteFrom + EN_ROUTE_MS, () => {
        emit({
          ...assigned,
          phase: 'driver_arrived',
          captain: { ...captain, lngLat: near },
          progress: 1,
          etaSeconds: 0,
        })
      })

      // --- the trip ---
      const onTripFrom = enRouteFrom + EN_ROUTE_MS + ARRIVED_MS
      at(onTripFrom, () => {
        const tick = window.setInterval(() => {
          const t = Math.min(1, (Date.now() - started - onTripFrom) / ON_TRIP_MS)
          if (t >= 1) {
            window.clearInterval(tick)
            return
          }
          emit({
            ...assigned,
            phase: 'passenger_onboard',
            captain: { ...captain, lngLat: between(near, destination, t) },
            progress: 1,
            etaSeconds: remaining(tripMinutes, t),
          })
        }, 500)
        timers.push(tick)
        emit({
          ...assigned,
          phase: 'passenger_onboard',
          captain,
          progress: 1,
          etaSeconds: tripMinutes * 60,
        })
      })

      at(onTripFrom + ON_TRIP_MS, () => {
        stopAll()
        emit({
          ...assigned,
          phase: 'trip_completed',
          captain: { ...captain, lngLat: destination },
          progress: 1,
          // The trip is longer than the captain's approach was.
          fare: fareFor(captain.distanceKm * 2.4, tripMinutes),
        })
      })

      return () => {
        stopped = true
        listener = null
        stopAll()
      }
    },

    setDestination(point) {
      destination = point
    },

    cancel(reason) {
      stopAll()
      emit({
        ...assigned,
        phase: 'cancelled',
        progress: 0,
        cancelledReason: reason,
      })
    },
  }
}

/**
 * The seam, and it has now moved (ADR-0024).
 *
 * Walk-in fulfilment shipped, so this hands back a source that polls the
 * customer's real ride. `simulatedRideSource` is kept rather than deleted for
 * two reasons: the screen's own tests drive it, and it is the only way to see
 * a full timeline — search, approach, trip, fare — without a driver on duty
 * somewhere. Set `VITE_SIMULATE_RIDE=true` to get it back.
 *
 * The arguments are now unused by the live path and are kept because the
 * simulation still takes them and `RideScreen` still passes them. The
 * destination is a fact on the order request server-side, and the reference
 * is deliberately not how the ride is looked up — see
 * `CustomerRideController` for why keying by a six-character code would
 * undo ADR-0012's refusal to return anything enumerable.
 */
export function createRideSource(
  reference: string,
  near: [number, number] | null,
  destination: [number, number] | null = null,
): RideSource {
  if (import.meta.env.VITE_SIMULATE_RIDE === 'true') {
    return simulatedRideSource(reference, near, destination)
  }

  return liveRideSource()
}

/** "UGX 12,500" — the one place a shilling amount becomes a string. */
export function formatUgx(amount: number): string {
  return `UGX ${amount.toLocaleString('en-UG')}`
}
