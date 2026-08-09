import { apiClient } from '../../lib/apiClient'
import type { VehicleKind } from './MapPanel'
import { INITIAL_RIDE_STATE, type Captain, type RidePhase, type RideSource, type RideState } from './ride'

/**
 * The real thing behind the ride screen (ADR-0024).
 *
 * `ride.ts` was written against a simulation and said exactly what would
 * replace it: *"Replace the body of `createRideSource` with a source that
 * polls (or subscribes to) the customer's ride and maps the server's status
 * onto `RidePhase`. The phase names are deliberately `TripStatus`'s own
 * names, so that mapping is an identity function rather than a translation
 * table somebody has to keep in step."*
 *
 * This is that source, and the mapping is an identity function.
 *
 * ## Polling, not a socket
 *
 * The customer is looking at this tab. A websocket would die with the
 * process, reconnect on every tunnel, and need a server this platform does
 * not run — and the thing being watched changes a handful of times over a
 * fifteen-minute ride. Four seconds is well inside human patience for "the
 * car moved" and costs one small request.
 *
 * ## What this source does not have, and does not invent
 *
 * The simulation supplied an estimate, a final fare, an ETA and a progress
 * fraction. The platform computes none of them:
 *
 * - **No fare.** ADR-0024 leaves walk-in settlement — cash, mobile money, a
 *   receipt — deferred by name, and `invoices` are tenant-owned. A number
 *   here would be one this screen made up about somebody's money.
 * - **No ETA.** ADR-0020 §3 ranks by straight-line distance precisely because
 *   road distance needs the Directions API. "Four minutes away" from a
 *   great-circle number is a promise the platform cannot keep.
 *
 * Both stay null, and `RideScreen` already guards every one of them — it
 * renders the payment card only `when estimate !== null`. A screen that shows
 * less is better than a screen that lies.
 */

const POLL_INTERVAL_MS = 4_000

/** What `GET /api/v1/customer/rides/active` returns. */
interface RideResponse {
  reference: string
  service_type: string
  phase: RidePhase
  pickup: { label: string | null; latitude: number | null; longitude: number | null }
  dropoff: { label: string | null; latitude: number | null; longitude: number | null }
  trip_id: number | null
  captain: {
    name: string
    phone: string | null
    phone_label: string | null
    vehicle: string | null
    plate: string | null
    vehicle_colour: string | null
  } | null
  created_at: string | null
}

export function liveRideSource(): RideSource {
  const listeners = new Set<(state: RideState) => void>()

  let state: RideState = INITIAL_RIDE_STATE
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  /** Wall-clock start, used only for the search rail. See `searchProgress`. */
  const startedAt = Date.now()

  const emit = (next: RideState) => {
    state = next
    listeners.forEach((listener) => listener(state))
  }

  const poll = async () => {
    try {
      const response = await apiClient.get('/customer/rides/active')
      const ride = response.data.data as RideResponse | null

      if (stopped) return

      // Null means the ride is over, or there never was one. The screen's
      // own `trip_completed`/`cancelled` handling has already run by then;
      // holding the last known state is better than snapping back to
      // "searching", which would restart the rail under somebody who has
      // just been dropped off.
      if (ride !== null) {
        emit(toRideState(ride, startedAt))
      }
    } catch {
      /*
       * Swallowed, and the state is left exactly as it was.
       *
       * A dropped poll is a tab on a phone that walked into a lift, and the
       * honest rendering of that is the last thing we knew — not an error
       * banner over a ride that is proceeding perfectly well without us. The
       * next tick recovers.
       */
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
      }
    }
  }

  void poll()

  return {
    subscribe(listener) {
      listener(state)
      listeners.add(listener)

      return () => {
        listeners.delete(listener)

        // The last listener leaving ends the poll. Without this, navigating
        // away from the ride screen leaves a request going out every four
        // seconds for as long as the tab is open.
        if (listeners.size === 0) {
          stopped = true
          if (timer !== null) clearTimeout(timer)
        }
      }
    },

    cancel() {
      /*
       * Deliberately does nothing, and `RideState.cancellable` is what stops
       * the button being offered in the first place.
       *
       * ADR-0024 defers customer cancellation by name: cancelling has a
       * charge rule (`trips.cancellation_charge_applicable`), and who pays
       * what when somebody calls off a ride ninety seconds before pickup is a
       * commercial decision nobody has made. Wiring this to an endpoint that
       * does not exist would be worse than the button's absence — it would
       * appear to work.
       */
    },

    setDestination() {
      /*
       * The server already has the drop-off: it came in with the order.
       *
       * The simulation needed telling because it was drawing a route it had
       * invented. Here the destination is a fact on `order_requests`, and a
       * client that could revise it mid-ride would be changing the job a
       * driver accepted.
       */
    },
  }
}

function toRideState(ride: RideResponse, startedAt: number): RideState {
  return {
    // The identity function `ride.ts` asked for. Both sides speak
    // `TripStatus`'s vocabulary, plus the three pre-trip phases the server
    // derives (`searching`, `offered`, `unmatched`).
    phase: ride.phase,
    captain: toCaptain(ride),
    progress: searchProgress(ride.phase, startedAt),
    // No ETA: ranking is straight-line (ADR-0020 §3), and a minutes figure
    // derived from it is a promise the platform cannot keep.
    etaSeconds: null,
    estimate: null,
    fare: null,
    cancelledReason: ride.phase === 'cancelled' ? 'The ride was called off.' : null,
    // No endpoint, so no button. See `cancel()` above.
    cancellable: false,
  }
}

function toCaptain(ride: RideResponse): Captain | null {
  if (ride.captain === null) return null

  return {
    name: ride.captain.name,
    vehicle: ride.captain.vehicle ?? 'Vehicle',
    vehicleColour: ride.captain.vehicle_colour ?? '',
    plate: ride.captain.plate ?? '',
    // The platform has no driver rating — `Modules/Drivers/README.md` lists
    // it as unbuilt. Zero renders as "no rating yet" rather than as a bad
    // one; inventing 4.8 would be a review nobody left.
    rating: 0,
    kind: vehicleKindFor(ride.captain.vehicle),
    // Null once the trip reaches a terminal status, because the server stops
    // sending it (ADR-0024 §7). Empty string keeps the type honest and the
    // screen renders no dial link.
    phone: ride.captain.phone ?? '',
    // Straight-line kilometres are not road distance, and the screen has no
    // honest way to show either as a number the customer can act on.
    distanceKm: 0,
    etaMinutes: 0,
    lngLat: null,
  }
}

/**
 * A guess for the searching rail, and nothing more.
 *
 * The platform cannot say how far through a search it is — it is offering a
 * job to one driver at a time, and whether the next one answers is unknown.
 * So this is elapsed time against a plausible search length, **monotonic**
 * because `RideState.progress` promises that: a rail that walks backwards
 * reads as the system losing ground.
 *
 * It stops short of 0.95 on purpose. A bar that reaches the end and stays
 * there is a bar that has visibly given up, and this search has not.
 */
function searchProgress(phase: RidePhase, startedAt: number): number {
  if (phase !== 'searching' && phase !== 'offered') return 1

  const elapsed = (Date.now() - startedAt) / 1000
  const assumedSearchSeconds = 90

  return Math.min(0.95, elapsed / assumedSearchSeconds)
}

/** Best guess at the body shape, for the marker the map draws. */
function vehicleKindFor(vehicle: string | null): VehicleKind {
  const text = (vehicle ?? '').toLowerCase()

  if (text.includes('boda') || text.includes('motor')) return 'boda'
  if (text.includes('harrier') || text.includes('prado') || text.includes('suv')) return 'suv'

  return 'sedan'
}