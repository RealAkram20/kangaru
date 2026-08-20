import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootDrawerParams } from './types';

/**
 * A handle on the navigator for the two things that live *outside* it.
 *
 * `OfferPresenter` is painted over the whole app rather than pushed into a
 * stack — a job with a countdown on it has to appear over whatever the
 * driver is doing — so it has no `navigation` prop and `useNavigation()`
 * throws for it. When the driver says yes, though, the next screen is not in
 * doubt: it is the pickup, and leaving them on whatever they were looking at
 * with the job tucked behind the home card was one more tap on the way to
 * the passenger. This is how the overlay gets them there.
 */
export const navigationRef = createNavigationContainerRef<RootDrawerParams>();

/**
 * Opens the pickup screen for a trip, wherever the driver is.
 *
 * Nested three deep — drawer → tabs → trips stack — which is the shape the
 * drawer already navigates by (`DrawerContent`). Silently a no-op before the
 * container is ready; the accept has still happened, and the home card
 * carries the trip as it always did.
 */
export function openPickup(tripId: number): void {
  if (!navigationRef.isReady()) {
    return;
  }

  navigationRef.navigate('Main', {
    screen: 'Home',
    params: { screen: 'Pickup', params: { tripId } },
  } as never);
}

/**
 * Opens a trip's record, for a push the driver tapped (ADR-0046 §4).
 *
 * The second caller from outside the navigator, and the reason this file
 * stopped being about one overlay: `PushRouter` runs in an effect on a
 * notification response, which on a cold start happens while the container is
 * still mounting.
 *
 * **`TripDetail`, not `Pickup`.** A `trip.assigned` push is a dispatcher
 * putting work on the driver's list, which is often for later today — the
 * question it raises is "what is this job", and that is what `TripDetail`
 * answers. `Pickup` is the screen for a leg already being driven, and sending
 * a driver there for tomorrow morning's booking would start a journey nobody
 * asked them to start.
 *
 * Silently a no-op before the container is ready. The invalidation that
 * accompanies it has still happened, so the trip is on the list either way —
 * which is the same trade `openPickup` makes.
 */
export function openTrip(tripId: number): void {
  if (!navigationRef.isReady()) {
    return;
  }

  navigationRef.navigate('Main', {
    screen: 'Home',
    params: { screen: 'TripDetail', params: { tripId } },
  } as never);
}
