import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { useAfterTransition } from '../navigation/useAfterTransition';
import { colors, radius, spacing, typography } from '../ui/theme';
import { mapShell } from './mapShell';

/**
 * Where the driver is, on the trip card.
 *
 * ## Why a WebView and not a native map
 *
 * `react-native-maps` was the first attempt and rendered a grey grid: Google
 * Maps needs an API key, in Expo Go and in any standalone Android build, and
 * this platform has none. Buying that key would make the driver's home screen
 * depend on a Google billing account before it can draw a street.
 *
 * Inside it runs **Leaflet over CARTO's keyless Positron raster tiles**,
 * the same basemap the console falls back to when `VITE_MAPBOX_TOKEN` is
 * unset (`frontend/src/pages/public/MapPanel.tsx`) — so the two surfaces
 * still draw Kampala the same way. It was MapLibre GL against that
 * basemap's vector style until ADR-0070: that fetched its library from a
 * CDN on every mount and rendered through WebGL, and the owner reported the
 * result as slow. Leaflet ships inside the bundle and draws images.
 *
 * The document scaffold is `mapShell.ts`, shared with `PickupMap`.
 *
 * ## Why it is not interactive
 *
 * It answers one question at a glance — "does the app know where I am?" —
 * which is what decides whether dispatch can offer this driver work at all
 * (ADR-0024 §2). Turn-by-turn is a different product and belongs to whatever
 * app the driver already trusts for it. Gestures are off so the map cannot
 * steal the scroll from the card it sits in.
 *
 * ## Why the pin is the driver and not the route
 *
 * Not because the platform lacks the coordinates — it has had them since
 * `TripResource` grew `pickup`/`dropoff` places, and `PickupMap` draws the
 * route (road-real when `GET /trips/{trip}/route` answers, dashed otherwise).
 * This map answers a different question: the home card's glance is "does the
 * app know where I am", and the trip's geography belongs to the trip screens.
 * The pin is the real fix `DriverPresence` reports, and when there is none
 * the component says so rather than centring on a plausible-looking nowhere.
 */
export function TripMap({
  latitude,
  longitude,
  stale,
}: {
  latitude: number | null;
  longitude: number | null;
  /** The fix is too old for the matcher to act on (ADR-0024 §2). */
  stale?: boolean;
}) {
  const webRef = useRef<WebView>(null);

  // The map waits for the screen to finish arriving before it mounts
  // (`useAfterTransition`): a WebView mounting mid-push is the stutter the
  // owner reported. Answers `true` at once when there is no stack around it.
  const settled = useAfterTransition();

  // The latest fix, held where the load handler can read it without being in
  // the document's dependency list. Written in an effect rather than during
  // render — a ref assigned in the render body is invisible to the React
  // Compiler, which then cannot memoise this component at all.
  const positionRef = useRef(
    latitude === null || longitude === null ? null : [longitude, latitude],
  );

  useEffect(() => {
    positionRef.current = latitude === null || longitude === null ? null : [longitude, latitude];
    // A new fix is one marker gliding, not a page rebuilding. The document
    // used to be rebuilt on every position change, and a changed
    // `source.html` makes the WebView reload the whole page — white flash,
    // tiles refetched — on a card whose position now refreshes with every
    // presence heartbeat. `true;` because injectJavaScript evaluates the
    // string; the guard tolerates a page that has not finished loading, which
    // `onLoadEnd` below covers.
    // Optional twice over: the page may not have finished loading (`onLoadEnd`
    // below replays the fix), and the test harness mounts WebView as a bare
    // view with no bridge at all.
    webRef.current?.injectJavaScript?.(
      `window.__setPosition && window.__setPosition(${JSON.stringify(positionRef.current)}); true;`,
    );
  }, [latitude, longitude]);

  const hasFix = latitude !== null && longitude !== null;

  // Built once per gained-or-lost fix, never per movement: the document is
  // seeded from the ref and every later fix travels through the injection
  // above. Keying on the coordinates — as this used to — reloaded the page
  // each time they changed.
  const html = useMemo(
    () => (hasFix ? mapDocument([longitude as number, latitude as number]) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the coordinates deliberately do not re-key the document; they seed it when it happens to build and travel via injection ever after
    [hasFix],
  );

  if (html === null) {
    return (
      <View style={styles.placeholder}>
        {/*
          **Not "dispatch cannot offer you work until your phone reports one",
          which is what this said and which is false.** A driver with no
          reported position stays in the pool — `DatabaseDriverPresenceStore::
          dispatchable()` keeps them through its `whereNull('latitude')` branch
          and `WalkInRecommender` ranks them without distance, saying so on the
          offer itself: "This driver has not reported a position, so distance
          was not used."

          Proved by running it: on an emulator that never delivered a fix, this
          message sat on the screen while the same phone was offered a ride and
          accepted it. Telling a driver they cannot be sent work while work is
          arriving is the kind of copy that teaches them to distrust the app —
          and the wording here now matches `DutyBar`'s, which was already
          honest about it being a ranking problem rather than a shutout.
        */}
        <Text style={styles.placeholderText}>
          Waiting for a location fix. Jobs can still reach you, but nearby ones may go to a driver
          whose phone has reported one.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.frame}>
      {/* The frame keeps its size while empty, so the map landing shifts nothing. */}
      {settled && (
        <WebView
          ref={webRef}
          style={styles.web}
          originWhitelist={['*']}
          source={{ html }}
          // The fix again once the page exists: the effect above can fire before
          // the document has parsed, and an update injected into a page that is
          // not there yet is silently dropped.
          onLoadEnd={() =>
            webRef.current?.injectJavaScript?.(
              `window.__setPosition && window.__setPosition(${JSON.stringify(positionRef.current)}); true;`,
            )
          }
          // The card owns the tap; the map is a picture as far as touch goes.
          pointerEvents="none"
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          // Tiles and the library are the same bytes every time this mounts.
          cacheEnabled
          androidLayerType="hardware"
        />
      )}

      {stale === true && (
        <View style={styles.staleTag}>
          <Text style={styles.staleTagText}>Last known position</Text>
        </View>
      )}
    </View>
  );
}

/**
 * The whole map as one document (ADR-0070).
 *
 * Built on `mapShell`, which brings the library with it: only the marker and
 * the one entry point are this map's own. The inputs are still two numbers
 * and the brand green.
 */
function mapDocument(position: [number, number]): string {
  return mapShell({
    // `position` is longitude-first, as every fix on this platform is
    // (ADR-0020); the shell's constructor wants latitude first.
    center: [position[1], position[0]],
    // A raster tile is sharp at the zoom it was rendered for, so an integer:
    // ~1.5 km across, close enough to recognise the junction you are at,
    // wide enough that a poor fix does not look like a wild jump.
    zoom: 14,
    interactive: false,
    css: `
  /* The halo is the theme's green tint, not a hand-mixed alpha — one more
     place a raw colour would have crept in unnoticed. */
  .pin {
    width: 30px; height: 30px; border-radius: 50%;
    background: ${colors.primaryTint};
    opacity: 0.92;
    display: flex; align-items: center; justify-content: center;
  }
  .pin i {
    width: 14px; height: 14px; border-radius: 50%;
    background: ${colors.primary};
    border: 2.5px solid ${colors.onPrimary};
    display: block;
  }`,
    script: `
  var pin = L.divIcon({ className: 'pin', html: '<i></i>', iconSize: [30, 30], iconAnchor: [15, 15] });
  var marker = null;

  // The one entry point React Native injects into. Nothing to park: a raster
  // map is ready the moment it is built, so a fix is drawn as it arrives.
  window.__setPosition = function (lngLat) {
    if (lngLat === null) { return; }

    var at = ll(lngLat);

    if (marker === null) {
      marker = L.marker(at, { icon: pin, interactive: false }).addTo(map);
    } else {
      marker.setLatLng(at);
    }

    // Eased, never jumped: this map is the dot, so the camera follows it —
    // smoothly, because a camera that teleports under the reader's eyes is
    // the "shake" this file was rewritten to remove.
    map.panTo(at, { animate: true, duration: 0.6 });
  };

  window.__setPosition(${JSON.stringify(position)});`,
  });
}

const HEIGHT = 150;

const styles = StyleSheet.create({
  frame: {
    height: HEIGHT,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceSunken,
    marginTop: spacing.md,
  },
  web: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  placeholder: {
    height: HEIGHT,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSunken,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    marginTop: spacing.md,
  },
  placeholderText: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  staleTag: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: colors.warningTint,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  staleTagText: {
    ...typography.caption,
    fontSize: 11,
    color: colors.warning,
  },
});
