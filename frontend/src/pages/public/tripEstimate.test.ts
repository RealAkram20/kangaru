import { describe, expect, it } from 'vitest'
import { formatKm, formatMinutes, tripEstimate } from './tripEstimate'

/** Seeta and Acacia Mall — the trip the summary screen was drawn against. */
const SEETA: [number, number] = [32.7167, 0.3667]
const ACACIA: [number, number] = [32.5896, 0.3372]

describe('tripEstimate', () => {
  it('measures a known Kampala trip within a few hundred metres', () => {
    const estimate = tripEstimate(SEETA, ACACIA)!
    // ~14.5 km straight line, ~19.6 km by road.
    expect(estimate.km).toBeGreaterThan(19)
    expect(estimate.km).toBeLessThan(20)
    expect(estimate.minutes).toBe(59)
  })

  it('says nothing rather than inventing a distance for an un-geocoded end', () => {
    expect(tripEstimate(SEETA, null)).toBeNull()
    expect(tripEstimate(null, ACACIA)).toBeNull()
  })

  it('never quotes zero minutes for two points on the same street', () => {
    const estimate = tripEstimate(SEETA, [SEETA[0] + 0.0001, SEETA[1]])!
    expect(estimate.km).toBe(0)
    expect(estimate.minutes).toBe(1)
  })

  it('formats a distance to one decimal and a duration in words', () => {
    expect(formatKm(4.6)).toBe('4.6 km')
    expect(formatKm(12)).toBe('12.0 km')
    expect(formatMinutes(15)).toBe('15 min')
    expect(formatMinutes(60)).toBe('1 hr')
    expect(formatMinutes(80)).toBe('1 hr 20 min')
  })
})
