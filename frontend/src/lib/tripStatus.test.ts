import { describe, expect, it } from 'vitest'
import { recordVerdict } from './tripStatus'

/**
 * The verdict a client reads on a trip's mileage record. It only names what
 * the server stored — `distance_variance_flagged` is the platform's own
 * reconciliation (ADR-0016) — so these pin the naming, not the arithmetic.
 */
describe('recordVerdict', () => {
  const finished = {
    status: 'closed' as const,
    odometer_start: 53484,
    odometer_end: 53720,
    gps_distance_km: '235.10',
    distance_variance_flagged: false,
  }

  it('is verified when both readings exist and the GPS trace agrees', () => {
    expect(recordVerdict(finished)).toBe('verified')
  })

  it('is "check" when the platform flagged the variance — never hidden', () => {
    expect(recordVerdict({ ...finished, distance_variance_flagged: true })).toBe('check')
  })

  it('is unverified when there was no GPS trace to check against', () => {
    expect(recordVerdict({ ...finished, gps_distance_km: null })).toBe('unverified')
  })

  it('is incomplete when a reading is missing, whatever the flag says', () => {
    expect(recordVerdict({ ...finished, odometer_end: null })).toBe('incomplete')
    expect(recordVerdict({ ...finished, odometer_start: null, distance_variance_flagged: true })).toBe('incomplete')
  })

  it('has nothing to say before the trip has finished', () => {
    for (const status of ['assigned', 'accepted', 'trip_started', 'waiting', 'cancelled'] as const) {
      expect(recordVerdict({ ...finished, status })).toBeNull()
    }
    for (const status of ['trip_completed', 'invoice_generated', 'closed'] as const) {
      expect(recordVerdict({ ...finished, status })).toBe('verified')
    }
  })
})
