import { describe, expect, it } from 'vitest'
import { bearingBetween, headingFromKey, mergeFleet, type FleetSprite } from './nearbyVehicles'
import type { NearbyVehicle } from '../../types/livePosition'

function vehicle(overrides: Partial<NearbyVehicle> = {}): NearbyVehicle {
  return {
    key: 'abc123def456',
    category: 'boda',
    kind: 'boda',
    latitude: 0.3476,
    longitude: 32.5825,
    age_seconds: 20,
    ...overrides,
  }
}

describe('bearingBetween', () => {
  it('reads the compass the way a marker rotation needs it', () => {
    expect(bearingBetween([32.58, 0.34], [32.58, 0.35])).toBeCloseTo(0) // due north
    expect(bearingBetween([32.58, 0.34], [32.59, 0.34])).toBeCloseTo(90) // due east
    expect(bearingBetween([32.58, 0.34], [32.58, 0.33])).toBeCloseTo(180) // due south
    expect(bearingBetween([32.58, 0.34], [32.57, 0.34])).toBeCloseTo(270) // due west
  })
})

describe('mergeFleet', () => {
  it('derives a heading from real movement between polls', () => {
    const first = mergeFleet([], [vehicle()])
    // ~110m due east — far above jitter.
    const second = mergeFleet(first, [vehicle({ longitude: 32.5835 })])

    expect(second[0].heading).toBeCloseTo(90, 0)
  })

  it('keeps the previous heading when the vehicle only jittered', () => {
    const moving = mergeFleet(
      mergeFleet([], [vehicle()]),
      [vehicle({ longitude: 32.5835 })], // heading now ~90
    )
    // ~2m north — a parked vehicle's GPS breathing, not a turn.
    const parked = mergeFleet(moving, [vehicle({ longitude: 32.5835, latitude: 0.34762 })])

    expect(parked[0].heading).toBe(moving[0].heading)
  })

  it('gives a newcomer a rotation that is stable for its key', () => {
    const a = mergeFleet([], [vehicle({ key: 'aaaaaaaaaaaa' })])
    const b = mergeFleet([], [vehicle({ key: 'aaaaaaaaaaaa' })])

    // The same first sighting twice must not spin the sprite...
    expect(a[0].heading).toBe(b[0].heading)
    expect(a[0].heading).toBe(headingFromKey('aaaaaaaaaaaa'))
    // ...and different keys should not all face the same way.
    const c = mergeFleet([], [vehicle({ key: 'bbbbbbbbbbbb' })])
    expect(c[0].heading).not.toBe(a[0].heading)
  })

  it('drops a key that vanished — off duty, on a job, or the hourly rotation', () => {
    const before: FleetSprite[] = mergeFleet([], [vehicle({ key: 'gone00000000' }), vehicle({ key: 'stays0000000' })])
    const after = mergeFleet(before, [vehicle({ key: 'stays0000000' })])

    expect(after.map((s) => s.key)).toEqual(['stays0000000'])
  })

  it('carries position in MapLibre lng-first order', () => {
    const [sprite] = mergeFleet([], [vehicle({ latitude: 0.3476, longitude: 32.5825 })])

    // Swapped, this is a point in the Gulf of Guinea — the same trap KAMPALA
    // documents.
    expect(sprite.lngLat).toEqual([32.5825, 0.3476])
  })
})
