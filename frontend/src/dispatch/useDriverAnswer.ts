import { useEffect, useState } from 'react'

import { apiClient } from '../lib/apiClient'
import type { ApiSuccess } from '../types/api'
import type { Trip } from '../types/trip'

/**
 * Whether the driver a booking was just dispatched to has answered yet.
 *
 * ## Why the desk needs this
 *
 * A dispatched booking is not a driven one. `assigned` means the office has
 * put the job on somebody's name; the driver still has to accept it, and they
 * may decline or simply never look. Until this existed the board said
 * *"Booking dispatched"* and then went quiet for ever — so a job nobody
 * accepted looked exactly like a job somebody was already driving, and the
 * desk found out when the client rang.
 *
 * ## Polled, and only while there is a question
 *
 * There is no push to a browser here, so the answer has to be asked for. It
 * stops the moment the driver answers, which is what keeps this from becoming
 * a request every five seconds for the rest of the shift: an accepted trip is
 * settled, and a declined one needs a person rather than another poll.
 *
 * Five seconds, matching the driver app's own offer poll. A dispatcher is
 * watching this while deciding whether to ring somebody, and a slower answer
 * would have them reaching for the phone about a job that was taken.
 *
 * ## Failure is silent on purpose
 *
 * A failed poll leaves the last known answer standing rather than replacing a
 * real state with an error. The dispatcher has the trip on the board either
 * way, and a red box over a question that will be answered on the next tick
 * would be the noisier lie.
 */
export type DriverAnswer = 'waiting' | 'accepted' | 'declined'

/** Every status past `assigned` except a refusal means they took it. */
export function answerFrom(status: Trip['status']): DriverAnswer {
  if (status === 'assigned') {
    return 'waiting'
  }

  return status === 'rejected' ? 'declined' : 'accepted'
}

const POLL_MS = 5000

export function useDriverAnswer(trip: Trip | null): DriverAnswer {
  /*
    **Derived, not synchronised.** An earlier version kept the answer in state
    and reset it from an effect whenever the trip changed, which is the
    `react-hooks/set-state-in-effect` the linter refuses — and it refuses it
    for a real reason: that shape renders once with the previous trip's answer
    before correcting itself, so a booking dispatched to a driver who had
    already accepted would flash "waiting" at the dispatcher.

    Only a *poll* writes state here, and it carries the trip it belongs to so
    a stale reply cannot answer for a newer job.
  */
  const [polled, setPolled] = useState<{ tripId: number; answer: DriverAnswer } | null>(null)

  const tripId = trip?.id ?? null
  const initial = trip === null ? 'waiting' : answerFrom(trip.status)
  const answer = polled !== null && polled.tripId === tripId ? polled.answer : initial

  useEffect(() => {
    if (tripId === null || initial !== 'waiting') {
      return
    }

    let stopped = false

    const ask = async () => {
      try {
        const response = await apiClient.get<ApiSuccess<Trip>>(`/trips/${tripId}`)
        // Axios wraps the response, and the API wraps the payload — so the
        // trip is two `data`s down, exactly as every other call on this page
        // reads it.
        const next = answerFrom(response.data.data.status)

        if (stopped) {
          return
        }

        setPolled({ tripId, answer: next })

        if (next !== 'waiting') {
          window.clearInterval(timer)
        }
      } catch {
        // See the docblock: the last known answer stands.
      }
    }

    const timer = window.setInterval(() => void ask(), POLL_MS)

    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [tripId, initial])

  return answer
}
