import { describe, expect, it } from 'vitest'
import { decodePolyline, looksLikeUganda } from './polyline'

/**
 * The shared decoder (ADR-0045 §7).
 *
 * The reference vector is Google's own documented example, so this pins the
 * implementation against the specification rather than against itself.
 */
describe('decodePolyline', () => {
  it("decodes Google's own documented example", () => {
    // `_p~iF~ps|U_ulLnnqC_mqNvxq`@` -> (38.5, -120.2), (40.7, -120.95),
    // (43.252, -126.453). Emitted in GeoJSON order, so longitude first.
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ])
  })

  it('reads an empty string as no line rather than throwing', () => {
    expect(decodePolyline('')).toEqual([])
  })

  it('stops at a truncated varint instead of emitting a displaced point', () => {
    // Every point after a half-read delta would be wrong by that delta, so
    // the honest answer is the points that were fully read.
    const full = decodePolyline('_p~iF~ps|U_ulLnnqC')
    const truncated = decodePolyline('_p~iF~ps|U_ulL')

    expect(full).toHaveLength(2)
    expect(truncated).toEqual([full[0]])
  })

  it('round-trips a Kampala line into Kampala coordinates', () => {
    // Nothing here is more important than this: a decoder that is subtly
    // wrong produces a well-formed line in the wrong hemisphere, and a
    // dispatcher would see an empty map rather than an error.
    //
    // The fixture is the encoding of two real points — Acacia Mall and
    // Nakawa — rather than a string typed by hand. An invented one passed
    // the decoder and failed this assertion, which is the test doing its
    // job on its own author.
    const points = decodePolyline('_}`A_d|eEnn@opD')

    expect(points).toEqual([
      [32.5896, 0.3376],
      [32.618, 0.33],
    ])
    expect(looksLikeUganda(points)).toBe(true)
  })
})

describe('looksLikeUganda', () => {
  it('accepts a Kampala line', () => {
    expect(looksLikeUganda([[32.58, 0.31], [32.61, 0.33]])).toBe(true)
  })

  it('rejects the Atlantic off Ghana, which is where a coordinate slip lands', () => {
    // ADR-0020's consequences record this exact position for a real
    // latitude/longitude swap.
    expect(looksLikeUganda([[0, 0]])).toBe(false)
  })

  it('rejects a line decoded at the wrong precision', () => {
    // Precision-6 data read at precision 5 is ten times too large: perfectly
    // well-formed numbers, nowhere near a road.
    expect(looksLikeUganda([[325.8, 3.1]])).toBe(false)
  })

  it('rejects an empty line rather than calling it plausible', () => {
    expect(looksLikeUganda([])).toBe(false)
  })

  it('still accepts a neighbouring country, so expansion is not silently refused', () => {
    // Nairobi. The bounds ask "right continent", not "right city".
    expect(looksLikeUganda([[36.82, -1.29]])).toBe(true)
  })
})
