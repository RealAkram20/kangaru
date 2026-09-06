import { describe, expect, it } from 'vitest'
import {
  buildUnits,
  categoryLabel,
  nearbyToUnits,
  spriteKindFor,
  byAttention,
  fleetBounds,
  freshnessLabel,
  matchesFilter,
  matchesQuery,
  planMarkers,
  speedLabel,
  statusLabel,
  summarise,
  toneFor,
  unitTitle,
  type FleetUnit,
} from './livePositions'
import type { LivePosition, NearbyVehicle, OnDutyDriver } from '../types/livePosition'

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
    vehicle: { id: 1, registration_number: 'UBK 421H', make: 'Toyota', model: 'Noah' },
    driver: { id: 5, name: 'Grace Nakato' },
    trip: {
      id: 10,
      status: 'trip_started',
      origin: 'Kampala Road',
      destination: 'Entebbe Airport',
      client: { id: 3, name: 'Centenary Bank' },
    },
    ...overrides,
  }
}

function driver(overrides: Partial<OnDutyDriver> = {}): OnDutyDriver {
  return {
    driver_id: 15,
    driver: { id: 15, name: 'Okello Denis' },
    vehicle_id: 19,
    vehicle: { id: 19, registration_number: 'UAX 900Q', make: 'Bajaj', model: 'Boxer', category: 'boda' },
    latitude: 0.395,
    longitude: 32.703,
    accuracy_metres: 12,
    recorded_at: '2026-08-07T12:00:00Z',
    age_seconds: 20,
    stale: false,
    trip: null,
    ...overrides,
  }
}

function unit(overrides: Partial<FleetUnit> = {}): FleetUnit {
  return buildUnits([position()], []).map((u) => ({ ...u, ...overrides }))[0]
}

describe('buildUnits', () => {
  it('merges the two lists: vehicles on trips, then the pool', () => {
    const units = buildUnits([position()], [driver()])

    expect(units).toHaveLength(2)
    expect(units[0]).toMatchObject({
      key: 'v:1',
      kind: 'on_trip',
      source: 'vehicle',
      plate: 'UBK 421H',
      vehicleName: 'Toyota Noah',
      driverName: 'Grace Nakato',
      clientName: 'Centenary Bank',
      tripId: 10,
    })
    expect(units[1]).toMatchObject({
      key: 'd:15',
      kind: 'waiting',
      source: 'handset',
      plate: 'UAX 900Q',
      driverName: 'Okello Denis',
      tripId: null,
    })
  })

  it('does not draw a driver twice when their trip already has a vehicle position', () => {
    const units = buildUnits([position({ trip_id: 10 })], [driver({ trip: { id: 10, status: 'trip_started' } })])

    // One marker for the trip — the vehicle's, which is the billing-grade
    // stream. Drawing the handset too would put two dots on one van.
    expect(units).toHaveLength(1)
    expect(units[0].key).toBe('v:1')
  })

  it('draws a driver on a trip from their handset while the vehicle is dark, and says so', () => {
    const units = buildUnits([], [driver({ trip: { id: 77, status: 'passenger_onboard' } })])

    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({ kind: 'on_trip', source: 'handset', tripId: 77 })
  })

  it('carries the silhouette for the map, from the vehicle category', () => {
    // The named position fixture is a Toyota Noah, category 'van'.
    const [onTrip] = buildUnits(
      [position({ vehicle: { id: 1, registration_number: 'UBK 421H', make: 'Toyota', model: 'Noah', category: 'van' } })],
      [],
    )
    expect(onTrip.spriteKind).toBe('suv')

    const [waiting] = buildUnits([], [driver()])
    expect(waiting.spriteKind).toBe('boda')

    const [anonymous] = nearbyToUnits([
      { key: 'k', category: 'pickup', kind: 'pickup', latitude: 0.3, longitude: 32.5, age_seconds: 5 },
    ])
    expect(anonymous.spriteKind).toBe('pickup')
  })

  it('draws the generic car for a category the sprite set does not know', () => {
    expect(spriteKindFor('hovercraft')).toBe('sedan')
    expect(spriteKindFor(null)).toBe('sedan')
    expect(spriteKindFor(undefined)).toBe('sedan')
    expect(spriteKindFor('tricycle')).toBe('boda')
  })

  it('falls back to ids when the API predates the named fields', () => {
    const units = buildUnits([position({ vehicle: undefined, driver: undefined, trip: undefined })], [])

    expect(units[0].plate).toBeNull()
    expect(unitTitle(units[0])).toBe('Vehicle #1')
  })
})

describe('nearbyToUnits', () => {
  const nearbyVehicle: NearbyVehicle = {
    key: 'abc123def456',
    category: 'boda',
    kind: 'boda',
    latitude: 0.3476,
    longitude: 32.5825,
    age_seconds: 20,
  }

  it('turns the anonymized pool into waiting units named by category', () => {
    const [u] = nearbyToUnits([nearbyVehicle])

    expect(u).toMatchObject({
      key: 'n:abc123def456',
      kind: 'waiting',
      vehicleName: 'Boda',
      latitude: 0.3476,
      longitude: 32.5825,
      ageSeconds: 20,
      stale: false,
    })
    expect(toneFor(u)).toBe('waiting')
    expect(statusLabel(u)).toBe('Waiting for work')
    // Its category is its whole name — this surface knows nothing else.
    expect(unitTitle(u)).toBe('Boda')
  })

  it('carries no identity of any kind — that is the contract, not a gap', () => {
    const [u] = nearbyToUnits([nearbyVehicle])

    expect(u.driverId).toBeNull()
    expect(u.driverName).toBeNull()
    expect(u.vehicleId).toBeNull()
    expect(u.plate).toBeNull()
    expect(u.tripId).toBeNull()
  })

  it('names the honest generic when no category is on record', () => {
    const [u] = nearbyToUnits([{ ...nearbyVehicle, category: null }])

    expect(unitTitle(u)).toBe('Vehicle')
    expect(categoryLabel(null)).toBe('Vehicle')
  })
})

describe('fleetBounds', () => {
  it('has nothing to fit when nothing has a position', () => {
    expect(fleetBounds([])).toBeNull()
    expect(fleetBounds([unit({ latitude: null, longitude: null })])).toBeNull()
  })

  it('boxes every placed unit, corners in MapLibre order', () => {
    const bounds = fleetBounds([
      unit({ key: 'v:1', latitude: 0.3, longitude: 32.5 }),
      unit({ key: 'v:2', latitude: 0.4, longitude: 32.7 }),
      unit({ key: 'd:3', latitude: null, longitude: null }),
    ])

    expect(bounds).toEqual([
      [32.5, 0.3],
      [32.7, 0.4],
    ])
  })

  it('keeps longitude in the longitude slot for a single Kampala vehicle', () => {
    const bounds = fleetBounds([unit({ latitude: 0.3476, longitude: 32.5825 })])

    // Swapped, this is a point in the Gulf of Guinea — see KAMPALA.
    expect(bounds).toEqual([
      [32.5825, 0.3476],
      [32.5825, 0.3476],
    ])
  })
})

describe('toneFor and statusLabel', () => {
  it('calls a stale vehicle stale even when its last report had it speeding', () => {
    const u = unit({ stale: true, speedKph: 80 })
    expect(toneFor(u)).toBe('stale')
    expect(statusLabel(u)).toBe('Not reporting')
  })

  it('says "No position" for a driver who has never reported', () => {
    const u = unit({ stale: true, ageSeconds: null, latitude: null, longitude: null })
    expect(statusLabel(u)).toBe('No position')
  })

  it('calls the pool waiting, and names the trip phase for a unit on one', () => {
    const pool = buildUnits([], [driver()])[0]
    expect(toneFor(pool)).toBe('waiting')
    expect(statusLabel(pool)).toBe('Waiting for work')

    const onTrip = unit({ tripStatus: 'driver_en_route' })
    expect(statusLabel(onTrip)).toBe('Driver en route')
  })

  it('separates moving from stopped and treats GPS jitter as stopped', () => {
    expect(toneFor(unit({ speedKph: 40 }))).toBe('moving')
    expect(toneFor(unit({ speedKph: 0 }))).toBe('stopped')
    expect(toneFor(unit({ speedKph: 2 }))).toBe('stopped')
    expect(toneFor(unit({ speedKph: null }))).toBe('stopped')
  })
})

describe('freshnessLabel', () => {
  it('reads the way a dispatcher would say it', () => {
    expect(freshnessLabel(3)).toBe('just now')
    expect(freshnessLabel(42)).toBe('42s ago')
    expect(freshnessLabel(240)).toBe('4m ago')
    expect(freshnessLabel(7300)).toBe('2h ago')
  })

  it('says never for a driver who has not reported, not a dash', () => {
    expect(freshnessLabel(null)).toBe('never')
  })

  it('does not render a clock-skewed device as a negative age', () => {
    expect(freshnessLabel(-4)).toBe('just now')
  })

  it('does not round 59 seconds up into a minute it has not reached', () => {
    expect(freshnessLabel(59)).toBe('59s ago')
  })
})

describe('speedLabel', () => {
  it('omits a speed the device never reported rather than printing zero', () => {
    expect(speedLabel(unit({ speedKph: null }))).toBeNull()
  })

  it('rounds to whole km/h', () => {
    expect(speedLabel(unit({ speedKph: 37.6 }))).toBe('38 km/h')
  })
})

describe('planMarkers', () => {
  it('adds what is new, updates what is already there, removes what has gone', () => {
    const plan = planMarkers(
      ['v:1', 'v:2'],
      [unit({ key: 'v:2' }), unit({ key: 'd:3' })],
    )

    expect(plan.add.map((u) => u.key)).toEqual(['d:3'])
    expect(plan.update.map((u) => u.key)).toEqual(['v:2'])
    expect(plan.remove).toEqual(['v:1'])
  })

  it('never plans a marker for a unit without a position', () => {
    const plan = planMarkers([], [unit({ key: 'd:9', latitude: null, longitude: null })])

    expect(plan.add).toEqual([])
  })

  it('removes the marker of a unit that lost its position', () => {
    // The server answering null coordinates has already said the last place
    // is not to be trusted; keeping the dot would contradict it.
    const plan = planMarkers(['d:9'], [unit({ key: 'd:9', latitude: null, longitude: null })])

    expect(plan.remove).toEqual(['d:9'])
  })

  it('clears the map when the last trip ends', () => {
    const plan = planMarkers(['v:1'], [])

    expect(plan).toEqual({ add: [], update: [], remove: ['v:1'] })
  })
})

describe('byAttention', () => {
  it('puts the unit nobody has heard from above the ones that are fine, and the pool last', () => {
    const stale = unit({ key: 'v:1', stale: true, ageSeconds: 900 })
    const moving = unit({ key: 'v:2', speedKph: 40 })
    const waiting = buildUnits([], [driver()])[0]

    const sorted = [waiting, moving, stale].sort(byAttention)

    expect(sorted.map((u) => u.key)).toEqual(['v:1', 'v:2', 'd:15'])
  })

  it('sorts never-reported above merely old inside the stale group', () => {
    const old = unit({ key: 'v:1', stale: true, ageSeconds: 900 })
    const never = unit({ key: 'd:2', stale: true, ageSeconds: null })

    expect([old, never].sort(byAttention).map((u) => u.key)).toEqual(['d:2', 'v:1'])
  })
})

describe('matchesFilter and matchesQuery', () => {
  it('filters by what a unit is doing', () => {
    const onTrip = unit()
    const waiting = buildUnits([], [driver()])[0]
    const dark = unit({ stale: true })

    expect(matchesFilter(onTrip, 'all')).toBe(true)
    expect(matchesFilter(onTrip, 'on_trip')).toBe(true)
    expect(matchesFilter(onTrip, 'waiting')).toBe(false)
    expect(matchesFilter(waiting, 'waiting')).toBe(true)
    expect(matchesFilter(dark, 'stale')).toBe(true)
  })

  it('finds a plate typed in a hurry, a name, a client and a trip number', () => {
    const u = unit()

    expect(matchesQuery(u, 'ubk421h')).toBe(true)
    expect(matchesQuery(u, 'grace')).toBe(true)
    expect(matchesQuery(u, 'centenary')).toBe(true)
    expect(matchesQuery(u, '#10')).toBe(true)
    expect(matchesQuery(u, 'noah')).toBe(true)
    expect(matchesQuery(u, 'zzz')).toBe(false)
    expect(matchesQuery(u, '')).toBe(true)
  })
})

describe('summarise', () => {
  it('counts what the header says', () => {
    const counts = summarise([
      unit({ key: 'v:1' }),
      unit({ key: 'v:2', stale: true }),
      buildUnits([], [driver()])[0],
    ])

    expect(counts).toEqual({ onTrip: 2, waiting: 1, stale: 1 })
  })
})
