import { useEffect, useRef, useState } from 'react'

import { Alert } from '../components/feedback/Alert'
import { apiClient } from '../lib/apiClient'
import { apiError } from '../lib/apiError'
import type { ApiSuccess } from '../types/api'
import type { Booking } from '../types/booking'
import type { Trip } from '../types/trip'
import { useDriverAnswer } from './useDriverAnswer'

/**
 * What became of the booking that was just raised.
 *
 * ## Why the desk needs it here and not only on the dispatch board
 *
 * The owner raised a booking from this page and reported *"nothing happens
 * next after clicking create booking… still the order did not reach the
 * driver."* Both halves were true. The booking was created and then stopped —
 * silently — at two gates it could not see: approval, and a dispatcher having
 * to pick a vehicle by hand. This panel is the screen saying what happened at
 * each of them.
 *
 * ## The four things it can say, and why none of them is a guess
 *
 * - **Dispatching.** The request is in flight.
 * - **Waiting.** A driver has the job on their name and has not answered.
 *   `assigned` is not `accepted`, and treating them alike is how a job nobody
 *   took looked exactly like one already being driven.
 * - **Accepted / declined.** The driver's own answer, polled by
 *   `useDriverAnswer`.
 * - **Nobody contracted is free.** The office's own refusal, shown verbatim.
 *   Automatic dispatch commits a *contracted* vehicle or nothing (owner's
 *   ruling), so this is the ordinary outcome when a client's own fleet is
 *   busy — not an error, and the job is in the queue for the desk.
 *
 * There is no fare and no ETA here. Neither exists until the trip is driven,
 * and `docs/screen-rules.md` §1 is the rule the last two would break.
 */
export function BookingDispatchNotice({
  booking,
  onDismiss,
}: {
  booking: Booking
  onDismiss: () => void
}) {
  const [trip, setTrip] = useState<Trip | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [asking, setAsking] = useState(true)
  /*
    Which booking has already been sent, so it is sent once.

    An effect that POSTs cannot rely on running once: StrictMode mounts,
    unmounts and remounts every component in development, and the cleanup
    below stops this one *writing state* without recalling a request
    already in flight. Dispatching is not idempotent — a second
    auto-assignment is a second offer, to a second driver, for one job.
    A ref rather than state because nothing renders from it and a
    re-render would be a re-run.
  */
  const sent = useRef<number | null>(null)

  useEffect(() => {
    if (sent.current === booking.id) {
      return
    }
    sent.current = booking.id

    /*
      The reply belongs to this booking only. There is deliberately no
      `stopped` flag cancelling it on unmount: StrictMode's remount would
      trip it, and the second run — seeing the ref — would not re-ask, so
      the panel would sit on "Finding a driver" for ever in development.
      The ref is the whole test: a newer booking has replaced it, and a
      stale answer must not speak for the new one.
    */
    const mine = () => sent.current === booking.id

    const dispatchIt = async () => {
      try {
        const response = await apiClient.post<ApiSuccess<Trip>>(
          `/bookings/${booking.id}/auto-assignment`,
        )

        if (mine()) {
          setTrip(response.data.data)
        }
      } catch (error) {
        if (mine()) {
          // The office's own sentence — it already distinguishes "nothing
          // contracted is free" from "automatic dispatch is switched off",
          // and rewriting either here would be a second vocabulary for one
          // refusal.
          setRefusal(
            apiError(
              error,
              'The office could not be reached, so this booking has not been sent to a driver.',
            ).message,
          )
        }
      } finally {
        if (mine()) {
          setAsking(false)
        }
      }
    }

    void dispatchIt()
  }, [booking.id])

  const answer = useDriverAnswer(trip)
  const route = `${booking.origin} → ${booking.destination}`

  if (asking) {
    return (
      <Alert tone="info" title="Finding a driver" onDismiss={onDismiss}>
        {route}
      </Alert>
    )
  }

  if (refusal !== null) {
    return (
      <Alert tone="warning" title="Not sent to a driver yet" onDismiss={onDismiss}>
        {refusal} {route} is on the dispatch board for somebody to place.
      </Alert>
    )
  }

  if (trip === null) {
    return null
  }

  const driver = trip.driver?.name ?? 'the assigned driver'
  const vehicle = trip.vehicle?.registration_number ?? 'the assigned vehicle'

  if (answer === 'declined') {
    return (
      <Alert tone="warning" title={`${driver} declined trip #${trip.id}`} onDismiss={onDismiss}>
        {route} still needs a vehicle. Assign somebody else from the dispatch board.
      </Alert>
    )
  }

  if (answer === 'accepted') {
    return (
      <Alert tone="success" title={`${driver} accepted trip #${trip.id}`} onDismiss={onDismiss}>
        {route}, in {vehicle}.
      </Alert>
    )
  }

  return (
    <Alert
      tone="info"
      title={`Waiting for ${driver} to accept trip #${trip.id}`}
      onDismiss={onDismiss}
    >
      {route}, in {vehicle}.
    </Alert>
  )
}
