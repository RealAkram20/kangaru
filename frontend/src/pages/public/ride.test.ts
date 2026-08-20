import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { simulatedRideSource, type RidePhase, type RideState } from './ride'

/**
 * Runs one reference for `ms` and hands back every state it emitted. The
 * default stops just after the match, before the captain sets off — most
 * cases here are about the matching half.
 */
function play(reference: string, ms = 5000): RideState[] {
  const states: RideState[] = []
  const stop = simulatedRideSource(reference, [32.5825, 0.3476]).subscribe((s) => states.push(s))
  vi.advanceTimersByTime(ms)
  stop()
  return states
}

/** Long enough to run the whole ride out to the fare. */
const WHOLE_RIDE_MS = 45_000

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('simulatedRideSource', () => {
  it('walks the whole ride in the order a passenger lives it', () => {
    const phases = play('KR-7XKPQ2', WHOLE_RIDE_MS).map((s) => s.phase)
    const firstIndexOf = (p: RidePhase) => phases.indexOf(p)

    // Each stage starts strictly after the one before. Asserting the order
    // rather than exact timings keeps this from breaking every time the
    // simulated durations are tuned.
    const order: RidePhase[] = [
      'searching',
      'accepted',
      'driver_en_route',
      'driver_arrived',
      'passenger_onboard',
      'trip_completed',
    ]
    for (const phase of order) expect(phases, phase).toContain(phase)
    for (let i = 1; i < order.length; i += 1) {
      expect(firstIndexOf(order[i]), order[i]).toBeGreaterThan(firstIndexOf(order[i - 1]))
    }
  })

  it('produces a fare only once the trip is over, in whole shillings', () => {
    const states = play('KR-7XKPQ2', WHOLE_RIDE_MS)

    for (const state of states) {
      if (state.phase !== 'trip_completed') expect(state.fare).toBeNull()
    }

    const fare = states.at(-1)!.fare!
    const lines = fare.breakdown!
    expect(fare.total).toBe(Math.round(fare.total))
    expect(fare.total).toBeGreaterThan(lines.base)
    // UGX is zero-decimal: a fare with a fraction of a shilling in it is a
    // float that has been let near money.
    for (const amount of [lines.base, lines.distance, lines.time, fare.total]) {
      expect(Number.isInteger(amount)).toBe(true)
    }
  })

  it('stops the ride dead when it is cancelled', () => {
    const states: RideState[] = []
    const source = simulatedRideSource('KR-7XKPQ2', [32.5825, 0.3476])
    const stop = source.subscribe((s) => states.push(s))

    vi.advanceTimersByTime(5000)
    source.cancel('I found another ride')
    const afterCancel = states.length
    vi.advanceTimersByTime(WHOLE_RIDE_MS)
    stop()

    expect(states.at(-1)!.phase).toBe('cancelled')
    expect(states.at(-1)!.cancelledReason).toBe('I found another ride')
    // Nothing may keep ticking behind a cancelled ride.
    expect(states).toHaveLength(afterCancel)
  })

  it('finds a captain without ever showing an offer limbo', () => {
    const phases = play('KR-7XKPQ2').map((s) => s.phase)

    expect(phases[0]).toBe('searching')
    expect(phases.at(-1)).toBe('accepted')
    // Automatic dispatch: the accept happens between the system and the
    // captain. Showing the customer a state they cannot affect, and that
    // resolves on its own, is a loading screen wearing a costume.
    expect(phases).not.toContain('offered')
  })

  it('never walks the progress rail backwards', () => {
    const progress = play('KR-7XKPQ2').map((s) => s.progress)

    for (let i = 1; i < progress.length; i += 1) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1])
    }
  })

  it('emits no captain before one is found', () => {
    for (const state of play('KR-7XKPQ2')) {
      if (state.phase === 'searching') expect(state.captain).toBeNull()
      else expect(state.captain).not.toBeNull()
    }
  })

  /**
   * The guard for the signed-shift bug: `seedFrom` fills all 32 bits, so
   * references whose hash exceeds 2^31 used to produce negative array
   * indices and character codes below 'A'. One reference cannot catch that
   * — it takes a spread wide enough to cross the boundary.
   */
  it('builds a well-formed captain for every reference, not just small hashes', () => {
    const references = Array.from({ length: 400 }, (_, i) => `KR-${i.toString(36).toUpperCase()}Z${i}`)

    for (const reference of references) {
      const captain = play(reference).at(-1)!.captain!

      expect(captain.plate, reference).toMatch(/^U[A-Z]{2} \d{3}[A-Z]$/)
      expect(captain.name, reference).not.toBe(undefined)
      expect(captain.rating, reference).toBeGreaterThanOrEqual(4.4)
      expect(captain.rating, reference).toBeLessThanOrEqual(5)
      expect(captain.distanceKm, reference).toBeGreaterThan(0)
      expect(captain.etaMinutes, reference).toBeGreaterThanOrEqual(1)
    }
  })

  /**
   * React StrictMode mounts, cleans up, and mounts again in development.
   * A source that treats the first cleanup as final goes dead on the
   * second subscribe, and the screen never leaves its initial state — which
   * is exactly what happened in the browser while every test here passed.
   */
  it('survives being unsubscribed and subscribed again', () => {
    const source = simulatedRideSource('KR-7XKPQ2', [32.5825, 0.3476])

    source.subscribe(() => {})()

    const states: RideState[] = []
    const stop = source.subscribe((s) => states.push(s))
    vi.advanceTimersByTime(5000)
    stop()

    expect(states.map((s) => s.phase)).toContain('accepted')
  })

  it('stops emitting once unsubscribed', () => {
    const states: RideState[] = []
    const stop = simulatedRideSource('KR-7XKPQ2', null).subscribe((s) => states.push(s))
    const seen = states.length
    stop()
    vi.advanceTimersByTime(9000)

    expect(states).toHaveLength(seen)
  })
})
