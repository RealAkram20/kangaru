import { describe, expect, it } from 'vitest'

import { answerFrom } from './useDriverAnswer'

/**
 * Whether the driver has answered a booking the desk dispatched.
 *
 * The mapping is the part worth pinning. `assigned` is the office putting a
 * job on somebody's name and nothing more — the driver has still to accept —
 * so reading it as "dispatched, done" is what let a job nobody took look
 * exactly like a job already being driven. Everything past it except a
 * refusal means they took it.
 */
describe('answerFrom', () => {
  it('waits while the job sits unanswered on the driver', () => {
    expect(answerFrom('assigned')).toBe('waiting')
  })

  it('reads a refusal as a refusal, because it is the one the desk must act on', () => {
    expect(answerFrom('rejected')).toBe('declined')
  })

  it('treats every status past assigned as taken', () => {
    // A driver who accepted and drove off is not still deciding. The board
    // must not keep saying "waiting" over a passenger already aboard, which
    // is what a whitelist of one status would have done.
    for (const status of [
      'accepted',
      'driver_en_route',
      'driver_arrived',
      'passenger_onboard',
      'trip_started',
      'trip_completed',
    ] as const) {
      expect(answerFrom(status)).toBe('accepted')
    }
  })
})
