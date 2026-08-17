import * as Location from 'expo-location';
import { useState } from 'react';

import { isApiError } from '../api/errors';
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
      await Location.requestForegroundPermissionsAsync().catch(() => null);
    }

    try {
      await setDuty.mutateAsync({ onDuty: !onDuty, vehicleId: duty?.vehicle_id ?? null });
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
