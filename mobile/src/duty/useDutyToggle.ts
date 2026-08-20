import * as Location from 'expo-location';
import { useState } from 'react';

import { isApiError } from '../api/errors';
import { goOffline, goOnline } from './OnlineService';
import { useDuty, useSetDuty } from './queries';

/**
 * Going on and off duty — the act, without the control that triggers it.
 *
 * **Extracted from `DutyBar` when the drawer grew a Go Offline button**
 * (AGENTS.md: if it appears twice it becomes shared). Two copies of this would
 * have been two answers to the same question, and the half that would have
 * been dropped in the copy is the one that matters least often and costs most:
 * the location permission prompt.
 *
 * ## The three things this owns, and why none of them belongs in a component
 *
 * **The permission is asked at the moment a driver signs on**, never from a
 * background timer — a dialog that appears minutes later out of a timer is one
 * nobody can connect to anything they did. A refusal **does not block the
 * shift**: the server keeps a driver dispatchable without coordinates and ranks
 * them without distance (ADR-0024 §2), so refusing to sign them on would be
 * this app inventing a rule the platform does not have.
 *
 * **The vehicle travels with the request.** `duty.vehicle_id` is the per-shift
 * answer and dropping it silently signs a driver on against their default
 * vehicle instead.
 *
 * **A refusal is shown in the server's own words.** ADR-0017 put the wording
 * for approved leave, a roster and a suspension in one place precisely so a
 * driver is not told two different things by two different screens — which is
 * exactly what a second copy of this would have produced.
 *
 * **The background service starts and stops here** (ADR-0046). This is the one
 * place in the app that knows a shift has just begun or ended, which makes it
 * the only honest place to acquire and release something as heavy as a
 * foreground service and a wake lock. Hanging it off a screen's mount instead
 * would tie a driver's availability to which tab they happen to be standing
 * on — the same mistake `PresenceController`'s docblock argues against, one
 * level up.
 */
export function useDutyToggle() {
  const { data: duty, isLoading } = useDuty();
  const setDuty = useSetDuty();
  const [refusal, setRefusal] = useState<string | null>(null);

  const onDuty = duty?.on_duty ?? false;

  // A plain function, not a `useCallback`. It closes over duty state that
  // changes on every poll, so the memo could never be preserved anyway — and
  // the React Compiler says so rather than letting it look memoised.
  const toggle = async () => {
    setRefusal(null);

    if (!onDuty) {
      const foreground = await Location.requestForegroundPermissionsAsync().catch(() => null);

      // **Background location, asked only after foreground was granted.**
      // Android refuses the background prompt outright if foreground has not
      // been granted first, and asking anyway produces an instant denial the
      // driver never sees — after which the OS will not ask again, and the
      // only way back is the app's settings page.
      //
      // This is what lets the shift survive the screen going off: without it
      // the foreground service still starts, but the OS stops delivering
      // positions once the app leaves the screen, and the driver goes stale
      // in three minutes (`dispatch.presence_ttl_seconds`).
      //
      // A refusal is **not** a reason to refuse the shift. ADR-0024 §2 keeps a
      // driver dispatchable without coordinates and ranks them without
      // distance; blocking here would be this app inventing a rule the
      // platform does not have. They work, ranked by everything except how
      // near they are.
      if (foreground?.granted === true) {
        await Location.requestBackgroundPermissionsAsync().catch(() => null);
      }
    }

    try {
      const presence = await setDuty.mutateAsync({
        onDuty: !onDuty,
        vehicleId: duty?.vehicle_id ?? null,
      });

      // **The server's answer drives the service, not the toggle's position.**
      // `setDuty` can succeed with the shift refused for a reason ADR-0017
      // owns — approved leave, a roster, a suspension — and starting a
      // foreground service off the tap rather than the answer would leave a
      // driver with an ongoing "You are online" notification for a shift the
      // platform declined to start.
      if (presence.on_duty) {
        await goOnline({
          onDuty: true,
          vehicleId: presence.vehicle_id,
          heartbeatSeconds: presence.heartbeat_seconds,
        });
      } else {
        await goOffline();
      }
    } catch (error) {
      setRefusal(
        isApiError(error)
          ? error.message
          : 'Could not reach the office. Check your connection and try again.',
      );
    }
  };

  return {
    duty,
    isLoading,
    onDuty,
    /** The server's answer, not the toggle's position — see `DutyBar`. */
    dispatchable: duty?.dispatchable ?? false,
    busy: setDuty.isPending,
    refusal,
    clearRefusal: () => setRefusal(null),
    toggle,
  };
}
