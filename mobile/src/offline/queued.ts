import type { TripStatus } from '../api/types';
import type { OutboxItem } from './outboxTypes';

/**
 * What each trip has been *asked* to become, and has not yet been confirmed at.
 *
 * ## Why this exists
 *
 * `queueTransition` writes to the outbox and to nothing else — not to the query
 * cache — and `sync()` invalidates only after a *completed* drain. So a screen
 * that queues a transition and stays put reads a `trip.status` that is still the
 * old one: `PickupScreen` went on offering "On my way" after it was pressed, and
 * `TripInProgressScreen` went on offering "Pause trip". On a good connection
 * that is a flicker. In the stairwell and the basement car park those screens
 * are written for, it lasts as long as the dead zone.
 *
 * A driver presses again — which is what anybody does when a button appears to
 * have done nothing — and the second item posts from a status the server has
 * already left. It is refused, and the outbox parks it. That is a queue item
 * needing a human, earned by pressing the only control on screen.
 *
 * ## Why it reads the outbox instead of faking the status
 *
 * The obvious repair is an optimistic write into the query cache. It lies: when
 * an item is refused, `onParked` does not invalidate anything, so the invented
 * status would sit in the cache with nothing to correct it until some unrelated
 * refetch happened by.
 *
 * This map cannot fail that way. It holds only transitions the driver actually
 * requested, it drops them when they go out, and a parked item is no longer
 * `pending` — so the screen falls back to the server's own status, with the
 * parked banner already saying why.
 *
 * ## Last intent wins
 *
 * `OutboxStore.all()` orders by `sequence`, and items for one trip share a
 * stream and drain strictly in order (ADR-0023 §5). So a trip carrying a pause
 * *and* a resume maps to the resume: the state it will actually arrive at, not
 * the one it will pass through. Callers must pass items in that order — this
 * function does not re-sort, because a sort here would be a second opinion
 * about ordering that the outbox already owns.
 *
 * Items with no trip (an availability request) or no target status are skipped
 * rather than defaulted; both are legitimately null on the shared item shape.
 */
export function queuedStatuses(items: readonly OutboxItem[]): Map<number, TripStatus> {
  const queued = new Map<number, TripStatus>();

  for (const item of items) {
    if (item.state !== 'pending' || item.tripId === null || item.targetStatus === null) {
      continue;
    }

    queued.set(item.tripId, item.targetStatus);
  }

  return queued;
}
