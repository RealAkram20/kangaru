import { describe, expect, it } from 'vitest'
import { overlaySummary, pinTitle, routePins } from './routeOverlay'
import type { ClientRoute } from '../pages/routes/routeBuilder'

/**
 * The live map's planned-circuit layer (ADR-0045).
 *
 * The load-bearing assertions here are about what it leaves out: a retired
 * route, and a stop whose place was never loaded. Both would otherwise reach
 * the map — the first as a circuit nobody runs any more, the second as a
 * pin at 0°N 0°E, which is where ADR-0020 records a coordinate slip landing
 * a Kampala vehicle for real.
 */

function route(over: Partial<ClientRoute> = {}): ClientRoute {
  return {
    id: 1,
    name: 'Kampala Central ATM Run',
    reference: null,
    notes: null,
    is_active: true,
    stops: [
      {
        id: 11,
        sequence: 1,
        expected_dwell_minutes: null,
        driver_notes: null,
        place: {
          id: 101,
          name: 'Nakawa ATM',
          address: null,
          latitude: 0.33,
          longitude: 32.61,
          arrival_radius_m: null,
          notes: null,
          is_active: true,
        },
      },
    ],
    ...over,
  }
}

describe('routePins', () => {
  it('flattens a route into numbered site pins', () => {
    expect(routePins([route()])).toEqual([
      {
        key: 'route-1-stop-11',
        routeId: 1,
        routeName: 'Kampala Central ATM Run',
        sequence: 1,
        placeName: 'Nakawa ATM',
        latitude: 0.33,
        longitude: 32.61,
      },
    ])
  })

  it('leaves a retired route off the live map', () => {
    // A live map is about today. A circuit the client stopped running is
    // history, and drawing it would have a dispatcher looking for a crew
    // that is not coming.
    expect(routePins([route({ is_active: false })])).toEqual([])
  })

  it('drops a stop whose place was never loaded rather than pinning nowhere', () => {
    const bare = route({
      stops: [{ id: 12, sequence: 1, expected_dwell_minutes: null, driver_notes: null }],
    })

    expect(routePins([bare])).toEqual([])
  })

  it('keys pins so one place on two circuits is two pins', () => {
    const second = route({ id: 2, name: 'Northern run' })
    const keys = routePins([route(), second]).map((pin) => pin.key)

    expect(new Set(keys).size).toBe(2)
  })
})

describe('pinTitle', () => {
  it('names the circuit as well as the site', () => {
    // The same ATM sits on three runs; "Nakawa ATM" alone does not tell a
    // dispatcher whose crew they are looking at.
    expect(pinTitle(routePins([route()])[0])).toBe(
      'Kampala Central ATM Run · stop 1: Nakawa ATM',
    )
  })
})

describe('overlaySummary', () => {
  it('says nothing at all when the client has no routes, so no toggle appears', () => {
    expect(overlaySummary([])).toBeNull()
    expect(overlaySummary([route({ is_active: false })])).toBeNull()
  })

  it('counts circuits and sites, singular and plural written out', () => {
    expect(overlaySummary([route()])).toBe('1 route · 1 stop')
    expect(overlaySummary([route(), route({ id: 2 })])).toBe('2 routes · 2 stops')
  })
})
