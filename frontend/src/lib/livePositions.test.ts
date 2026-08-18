import { describe, expect, it } from 'vitest'
import {
  byAttention,
  fleetBounds,
  freshnessLabel,
  planMarkers,
  speedLabel,
  toneFor,
} from './livePositions'
import type { LivePosition } from '../types/livePosition'

function position(overrides: Partial<LivePosition> = {}): LivePosition {
  return {
    vehicle_id: 1,
    trip_id: 10,
    driver_id: 5,
    latitude: 0.3476,
    longitude: 32.5825,
    speed_kph: 40,
    heading_degrees: 90,
    recorded_at: '2026-08-07T12:00:00Z',
    age_seconds: 3,
    stale: false,
    ...overrides,
  }
}

describe('fleetBounds', () => {
  it('has nothing to fit when nothing is moving', () => {
    expect(fleetBounds([])).toBeNull()
  })

  it('boxes every vehicle, corners in MapLibre order', () => {
    const bounds = fleetBounds([
      position({ vehicle_id: 1, longitude: 32.5, latitude: 0.3 }),
      position({ vehicle_id: 2, longitude: 32.7, latitude: 0.4 }),
      position({ vehicle_id: 3, longitude: 32.6, latitude: 0.1 }),
    ])

    // [[west, south], [east, north]] — longitude first, both corners.
    expect(bounds).toEqual([
      [32.5, 0.1],
      [32.7, 0.4],
    ])
  })

  it('keeps longitude in the longitude slot for a single Kampala vehicle', () => {
    // The swap this platform has been bitten by twice: 32.58 and 0.34 are
    // both valid numbers, so only their *position* can catch it. If the
    // corners ever came back [[0.3476, 32.5825], ...] the map would centre
    // in the Gulf of Guinea and nothing would throw.
    const bounds = fleetBounds([position({ longitude: 32.5825, latitude: 0.3476 })])

    expect(bounds?.[0][0]).toBe(32.5825)
    expect(bounds?.[0][1]).toBe(0.3476)
  })
})

describe('toneFor', () => {
  it('calls a stale vehicle stale even when its last report had it speeding', () => {
    // Unknown outranks fast. A dispatcher deciding whether to phone a driver
    // needs "we have not heard from this" to survive the fact that the last
    // thing we heard was 80km/h.
    expect(toneFor(position({ stale: true, speed_kph: 80 }))).toBe('stale')
  })

  it('separates moving from stopped', () => {
    expect(toneFor(position({ speed_kph: 40 }))).toBe('moving')
    expect(toneFor(position({ speed_kph: 0 }))).toBe('stopped')
  })

  it('treats GPS jitter on a parked vehicle as stopped', () => {
    // A van in a yard reports 1–2 km/h all day. Without the floor the marker
    // alternates between two states while nothing happens.
    expect(toneFor(position({ speed_kph: 2 }))).toBe('stopped')
    expect(toneFor(position({ speed_kph: 2.9 }))).toBe('stopped')
    expect(toneFor(position({ speed_kph: 3 }))).toBe('moving')
  })

  it('treats a device that reported no speed as stopped, not as moving', () => {
    // Null is "we do not know", and claiming movement we cannot see would
    // put a vehicle on the board as available-and-working.
    expect(toneFor(position({ speed_kph: null }))).toBe('stopped')
  })
})

describe('freshnessLabel', () => {
  it('reads the way a dispatcher would say it', () => {
    expect(freshnessLabel(2)).toBe('just now')
    expect(freshnessLabel(30)).toBe('30s ago')
    expect(freshnessLabel(90)).toBe('1m ago')
    expect(freshnessLabel(3600)).toBe('1h ago')
  })

  it('does not render a clock-skewed device as a negative age', () => {
    // A phone running two seconds ahead of the server yields age -2. "-2s
    // ago" looks like a bug in the map rather than in a handset's clock.
    expect(freshnessLabel(-2)).toBe('just now')
  })

  it('does not round 59 seconds up into a minute it has not reached', () => {
    expect(freshnessLabel(59)).toBe('59s ago')
    expect(freshnessLabel(60)).toBe('1m ago')
  })
})

describe('speedLabel', () => {
  it('omits a speed the device never reported rather than printing zero', () => {
    // "0 km/h" is a claim that the vehicle is stationary. Null is the
    // absence of a claim, and the two must not render the same.
    expect(speedLabel(position({ speed_kph: null }))).toBeNull()
    expect(speedLabel(position({ speed_kph: 0 }))).toBe('0 km/h')
  })

  it('rounds to whole km/h', () => {
    expect(speedLabel(position({ speed_kph: 42.6 }))).toBe('43 km/h')
  })
})

describe('planMarkers', () => {
  it('adds what is new, updates what is already there, removes what has gone', () => {
    const plan = planMarkers(
      [1, 2, 3],
      [position({ vehicle_id: 2 }), position({ vehicle_id: 4 })],
    )

    expect(plan.add.map((p) => p.vehicle_id)).toEqual([4])
    expect(plan.update.map((p) => p.vehicle_id)).toEqual([2])
    // 1 and 3 finished their trips, or left this caller's scope.
    expect(plan.remove).toEqual([1, 3])
  })

  it('moves an existing marker rather than replacing it', () => {
    // The property the whole function exists for. If a vehicle already on
    // the map came back as an `add`, the component would destroy and rebuild
    // its marker every ten seconds: every vehicle blinks on every poll, and
    // an open popup closes under the dispatcher.
    const plan = planMarkers([7], [position({ vehicle_id: 7, latitude: 0.4 })])

    expect(plan.add).toHaveLength(0)
    expect(plan.remove).toHaveLength(0)
    expect(plan.update).toHaveLength(1)
  })

  it('clears the map when the last trip ends', () => {
    const plan = planMarkers([1, 2], [])

    expect(plan.remove).toEqual([1, 2])
    expect(plan.add).toHaveLength(0)
  })
})

describe('byAttention', () => {
  it('puts the vehicle nobody has heard from above the twelve that are fine', () => {
    const sorted = [
      position({ vehicle_id: 1, speed_kph: 0, age_seconds: 2 }),
      position({ vehicle_id: 2, speed_kph: 50, age_seconds: 2 }),
      position({ vehicle_id: 3, stale: true, age_seconds: 400 }),
    ].sort(byAttention)

    expect(sorted.map((p) => p.vehicle_id)).toEqual([3, 2, 1])
  })

  it('breaks a tie with the oldest report first', () => {
    const sorted = [
      position({ vehicle_id: 1, stale: true, age_seconds: 90 }),
      position({ vehicle_id: 2, stale: true, age_seconds: 600 }),
    ].sort(byAttention)

    expect(sorted.map((p) => p.vehicle_id)).toEqual([2, 1])
  })
})
