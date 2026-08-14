import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import type { Coordinates } from '../api/types';
import { boundsFor } from './places';
import { colors, radius, typography } from '../ui/theme';

/**
 * The pickup leg, drawn: where the passenger is, where they are going, and
 * where the driver is now.
 *
 * ## MapLibre in a WebView, and why not a native map
 *
 * The same choice `TripMap` made and for the same reason, which is worth
 * repeating because it is the one a mockup will keep asking to reverse:
 * **`react-native-maps` renders a grey grid without a Google Maps API key**,
 * in Expo Go and in a standalone Android build alike. This platform has no
 * such key, and buying one would put a billing account between a driver and
 * the street they are standing on. MapLibre against CARTO's Positron style
 * needs no key, runs in Expo Go on a real handset, and is what the web console
 * already falls back to — so both surfaces draw Kampala the same way.
 *
 * This duplicates `TripMap`'s document scaffold rather than sharing it. That
 * is a stated debt, not an oversight: the two maps answer different questions
 * — that one asks "does the app know where I am", this one asks "where is the
 * passenger relative to me" — and the shared piece is the MapLibre boilerplate
 * rather than the component. **Fold both onto one document builder** once
 * neither file is being actively rewritten.
 *
 * ## What it does not draw
 *
 * **No route line.** The platform has no routing engine, and a straight line
 * between two points is not a road — ADR-0020 §3 refused to turn one into the
 * other. Drawing one would tell a driver to go a way that may not exist. The
 * markers say where things are; the driver's own maps app has the roads.
 *
 * **Nothing when there is no pickup coordinate**, which is the ordinary case
 * for an order a dispatcher keyed in over the phone. A map centred on a
 * plausible default is worse than no map, because a driver who sees a map at
 * all will believe it.
 */
export function PickupMap({
  pickup,
  dropoff,
  here,
}: {
  pickup: Coordinates | null;
  dropoff: Coordinates | null;
  /** The driver's own position, when the handset has a fix. */
  here: Coordinates | null;
}) {
  const html = useMemo(
    () => (pickup === null ? null : mapDocument(pickup, dropoff, here)),
    [pickup, dropoff, here],
  );

  if (html === null) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>
          No map for this trip — the order was taken without a pin on it. The pickup address is
          below.
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
        // The screen owns the scroll; the map is a picture as far as touch
        // goes. A driver is holding a steering wheel — a half-dragged map that
        // stays where it was dragged shows the wrong place on the next glance.
        pointerEvents="none"
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        cacheEnabled
        androidLayerType="hardware"
        backgroundColor="transparent"
      />
    </View>
  );
}

/**
 * The whole map as one document.
 *
 * Inline rather than a bundled asset, so there is nothing to keep in step: the
 * inputs are three coordinate pairs and the theme's colours.
 *
 * Every marker is built from theme tokens interpolated in, never a hand-mixed
 * hex — DESIGN.md §8 fails raw hex in component code, and an HTML string is
 * still component code.
 */
function mapDocument(
  pickup: Coordinates,
  dropoff: Coordinates | null,
  here: Coordinates | null,
): string {
  const points = [pickup, ...(dropoff === null ? [] : [dropoff]), ...(here === null ? [] : [here])];
  const bounds = boundsFor(points);

  // JSON, not string concatenation. These are numbers from the network and
  // from a GPS chip, and interpolating them raw into a script tag is how a
  // NaN or a null becomes a syntax error that renders as a blank rectangle.
  const marker = (point: Coordinates, className: string) =>
    `addMarker(${JSON.stringify([point.lng, point.lat])}, ${JSON.stringify(className)});`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: ${colors.surfaceSunken}; }
  .maplibregl-ctrl-attrib, .maplibregl-ctrl-bottom-left { display: none; }
  .pin { width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
  .pin i { width: 12px; height: 12px; border-radius: 50%; display: block; border: 2.5px solid ${colors.onPrimary}; }
  /* Pickup and drop-off differ by *fill* as well as hue — a ring against a
     disc — so the two ends are still told apart by somebody who cannot
     separate green from red. The rail below the map names them in words. */
  .pickup { background: ${colors.primaryTint}; }
  .pickup i { background: ${colors.surface}; border-color: ${colors.primary}; }
  .dropoff { background: ${colors.dangerTint}; }
  .dropoff i { background: ${colors.danger}; border-color: ${colors.onPrimary}; }
  .here { background: ${colors.infoTint}; }
  .here i { background: ${colors.info}; }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<script>
  var map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    center: ${JSON.stringify([pickup.lng, pickup.lat])},
    zoom: 13,
    attributionControl: false,
    interactive: false
  });

  function addMarker(lngLat, className) {
    var el = document.createElement('div');
    el.className = 'pin ' + className;
    el.innerHTML = '<i></i>';
    new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
  }

  map.on('load', function () {
    ${marker(pickup, 'pickup')}
    ${dropoff === null ? '' : marker(dropoff, 'dropoff')}
    ${here === null ? '' : marker(here, 'here')}
    ${
      bounds === null
        ? ''
        : `map.fitBounds(${JSON.stringify(bounds)}, { padding: 28, animate: false });`
    }
  });
</script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  frame: {
    // Taller than TripMap's 150: this one has to hold two or three markers
    // that can be kilometres apart and still show the streets between them.
    height: 220,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSunken,
  },
  web: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  placeholder: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSunken,
    padding: 16,
  },
  placeholderText: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
