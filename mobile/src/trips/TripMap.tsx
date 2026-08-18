import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { colors, radius, spacing, typography } from '../ui/theme';

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
 * MapLibre GL against CARTO's Positron style needs no key at all, and it is
 * already what the console falls back to when `VITE_MAPBOX_TOKEN` is unset
 * (`frontend/src/pages/public/MapPanel.tsx`) — so the two surfaces draw
 * Kampala the same way. The native MapLibre binding would need a development
 * build; inside a WebView it runs in Expo Go, on a physical handset, and in
 * whatever the fleet eventually installs.
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
 * `Trip` carries `origin` and `destination` as free text — the platform holds
 * no coordinates for either — so a pickup marker would be invented. This
 * position is the real fix `DriverPresence` reports, and when there is none
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
  const html = useMemo(
    () => (latitude === null || longitude === null ? null : mapDocument(latitude, longitude)),
    [latitude, longitude],
  );

  if (html === null) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>
          Waiting for a location fix. Dispatch cannot offer you work until your phone reports one.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.frame}>
      <WebView
        style={styles.web}
        originWhitelist={['*']}
        source={{ html }}
        // The card owns the tap; the map is a picture as far as touch goes.
        pointerEvents="none"
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        // Tiles and the library are the same bytes every time this mounts.
        cacheEnabled
        androidLayerType="hardware"
        // A transparent gap while the tiles arrive beats a white flash.
        backgroundColor="transparent"
      />

      {stale === true && (
        <View style={styles.staleTag}>
          <Text style={styles.staleTagText}>Last known position</Text>
        </View>
      )}
    </View>
  );
}

/**
 * The whole map as one document.
 *
 * Inline rather than a bundled asset so there is nothing to keep in step: the
 * only inputs are two numbers and the brand green, and the style URL is the
 * same keyless CARTO one the console uses.
 */
function mapDocument(latitude: number, longitude: number): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: ${colors.surfaceSunken}; }
  .maplibregl-ctrl-attrib, .maplibregl-ctrl-bottom-left { display: none; }
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
  }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<script>
  var map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    center: [${longitude}, ${latitude}],
    // ~1.5km across: close enough to recognise the junction you are at, wide
    // enough that a poor fix does not look like a wild jump.
    zoom: 14.2,
    attributionControl: false,
    interactive: false
  });

  var el = document.createElement('div');
  el.className = 'pin';
  el.innerHTML = '<i></i>';

  map.on('load', function () {
    new maplibregl.Marker({ element: el }).setLngLat([${longitude}, ${latitude}]).addTo(map);
  });
</script>
</body>
</html>`;
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
