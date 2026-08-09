import * as Location from 'expo-location';
import { useEffect, useRef } from 'react';

import { sendPresence } from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';
import { isApiError } from '../api/errors';
import { useDuty } from './queries';

/**
 * Tells the platform where an on-duty driver is (ADR-0024 §2).
 *
 * Mounted once inside the authenticated shell and renders nothing — the same
 * shape as `GpsController`, and for the same reason it gives: tying this to a
 * screen would mean a driver who signs on and switches to the Time-off tab
 * stops being findable, and they would have no way of knowing. The symptom is
 * "the app says I'm online but I never get jobs", which is the worst kind of
 * bug to have in the field because nothing appears broken.
 *
 * ## Why this is not the GPS streamer
 *
 * `GpsStreamer` exists and already has a permission, a buffer and a durable
 * queue. Reusing it was the obvious move and would have been wrong on every
 * axis that matters:
 *
 * - **Different question.** That stream is billing evidence, sampled finely
 *   for a route and reconciled against the odometer. This is a dispatch
 *   radius, sampled coarsely for a ranking.
 * - **Different window.** `shouldStreamGps` deliberately starts at
 *   `trip_started` so the drive to the pickup is not added to one side of a
 *   distance comparison. Presence runs when there is *no* trip at all.
 * - **Different durability.** Those pings must never be lost, so they queue.
 *   These must never be replayed: a backlog of positions from a tunnel
 *   describes where the driver was, and dispatching against it sends a
 *   passenger a car that has driven on.
 *
 * So this fetches one fresh point on a timer and posts it, and drops it on the
 * floor if that fails. The next tick is a better answer than a retry.
 */
export function PresenceController() {
  const { api } = useAuth();
  const { data: duty } = useDuty();

  const onDuty = duty?.on_duty ?? false;
  const vehicleId = duty?.vehicle_id ?? null;
  const heartbeatSeconds = duty?.heartbeat_seconds ?? 60;

  // Held in a ref so a change of vehicle does not restart the timer
  // mid-interval. Without this, a duty refetch every fifteen seconds would
  // reset a sixty-second timer forever and no heartbeat would ever be sent —
  // a failure that looks exactly like the server ignoring the driver.
  //
  // Written in an effect rather than during render: a ref assigned in the
  // render body is invisible to the React Compiler, which then cannot
  // memoise this component at all.
  const vehicleRef = useRef<number | null>(vehicleId);

  useEffect(() => {
    vehicleRef.current = vehicleId;
  }, [vehicleId]);

  useEffect(() => {
    if (!onDuty) {
      return;
    }

    let cancelled = false;

    const report = async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();

        // Never prompts from here. A permission dialog appearing out of a
        // background timer, minutes after the driver last touched the app, is
        // a dialog nobody can connect to anything they did. The duty screen
        // asks when they sign on, which is the moment it makes sense.
        //
        // Refused permission is not an error and not a reason to sign the
        // driver off: the server keeps them dispatchable without coordinates
        // and simply ranks them without distance (ADR-0024 §2). Dropping them
        // here would be a silent per-driver outage.
        if (!permission.granted) {
          return;
        }

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (cancelled) {
          return;
        }

        await sendPresence(api, {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMetres: position.coords.accuracy ?? null,
          // The device's clock, matching the field's contract. The server
          // judges staleness against this, so sending a server-side "now"
          // would make every ping look fresh at the moment it arrived —
          // exactly the lie the field exists to prevent.
          recordedAt: new Date(position.timestamp).toISOString(),
          vehicleId: vehicleRef.current,
        });
      } catch (error) {
        // Swallowed on purpose, and the two interesting cases are the same
        // one: 409 NOT_ON_DUTY means the server and this app disagree about
        // whether a shift is running, and the `useDuty` poll is what settles
        // that — retrying here would just argue with it. Anything else is a
        // dead zone, where the next tick is a better answer than a retry of a
        // position that is already out of date.
        if (isApiError(error) && error.code !== 'NOT_ON_DUTY') {
          // Deliberately quiet. A driver cannot act on this, and a visible
          // error every sixty seconds in poor coverage is an app they stop
          // trusting. Duty state itself is shown on the Work screen, from the
          // server's own `dispatchable`.
        }
      }
    };

    // Immediately, then on the server's cadence. Without the first call a
    // driver who signs on has no position for a full interval, which is a
    // minute of being in the pool but unrankable — and the ride they would
    // have got goes to somebody further away.
    void report();

    const timer = setInterval(() => void report(), heartbeatSeconds * 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, onDuty, heartbeatSeconds]);

  return null;
}