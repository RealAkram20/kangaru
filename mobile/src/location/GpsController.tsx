import { useEffect } from 'react';

import { useSync } from '../offline/SyncProvider';
import { useTrips } from '../trips/queries';
import { streamingTripId } from '../trips/transitions';

/**
 * Starts and stops GPS from the trip list, not from a screen.
 *
 * Mounted once inside the authenticated shell and renders nothing. Tying this
 * to the trip-detail screen — the obvious place — would mean a driver who
 * force-quits mid-trip and reopens the app on another tab records no route at
 * all, and they would have no way of knowing: the route is the evidence the
 * odometer reading is reconciled against, and its absence only shows up on a
 * report weeks later.
 *
 * The driver never starts or stops tracking by hand. There is no button
 * because there is no decision: the trip's status already says whether the
 * vehicle is carrying a passenger.
 */
export function GpsController() {
  const { trips } = useTrips();
  const { gps } = useSync();

  const tripId = streamingTripId(trips);

  useEffect(() => {
    if (gps === null) {
      return;
    }

    if (tripId === null) {
      if (gps.activeTripId() !== null) {
        void gps.stop();
      }

      return;
    }

    void gps.start(tripId);
  }, [tripId, gps]);

  return null;
}
