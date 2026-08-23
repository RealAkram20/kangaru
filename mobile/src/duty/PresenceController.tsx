import * as Sentry from '@sentry/react-native';
import { useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useEffect, useRef } from 'react';

import { sendPresence, setDuty } from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';
import { isApiError } from '../api/errors';
import { forgetShift, rememberShift } from './dutyStore';
import { shouldEndShiftOnLaunch } from './launchState';
import { goOffline, serviceIsRunning } from './OnlineService';
import { reportPresence } from './presence';
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
 *
 * ## This is now the *foreground* half only (ADR-0046)
 *
 * A `setInterval` in a React component is throttled by Android within minutes
 * of the app leaving the screen and stops altogether when the process is
 * trimmed. Against a 180-second `presence_ttl_seconds` that meant **a driver
 * whose phone went into their pocket left the dispatch pool three minutes
 * later, with their screen still reading "You are online"** — the failure
 * `DutyBar`'s docblock calls the worst this feature can have, and it was live
 * until `PresenceTask` was added.
 *
 * That task, driven by the OS behind a foreground service, is the half that
 * carries a shift. This one still earns its place: it fires the *first* ping
 * immediately on signing on, at a finer cadence than the OS will honour in the
 * background, and — the part the task cannot do — it writes the server's
 * answer into the query cache so the duty bar stops lying about a stale fix.
 *
 * Both run `reportPresence`, and neither owns a second copy of it.
 */
export function PresenceController() {
  const { api } = useAuth();
  const { data: duty } = useDuty();
  const queryClient = useQueryClient();

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

  /**
   * **Ends a shift this handset is not actually doing** (ADR-0024 §2).
   *
   * Duty lives on the server, so it survives a reboot, a force-stop and every
   * ordinary process death — but `Location.startLocationUpdatesAsync` does not.
   * It runs when a driver *taps* Go Online and at no other time. So after a
   * cold start the server said "on duty", the bar read **"You are online"**,
   * and there was no foreground service, no heartbeat, and no driver in the
   * dispatch pool `presence_ttl_seconds` later.
   *
   * Observed, not theorised: the demo driver sat at `on_duty = 1` with a
   * position four and a half hours old while the app showed them working.
   *
   * The rule is `launchState.ts`'s, and it is deliberately "go offline" rather
   * than "restart the service" — starting a wake lock and position reporting on
   * the app's own initiative, after a reboot the driver did not ask for, is how
   * an app earns a force-stop. **Asked once per process**, because the duty
   * query polls and this must not fight a driver who taps Go Online a second
   * later.
   */
  const reconciled = useRef(false);

  useEffect(() => {
    if (duty === undefined || reconciled.current) {
      return;
    }

    reconciled.current = true;

    void (async () => {
      if (!shouldEndShiftOnLaunch({ serverSaysOnDuty: duty.on_duty, serviceRunning: await serviceIsRunning() })) {
        return;
      }

      Sentry.logger.warn('Ended a shift no service was running for', {
        vehicleId: duty.vehicle_id ?? 0,
      });

      // Both halves, and in this order. The server is the authority on duty, so
      // it is told first; `goOffline` then clears the local record the
      // background task reads. A failure to reach the office leaves the shift
      // open server-side, which the platform's own stale sweep closes.
      try {
        await setDuty(api, { onDuty: false, vehicleId: duty.vehicle_id });
      } catch {
        // A dead zone at launch. The local half still runs below, so nothing
        // here starts pinging for a shift the app is not doing.
      }

      await goOffline();
      await queryClient.invalidateQueries({ queryKey: ['duty'] });
    })();
  }, [duty, api, queryClient]);

  // **Mirrors the server's duty record to storage for the background task.**
  //
  // `useDutyToggle` writes it at the moment of signing on, which covers the
  // ordinary case, but not the ones that change a live shift without anybody
  // touching the toggle: a dispatcher moving the driver to another vehicle,
  // an operator retuning `presence_heartbeat_seconds`, or a shift the server
  // ended on its own. The task cannot read a query cache, so without this it
  // would keep naming a vehicle the driver handed back hours ago.
  //
  // Separate from the heartbeat effect below because it must also run when
  // `onDuty` is false — that is precisely the transition worth recording.
  useEffect(() => {
    if (duty === undefined) {
      return;
    }

    void (duty.on_duty
      ? rememberShift({
          onDuty: true,
          vehicleId: duty.vehicle_id,
          heartbeatSeconds: duty.heartbeat_seconds,
        })
      : forgetShift());
  }, [duty]);

  useEffect(() => {
    if (!onDuty) {
      return;
    }

    let cancelled = false;

    const report = async () => {
      // **The same `reportPresence` the background task runs**, over ports
      // that reach `expo-location` and the API client. The two paths answer
      // the same question and must not answer it differently — see `presence.ts`
      // for why that was extracted, and note that the half which would have
      // drifted first is the one nobody can watch.
      const outcome = await reportPresence(
        {
          // Never prompts from here. A permission dialog appearing out of a
          // timer, minutes after the driver last touched the app, is a dialog
          // nobody can connect to anything they did. `useDutyToggle` asks
          // when they sign on, which is the moment it makes sense.
          hasPermission: async () => (await Location.getForegroundPermissionsAsync()).granted,
          getFix: async () => {
            /*
              **Null, never a rejection.** The port's type is
              `Promise<PresenceFix | null>` and `reportPresence` awaits it
              outside any `try`, because "no fix" is not an error there — it
              has a `no_fix` outcome for it, documented as "a basement".

              `getCurrentPositionAsync` does not share that view: it *throws*
              when there is no position, and on Android that includes the
              ordinary cases this heartbeat is built for — indoors, a tunnel,
              location switched off mid-shift. The rejection travelled out of
              `reportPresence`, out of `report()`, and landed as an unhandled
              promise rejection: a red error card in front of a driver, every
              sixty seconds, saying "Current location is unavailable".

              Seen on the emulator, which has no fix until one is injected —
              but the handset case is the real one, and it is the case the
              surrounding comment already calls ordinary and silent.
            */
            try {
              const position = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
              });

              return {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracyMetres: position.coords.accuracy ?? null,
                timestamp: position.timestamp,
              };
            } catch {
              return null;
            }
          },
          send: (input) => sendPresence(api, input),
          isNotOnDuty: (error) => isApiError(error) && error.code === 'NOT_ON_DUTY',
        },
        vehicleRef.current,
      );

      if (cancelled || outcome.kind !== 'sent') {
        // Every other ending is ordinary and deliberately silent: a refused
        // permission is not an error (ADR-0024 §2 ranks the driver without
        // distance), a missing fix is a basement, and a 409 is the server
        // correcting this app — which `useDuty` settles, so retrying here
        // would only argue with it. A visible error every sixty seconds in
        // poor coverage is an app a driver stops trusting.
        return;
      }

      // The heartbeat's answer *is* the duty record — the same resource
      // `useDuty` reads, with `dispatchable` recomputed against the
      // position just sent. Write it into the cache, as `useSetDuty` does
      // with its own answer, rather than leaving the Work screen on
      // whatever `useDuty` last fetched.
      //
      // Without this the "Waiting for a location fix" warning outlives the
      // condition it describes: `useDuty` has no poll, so a driver whose
      // position went stale — app backgrounded, slow fix indoors, a dead
      // zone, or simply left on duty overnight — sees the warning until an
      // unrelated refetch, while the server has been offering them work
      // since the first ping after coverage returned. Seen 19 Aug 2026:
      // three minutes of the warning against a position nine seconds old.
      queryClient.setQueryData(['duty'], outcome.presence);
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
  }, [api, onDuty, heartbeatSeconds, queryClient]);

  return null;
}