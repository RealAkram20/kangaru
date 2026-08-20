import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

import type { Coordinates } from '../api/types';

/**
 * Where the driver is, for a screen that needs to draw a distance.
 *
 * Extracted from `PickupScreen`, which had it privately, when a second screen
 * needed the same reading with one difference — see `watch` below. Two copies
 * of a permission-handling GPS hook is two places to get the failure mode
 * wrong, and the failure mode is the whole point of it.
 *
 * **Never prompts.** It reads the permission and gives up if it is not
 * already granted. That is `PresenceController`'s rule too: a permission
 * dialog that appears out of a screen transition, rather than out of an act
 * the driver took, is a dialog nobody can connect to anything they did.
 * Refused permission yields null, which every caller renders as an em dash —
 * the screens are built to be complete without it.
 *
 * **A failure is silence, not an error.** A driver can act on a missing
 * figure; they cannot act on a distance measured from a position the handset
 * guessed.
 *
 * This is not the trip's GPS. `GpsStreamer` streams billing evidence to the
 * server from `trip_started` and is sampled for a route; this is sampled for
 * one number on one screen and never leaves the handset.
 */
export function usePosition({
  /**
   * Whether to keep following the driver, or take a single fix.
   *
   * **`false` is for a reading, `true` is for a drive**, and the question to
   * ask is whether the screen is watched while the handset is moving.
   *
   * `true` is what every map screen wants. The driver is definitionally moving
   * for the whole life of `TripInProgressScreen`, `TripMapScreen` and
   * `PickupScreen` — a single fix taken when the screen opened is wrong within
   * a minute and stays wrong, and since ADR-0031 the reading is also the
   * *origin of the drawn route*, so a frozen fix freezes the road too.
   *
   * `PickupScreen` used to take a single reading, on the argument that a
   * distance ticking down beside a driver's eyes is motion for its own sake.
   * That argument lost when the same reading started feeding a route: the
   * approach was drawn from the kerb the driver set off from and never
   * redrawn. `distanceInterval` is what actually settles the original worry —
   * the figure moves 0.1 km at a time, which is progress, not jitter.
   */
  watch = false,
  /**
   * How far the driver must move before a new fix is reported, in metres.
   *
   * Only meaningful when watching. Set against what the figure is rendered
   * to — one decimal place of a kilometre — rather than against what the
   * hardware can do: updating on every satellite fix would re-render the
   * screen several times a second to move a digit that changes every hundred
   * metres.
   */
  distanceInterval = 100,
}: { watch?: boolean; distanceInterval?: number } = {}): Coordinates | null {
  const [position, setPosition] = useState<Coordinates | null>(null);

  useEffect(() => {
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    const record = (reading: Location.LocationObject) => {
      if (!cancelled) {
        setPosition({ lat: reading.coords.latitude, lng: reading.coords.longitude });
      }
    };

    void (async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();

        if (!permission.granted) {
          return;
        }

        // Balanced, not High, in both modes. This feeds a figure rendered to
        // one decimal place of a kilometre; a fix accurate to ten metres
        // would cost battery on a handset that has a trip's worth of GPS
        // ahead of it — and on the watching path, that cost is paid for the
        // whole journey rather than once.
        const accuracy = Location.Accuracy.Balanced;

        if (!watch) {
          record(await Location.getCurrentPositionAsync({ accuracy }));

          return;
        }

        // An immediate fix first, then the subscription. Without it the
        // screen shows an em dash until the driver has moved a hundred
        // metres, which on a screen opened at a standstill can be minutes.
        record(await Location.getCurrentPositionAsync({ accuracy }));

        const started = await Location.watchPositionAsync({ accuracy, distanceInterval }, record);

        if (cancelled) {
          // The screen unmounted while the subscription was being set up.
          // Without this the watch outlives its screen and keeps the GPS
          // awake with nothing reading it.
          started.remove();

          return;
        }

        subscription = started;
      } catch {
        // See the docblock: no fix, no figure.
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [watch, distanceInterval]);

  return position;
}
