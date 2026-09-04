import { Linking, Platform } from 'react-native';

import type { Coordinates } from '../api/types';

/**
 * Handing a place to the driver's own maps app.
 *
 * **This app does not draw routes and is not going to.** Neither map in the
 * driver app has a routing engine behind it — `TripMap` and `PickupMap` place
 * markers on a map document and deliberately draw no line between them,
 * because a straight line is not a road and telling a driver to take one is
 * telling them to go a way that may not exist. ADR-0020 §3 declined to derive
 * even a *duration* from a straight line for the same reason.
 *
 * So the honest division is: this platform answers *where*, and the maps app
 * the driver already has answers *how*. That app knows the one-way system on
 * Kampala Road, it has the traffic, and its voice guidance is the one they are
 * used to. Rebuilding a worse version of it inside this app would cost a
 * Directions API bill to be second best.
 *
 * ## Why three URLs
 *
 * `geo:` is Android's intent scheme and lets the driver's *default* maps app
 * answer — which on a fleet handset may well not be Google Maps. iOS has no
 * `geo:` handler, so it gets Apple Maps' own scheme. The `https` form is the
 * fallback for both: it opens in a browser and then usually hands off to the
 * installed app anyway, so a device with no maps app still shows the driver a
 * map rather than nothing.
 *
 * The label rides along as a query so the destination pin is named rather than
 * being an anonymous dot at a coordinate — a driver comparing the pin to the
 * address on this screen should not have to trust that they match.
 */
export async function openDirections(to: Coordinates, label: string): Promise<void> {
  const pair = `${to.lat},${to.lng}`;
  const named = encodeURIComponent(label);

  const candidates = Platform.select({
    ios: [`maps://?daddr=${pair}&q=${named}`],
    android: [`geo:${pair}?q=${pair}(${named})`],
    default: [] as string[],
  });

  const urls = [
    ...(candidates ?? []),
    `https://www.google.com/maps/dir/?api=1&destination=${pair}`,
  ];

  for (const url of urls) {
    try {
      await Linking.openURL(url);

      return;
    } catch {
      // Try the next one. A scheme with no handler throws here rather than
      // returning false, which is why this is a loop and not a `canOpenURL`
      // check — `canOpenURL` needs schemes declared up front on both
      // platforms, and an undeclared one reports "cannot open" even when the
      // app is installed.
      continue;
    }
  }

  // Every candidate failed, which in practice means a handset with no browser
  // and no maps app. Nothing useful to say that the address already on the
  // screen does not: the caller renders it beside the button.
}
