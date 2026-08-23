import { isAxiosError } from 'axios'

import { apiClient } from '../../lib/apiClient'
import { apiError } from '../../lib/apiError'
import type { VehicleKind } from './MapPanel'
import {
  INITIAL_RIDE_STATE,
  type Captain,
  type Fare,
  type RatingOutcome,
  type RidePhase,
  type RideSource,
  type RideState,
} from './ride'

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
  /** The quote while the ride runs (ADR-0026 §2); null before a captain or once settled. */
  estimated_fare: ServedFare | null
  /** The bill, once the trip is complete. */
  fare: ServedFare | null
  created_at: string | null
}

interface ServedFare {
  total_minor: number
  currency: string | null
  distance_km: number | null
  is_estimate: boolean
}

/**
 * The server's money shape into the screen's. Minor units are shillings
 * already — UGX has no subunit — so `total_minor` is the figure as spoken.
 * No breakdown: the platform stores the settled fare as one figure and the
 * lines live on the invoice, and inventing three numbers that add up to it
 * would be a bill nobody issued.
 */
function toFare(served: ServedFare | null | undefined): Fare | null {
  // `undefined` too: a server a release behind does not send the field, and
  // a throw inside the poll would stop every state after it.
  if (served == null) return null

  return { total: served.total_minor, distanceKm: served.distance_km }
}

export function liveRideSource(): RideSource {
  const listeners = new Set<(state: RideState) => void>()

  let state: RideState = INITIAL_RIDE_STATE
  let timer: ReturnType<typeof setTimeout> | null = null
  /**
   * Which poll loop is the live one.
   *
   * Bumped on every start *and* every stop, which is what makes the source
   * survive being torn down and set up again. A boolean `stopped` flag cannot:
   * a request already in flight when the last listener leaves resolves after
   * the restart, and with only a flag to consult it cannot tell "I am the
   * current loop" from "I am the ghost of the previous one" — so it schedules
   * a second chain alongside the new one and the screen polls twice over.
   *
   * Comparing a captured generation against this one answers that exactly:
   * a poll whose generation is stale emits nothing and schedules nothing.
   */
  let generation = 0
  /** Wall-clock start, used only for the search rail. See `searchProgress`. */
  const startedAt = Date.now()

  const emit = (next: RideState) => {
    state = next
    listeners.forEach((listener) => listener(state))
  }

  const mine = (generation_: number) => generation_ === generation

  const poll = async (mine: number) => {
    try {
      const response = await apiClient.get('/customer/rides/active')
      const ride = response.data.data as RideResponse | null

      if (mine !== generation) return

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
      if (mine === generation) {
        timer = setTimeout(() => void poll(mine), POLL_INTERVAL_MS)
      }
    }
  }

  return {
    subscribe(listener) {
      listener(state)
      listeners.add(listener)

      /*
       * The first listener starts the loop — and starts it *again* after a
       * previous one ended it.
       *
       * React StrictMode mounts, cleans up and mounts again in development,
       * and `RideScreen` subscribes in an effect, so the first cleanup lands
       * before the first poll has ever come back. The earlier version treated
       * that cleanup as final: the passenger's screen sat on "Finding you a
       * captain" for the whole ride while the server had been answering
       * `accepted` since the driver tapped it. Every test here passed, because
       * they all subscribe exactly once.
       *
       * `simulatedRideSource` learned this same lesson already, in the same
       * words — see its `subscribe`. This is the live half of that fix.
       *
       * Starting here rather than at construction also means a source nobody
       * is watching sends no requests at all.
       */
      if (listeners.size === 1) {
        generation += 1
        void poll(generation)
      }

      return () => {
        listeners.delete(listener)

        // The last listener leaving ends the poll. Without this, navigating
        // away from the ride screen leaves a request going out every four
        // seconds for as long as the tab is open.
        //
        // The bump orphans whatever is in flight, so a response that arrives
        // after this point neither emits to a dead screen nor schedules a
        // successor.
        if (listeners.size === 0) {
          generation += 1
          if (timer !== null) {
            clearTimeout(timer)
            timer = null
          }
        }
      }
    },

    cancel(reason) {
      /*
       * The passenger calls their own ride off (ADR-0024 §7).
       *
       * This was a deliberate no-op while there was no endpoint behind it —
       * a button wired to nothing is worse than no button, because it appears
       * to work. There is one now.
       *
       * Note what is still *not* decided here: whether anybody is charged.
       * The server leaves `cancellation_charge_applicable` null because the
       * commercial rule does not exist yet, and this screen does not invent
       * one either.
       */
      void (async () => {
        try {
          await apiClient.post('/customer/rides/active/cancellation', { reason })
        } catch (error) {
          /*
           * The state is left as it was — forcing `cancelled` locally would
           * tell a passenger sitting in a moving car that their ride was
           * called off — but the *reason* is no longer swallowed.
           *
           * The interesting failure is a 409: the driver started the journey
           * in the seconds between the sheet opening and the tap landing, and
           * the ride genuinely cannot be cancelled any more. That used to be
           * silence, and silence after a tap reads as a broken button — the
           * owner's "the cancel trip is not working on the web app". The
           * server's own sentence says what to do instead ("speak to your
           * Captain"), so it is shown, verbatim, until the next tick.
           */
          const message = refusalMessage(error)
          if (message !== null && mine(generation)) emit({ ...state, notice: message })
        }

        /*
         * Ask again straight away rather than waiting out the interval: the
         * customer just acted and is watching for the screen to acknowledge
         * it, and four seconds of nothing reads as a tap that did not land.
         *
         * The running chain is cancelled and restarted under a new
         * generation, so this does not leave two loops going — the same
         * bookkeeping `subscribe` does, and the reason `generation` exists.
         */
        if (listeners.size === 0) return

        generation += 1
        if (timer !== null) {
          clearTimeout(timer)
          timer = null
        }
        void poll(generation)
      })()
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

    async rate(stars): Promise<RatingOutcome> {
      /*
       * The passenger's stars, filed against the trip (ADR-0030 §1).
       *
       * This existed as a screen-side flag before it existed at all: the
       * card said "You rated Grace 5 stars" while no request had been made
       * — found the night the owner rated a real ride and the driver's
       * numbers never moved. The endpoint had been sitting in the Customers
       * module the whole time; this is the call that was missing.
       *
       * A result rather than a throw, both ways. The server's refusals are
       * ordinary sentences a passenger can act on — "once it has been
       * completed", "already rated … cannot be changed" — and the screen
       * shows whichever it gets, verbatim, instead of a generic failure.
       */
      if (state.tripId === null) {
        return { recorded: false, message: 'This ride cannot be rated yet.' }
      }

      try {
        const response = await apiClient.post(`/customer/trips/${state.tripId}/rating`, { stars })
        const message: unknown = response.data?.message

        return {
          recorded: true,
          message:
            typeof message === 'string' && message !== ''
              ? message
              : 'Thank you — your rating has been recorded.',
        }
      } catch (failure: unknown) {
        return {
          recorded: false,
          message: apiError(failure, 'Your rating could not be sent. Please try again.').message,
        }
      }
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
    // What the rating files against. Served null until a captain accepts.
    tripId: ride.trip_id,
    progress: searchProgress(ride.phase, startedAt),
    // No ETA: ranking is straight-line (ADR-0020 §3), and a minutes figure
    // derived from it is a promise the platform cannot keep.
    etaSeconds: null,
    // Both from the platform now (`CustomerRideResource`). They were hard-coded
    // null here, so the passenger's own completion card — fare, pay, rate —
    // could never appear, whatever the driver's phone showed.
    estimate: toFare(ride.estimated_fare),
    fare: toFare(ride.fare),
    cancelledReason: ride.phase === 'cancelled' ? 'The ride was called off.' : null,
    /*
     * There is an endpoint behind the button now (ADR-0024 §7), so this is
     * true — and `isCancellable(phase)` is the other half of the pair, which
     * decides whether calling off makes sense at this point in the ride.
     *
     * The two are separate on purpose and both still matter: this one says
     * something is wired up, that one keeps the button away from the phases
     * `TripStatus` has no `cancelled` edge from. A passenger already moving
     * cannot un-start their journey, and offering the control there would be
     * offering a refusal.
     */
    cancellable: true,
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

/**
 * The server's own words for a refusal, or null when there are none to show.
 * Only a 4xx with a message qualifies: a network failure has nothing to say
 * about the ride, and the poll already knows how to wait one out.
 */
function refusalMessage(error: unknown): string | null {
  if (!isAxiosError(error)) return null
  const status = error.response?.status ?? 0
  if (status < 400 || status >= 500) return null
  const message = (error.response?.data as { message?: unknown } | undefined)?.message
  return typeof message === 'string' && message !== '' ? message : null
}
