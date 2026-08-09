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
})

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

it('offers no cancel button, because there is no endpoint behind one', async () => {
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: ride() } })

  const state = await firstServerState()

  // A control that appears to work and does nothing is worse than its
  // absence. ADR-0024 defers customer cancellation: it carries a charge rule
  // nobody has decided.
  expect(state.cancellable).toBe(false)
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