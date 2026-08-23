import { describe, expect, it } from 'vitest'
import {
  NO_FIGURE,
  canDraw,
  distanceLabel,
  draftStop,
  durationLabel,
  durationParts,
  placeIds,
  reorder,
  stopCountLabel,
  summaryLine,
  whyNoLine,
  type ClientPlace,
  type DraftStop,
  type DrawnRoute,
} from './routeBuilder'

/**
 * The builder's arithmetic (ADR-0045).
 *
 * Most of this file is about the em dash. A route builder that guessed a
 * distance would be believed — a transport officer would price a contract
 * against it — and the guess available here is the crow's flight, which
 * `OsrmProvider` records understating a real Kampala run by 39%.
 */

function place(id: number, name: string): ClientPlace {
  return {
    id,
    name,
    address: null,
    latitude: 0.31,
    longitude: 32.58,
    arrival_radius_m: null,
    notes: null,
    is_active: true,
  }
}

function stops(...names: string[]): DraftStop[] {
  return names.map((name, index) => draftStop(place(index + 1, name)))
}

const DRAWN: DrawnRoute = {
  polyline: 'yz~vAqf~kG',
  distance_km: 34.24,
  duration_seconds: 6600,
  provider: 'osrm',
  is_estimate: true,
}

describe('reorder', () => {
  it('moves a stop to a new position without disturbing the rest', () => {
    expect(reorder(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(reorder(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('returns the very same list when nothing moved, so React can skip the render', () => {
    const list = ['a', 'b']

    expect(reorder(list, 1, 1)).toBe(list)
  })

  it('treats an out-of-range drop as a cancelled drag rather than an error', () => {
    const list = ['a', 'b']

    // A drop outside the rail. Throwing here would take the screen down for
    // a gesture the officer has already decided against.
    expect(reorder(list, 0, 5)).toBe(list)
    expect(reorder(list, -1, 0)).toBe(list)
  })
})

describe('the figures it will not invent', () => {
  it('renders an em dash for distance when nothing was drawn', () => {
    expect(distanceLabel(null)).toBe(NO_FIGURE)
  })

  it('states a drawn distance to one decimal', () => {
    expect(distanceLabel(DRAWN)).toBe('34.2 km')
  })

  it('renders an em dash for a duration the provider did not supply', () => {
    // ADR-0031 §6: a distance is measured, minutes are predicted, and one
    // does not become the other by division.
    expect(durationLabel({ ...DRAWN, duration_seconds: null })).toBe(NO_FIGURE)
  })

  it('splits the qualifier off for a panel without detaching it from the figure', () => {
    // The screenshot fix: "estimate" rendered at KPI size shouted louder
    // than the number it qualifies. It still ships with the figure — as a
    // caption under it rather than as part of it.
    expect(durationParts(DRAWN)).toEqual({ value: '1 h 50 min', note: 'estimate' })
    expect(durationParts(null)).toEqual({ value: NO_FIGURE, note: null })
    expect(durationParts({ ...DRAWN, duration_seconds: null })).toEqual({
      value: NO_FIGURE,
      note: null,
    })
  })

  it('always says the driving time is an estimate', () => {
    expect(durationLabel(DRAWN)).toBe('1 h 50 min estimate')
    expect(durationLabel({ ...DRAWN, duration_seconds: 1500 })).toBe('25 min estimate')
    expect(durationLabel({ ...DRAWN, duration_seconds: 7200 })).toBe('2 h estimate')
  })
})

describe('whyNoLine', () => {
  it('says nothing when there is a line to look at', () => {
    expect(whyNoLine(stops('a', 'b'), false, DRAWN)).toBeNull()
  })

  it('says it is measuring while the request is in flight', () => {
    expect(whyNoLine(stops('a', 'b'), true, null)).toBe('Measuring the route…')
  })

  it('asks for a second stop rather than blaming the mapping service', () => {
    expect(whyNoLine(stops('a'), false, null)).toContain('Add a second stop')
  })

  it('says the stops are still saved when the mapping service declined', () => {
    // The distinction that matters to somebody staring at a dash: their work
    // is not lost, only the drawn line is missing.
    expect(whyNoLine(stops('a', 'b'), false, null)).toContain('The stops are saved')
  })
})

describe('summaryLine', () => {
  it('reads as stops alone when no line was drawn, with no orphan separators', () => {
    // "7 stops · — · —" is the shape this test exists to prevent.
    expect(summaryLine(stops('a', 'b'), null)).toBe('2 stops')
  })

  it('adds the distance and the time once they exist', () => {
    expect(summaryLine(stops('a', 'b'), DRAWN)).toBe('2 stops · 34.2 km · 1 h 50 min estimate')
  })

  it('leaves out a duration the provider withheld, keeping the distance', () => {
    expect(summaryLine(stops('a', 'b'), { ...DRAWN, duration_seconds: null })).toBe(
      '2 stops · 34.2 km',
    )
  })
})

describe('stopCountLabel', () => {
  it('is a whole sentence per case rather than a stem plus an "s"', () => {
    // Written out so a translator gets one string per plural form instead of
    // English pluralisation baked into the layout (PRODUCT.md, i18n-safe).
    expect(stopCountLabel(0)).toBe('No stops yet')
    expect(stopCountLabel(1)).toBe('1 stop')
    expect(stopCountLabel(7)).toBe('7 stops')
  })
})

describe('the draft', () => {
  it('gives one place visited twice two distinct keys', () => {
    // Head office at both ends of a cash run. Keying the rail by place id
    // would give React duplicate keys and leave the second undraggable.
    const office = place(1, 'Head Office')
    const draft = [draftStop(office), draftStop(place(2, 'ATM')), draftStop(office)]

    expect(new Set(draft.map((stop) => stop.key)).size).toBe(3)
    expect(placeIds(draft)).toEqual([1, 2, 1])
  })

  it('will not draw a journey of fewer than two stops', () => {
    expect(canDraw(stops())).toBe(false)
    expect(canDraw(stops('a'))).toBe(false)
    expect(canDraw(stops('a', 'b'))).toBe(true)
  })
})
