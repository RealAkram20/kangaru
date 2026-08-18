import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { apiClient } from '../../lib/apiClient'
import { liveRideSource } from './liveRideSource'
import type { RideState } from './ride'

/**
 * What the live source maps, and — more importantly — what it refuses to
 * invent (ADR-0024).
 *
 * The screen it feeds was designed against a simulation that supplied a fare,
 * an estimate and an ETA. The platform computes none of them, and the failure
 * mode of getting this wrong is not a crash: it is a number on somebody's
 * screen about their own money, or an arrival time the platform cannot keep.
 * Those are the assertions that matter here.
 */
function ride(overrides: Record<string, unknown> = {}) {
  return {
    reference: 'KR-ABC234',
    service_type: 'ride',
    phase: 'accepted',
    pickup: { label: 'Acacia Mall', latitude: 0.3476, longitude: 32.5825 },
    dropoff: { label: 'Garden City', latitude: null, longitude: null },
    trip_id: 12,
    captain: {
      name: 'Moses Kirabo',
      phone: '+256700000111',
      phone_label: 'Moses Kirabo',
      vehicle: 'Toyota Premio',
      plate: 'UBK 123X',
      vehicle_colour: 'White',
    },
    created_at: '2026-08-09T10:00:00.000Z',
    ...overrides,
  }
}

/** Resolves once the source has pushed a state built from a server answer. */
function firstServerState(): Promise<RideState> {
  return new Promise((resolve) => {
    const source = liveRideSource()
    const unsubscribe = source.subscribe((state) => {
      // The first push is the initial state, emitted synchronously on
      // subscribe. Only a state carrying a phase from the response counts.
      if (state.captain !== null || state.phase !== 'searching') {
        unsubscribe()
        resolve(state)
      }
    })
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** The poll interval in `liveRideSource`, mirrored for the timer tests. */
const POLL_INTERVAL_MS = 4_000

it('maps the server phase straight through, with no translation table', async () => {
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: ride({ phase: 'driver_arrived' }) } })

  const state = await firstServerState()

  // `ride.ts` named its phases after `TripStatus` so this stays an identity
  // function. A lookup table here is the thing that drifts.
  expect(state.phase).toBe('driver_arrived')
})

it('never invents a fare or an estimate', async () => {
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: ride({ phase: 'trip_completed' }) } })

  const state = await firstServerState()

  // ADR-0024 defers walk-in settlement by name, and `invoices` are
  // tenant-owned. A number here would be one this screen made up about
  // somebody's money.
  expect(state.fare).toBeNull()
  expect(state.estimate).toBeNull()
})

it('never promises an arrival time', async () => {
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: ride() } })

  const state = await firstServerState()

  // Ranking is straight-line (ADR-0020 §3) because road distance needs the
  // Directions API. "Four minutes away" from a great-circle number is a
  // promise the platform cannot keep.
  expect(state.etaSeconds).toBeNull()
})

it('offers the cancel button now that an endpoint sits behind it', async () => {
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: ride() } })

  const state = await firstServerState()

  // This asserted `false` for as long as cancelling was a no-op, on the rule
  // that a control which appears to work and does nothing is worse than its
  // absence. `POST /customer/rides/active/cancellation` exists now.
  expect(state.cancellable).toBe(true)
})

it('calls the ride off and asks the server again at once', async () => {
  const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: ride() } })
  const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: null } })

  const source = liveRideSource()
  const stop = source.subscribe(() => {})
  await vi.waitFor(() => expect(get).toHaveBeenCalled())

  const before = get.mock.calls.length
  source.cancel('I found another ride')

  expect(post).toHaveBeenCalledWith('/customer/rides/active/cancellation', {
    reason: 'I found another ride',
  })

  // Not left to the four-second tick: the customer just acted and is watching
  // for the screen to acknowledge it.
  await vi.waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(before))
  stop()
})

it('lets the next poll decide when a cancellation is refused', async () => {
  vi.spyOn(apiClient, 'get').mockResolvedValue({
    data: { data: ride({ phase: 'trip_started' }) },
  })
  vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('409'))

  const source = liveRideSource()
  const states: RideState[] = []
  const stop = source.subscribe((s) => states.push(s))
  await vi.waitFor(() => expect(states.some((s) => s.phase === 'trip_started')).toBe(true))

  source.cancel('Waiting too long')

  // The driver started the journey between the sheet opening and the tap
  // landing. Forcing `cancelled` locally would tell somebody sitting in a
  // moving car that their ride was called off.
  await vi.waitFor(() => expect(states.length).toBeGreaterThan(1))
  expect(states.every((s) => s.phase !== 'cancelled')).toBe(true)
  stop()
})

it('carries the captain and a number to ring', async () => {
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: ride() } })

  const state = await firstServerState()

  expect(state.captain?.name).toBe('Moses Kirabo')
  expect(state.captain?.phone).toBe('+256700000111')
  expect(state.captain?.plate).toBe('UBK 123X')
  expect(state.captain?.vehicleColour).toBe('White')
})

it('renders no dial link once the server stops sending a number', async () => {
  // The server withholds the number at a terminal status (ADR-0024 §7) — a
  // completed trip is not a directory. The screen must not fall back to
  // anything.
  vi.spyOn(apiClient, 'get').mockResolvedValue({
    data: { data: ride({ captain: { ...ride().captain, phone: null, phone_label: null } }) },
  })

  const state = await firstServerState()

  expect(state.captain?.phone).toBe('')
})

it('shows no rating rather than a flattering one', async () => {
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: ride() } })

  const state = await firstServerState()

  // `Modules/Drivers/README.md` lists driver rating as unbuilt. Zero renders
  // as "no rating yet"; inventing 4.8 would be a review nobody left.
  expect(state.captain?.rating).toBe(0)
})

/**
 * The bug that made a driver's accept invisible to the passenger.
 *
 * React StrictMode mounts, cleans up and mounts again in development, and
 * `RideScreen` subscribes in an effect — so the source is unsubscribed and
 * resubscribed before the first poll has ever landed. A source that treats
 * the first cleanup as final never polls again: the screen sits on "Finding
 * you a captain" while the server has been answering `accepted` for minutes.
 *
 * `simulatedRideSource` was fixed for exactly this (`ride.test.ts`, "survives
 * being unsubscribed and subscribed again") and the live source was not, which
 * is why every test above passed while the real screen was dead — they all
 * subscribe exactly once.
 */
it('survives being unsubscribed and subscribed again', async () => {
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: ride() } })

  const source = liveRideSource()

  // The StrictMode cleanup, before any answer has arrived.
  source.subscribe(() => {})()

  const state = await new Promise<RideState>((resolve) => {
    const stop = source.subscribe((s) => {
      if (s.captain !== null || s.phase !== 'searching') {
        stop()
        resolve(s)
      }
    })
  })

  expect(state.phase).toBe('accepted')
  expect(state.captain?.name).toBe('Moses Kirabo')
})

/**
 * The other half of the restart fix, and the reason it counts generations
 * rather than flipping a boolean.
 *
 * A request already in flight when the last listener leaves resolves *after*
 * the next subscribe. A flag cannot tell that straggler apart from the new
 * loop, so it schedules a successor of its own and the screen quietly polls
 * twice as often for the rest of the ride — on somebody's mobile data.
 */
it('runs one poll loop after a restart, not two', async () => {
  vi.useFakeTimers()
  const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: ride() } })

  const source = liveRideSource()
  source.subscribe(() => {})()

  const stop = source.subscribe(() => {})
  await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
  stop()

  // One immediate request per subscribe (the second orphaned at once), then
  // one chain ticking three times. A second chain would show up as extra.
  expect(get).toHaveBeenCalledTimes(5)
})

it('stops polling once the last listener leaves', async () => {
  vi.useFakeTimers()
  const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: ride() } })

  const stop = liveRideSource().subscribe(() => {})
  await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2)
  stop()
  const seen = get.mock.calls.length

  // Navigating away must not leave a request going out every four seconds
  // for as long as the tab is open.
  await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5)

  expect(get).toHaveBeenCalledTimes(seen)
})

it('sends nothing until somebody is watching', () => {
  vi.useFakeTimers()
  const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: ride() } })

  liveRideSource()

  expect(get).not.toHaveBeenCalled()
})

it('holds the last known state when a poll fails', async () => {
  const get = vi.spyOn(apiClient, 'get')
  get.mockResolvedValueOnce({ data: { data: ride({ phase: 'driver_en_route' }) } })

  const state = await firstServerState()

  // A dropped poll is a tab that walked into a lift. The honest rendering is
  // the last thing we knew — not an error over a ride proceeding perfectly
  // well without us.
  get.mockRejectedValue(new Error('offline'))

  expect(state.phase).toBe('driver_en_route')
})