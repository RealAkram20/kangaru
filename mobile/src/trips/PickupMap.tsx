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
  fill = false,
  boarded = false,
  routePolyline = null,
}: {
  pickup: Coordinates | null;
  dropoff: Coordinates | null;
  /** The driver's own position, when the handset has a fix. */
  here: Coordinates | null;
  /**
   * Take the whole space available instead of the inline 220pt panel.
   *
   * For `TripMapScreen`, which is the same map given the screen. A prop rather
   * than a second component: everything that makes this hard — the MapLibre
   * document, the bounds, the no-coordinates case — is identical, and the only
   * difference is a height.
   */
  fill?: boolean;
  /**
   * Whether the passenger is already in the car.
   *
   * Decides which legs are still ahead of the driver, and therefore which get
   * a line: the approach to the pickup is drawn only until they make it.
   * Drawing a leg somebody has already driven is clutter at best and, on a
   * screen read at a junction, a reason to turn the wrong way.
   */
  boarded?: boolean;
  /**
   * A road route from the server (ADR-0031), encoded as Google's polyline.
   *
   * When present it replaces the dashed direct lines entirely — a real road
   * and a crow's-flight guess must never be on the map at once, because the
   * driver cannot tell which one is which.
   *
   * Null is the ordinary case, not an error: no key, no signal, no
   * coordinates. The dashed lines are what runs then, as they did before
   * routing existed.
   */
  routePolyline?: string | null;
}) {
  const html = useMemo(
    // Interactive only when it fills the screen. The inline panel sits inside
    // a ScrollView, where a pannable map swallows the drag that was meant to
    // scroll the page — which is why this was false everywhere until a
    // full-screen map needed to be zoomed into.
    () => (pickup === null ? null : mapDocument(pickup, dropoff, here, fill, boarded, routePolyline)),
    [pickup, dropoff, here, fill, boarded, routePolyline],
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
    <View style={fill ? styles.fill : styles.frame}>
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
  interactive: boolean,
  boarded: boolean,
  routePolyline: string | null,
): string {
  const points = [pickup, ...(dropoff === null ? [] : [dropoff]), ...(here === null ? [] : [here])];
  const bounds = boundsFor(points);

  // JSON, not string concatenation. These are numbers from the network and
  // from a GPS chip, and interpolating them raw into a script tag is how a
  // NaN or a null becomes a syntax error that renders as a blank rectangle.
  const marker = (point: Coordinates, className: string, label: string) =>
    `addMarker(${JSON.stringify([point.lng, point.lat])}, ${JSON.stringify(className)}, ${JSON.stringify(label)});`;

  /**
   * The legs still ahead of the driver, as straight lines.
   *
   * **Dashed, and that is the whole argument.** This platform has no routing
   * engine, so these are direct lines between two points and not roads — the
   * standing rule against drawing a route is a rule against drawing something
   * a driver would *follow*. A dashed line is the map convention for "as the
   * crow flies": it joins the dots so the relationship between them is legible
   * at a glance, without ever looking like a road to take. A solid line here
   * would be the thing the rule forbids; this is the thing the rule was
   * protecting against having to forbid.
   *
   * The caption under the map says "straight line — not the road distance" in
   * words, so the claim is made twice and never only in a stroke style.
   *
   * Green is the approach to the pickup, red is the fare itself — the same two
   * colours the pins already use, so the line inherits a meaning the driver
   * has already learned rather than introducing a third vocabulary.
   */
  const legs: { from: Coordinates; to: Coordinates; tone: 'approach' | 'fare' }[] = [];

  // A real road wins outright. Drawing both would put a measured line and a
  // guess on one map with no way to tell them apart.
  if (routePolyline === null && here !== null && !boarded) {
    legs.push({ from: here, to: pickup, tone: 'approach' });
  }

  if (routePolyline === null && dropoff !== null) {
    // Once the passenger is aboard the driver is *on* this leg, so it is drawn
    // from where they actually are rather than from a kerb they have left.
    legs.push({ from: boarded && here !== null ? here : pickup, to: dropoff, tone: 'fare' });
  }

  const legFeatures = legs.map((leg) => ({
    type: 'Feature' as const,
    properties: { tone: leg.tone },
    geometry: {
      type: 'LineString' as const,
      coordinates: [
        [leg.from.lng, leg.from.lat],
        [leg.to.lng, leg.to.lat],
      ],
    },
  }));

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: ${colors.surfaceSunken}; }
  .maplibregl-ctrl-attrib, .maplibregl-ctrl-bottom-left { display: none; }
  .marker { display: flex; align-items: center; gap: 4px; }
  /* Named, not just coloured. docs/screen-rules.md §6: never carry meaning
     by colour alone — and on a full-screen map there is no rail underneath to
     name the two ends, so the map has to name them itself. */
  .tag {
    font-family: -apple-system, Roboto, sans-serif; font-size: 11px; font-weight: 600;
    line-height: 1; white-space: nowrap; padding: 4px 7px; border-radius: 999px;
    background: ${colors.surface}; color: ${colors.textBody};
    border: 1px solid ${colors.border};
  }
  .pin { width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex: none; }
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
    interactive: ${interactive ? 'true' : 'false'}
  });
${interactive ? "  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');" : ''}

  // Google's encoded polyline, unpacked in the document rather than on the
  // wire. The encoding is roughly a tenth the size of the equivalent point
  // array, which on an upcountry connection is the difference between a route
  // that arrives and one that times out — so it travels encoded and is
  // decoded here, twenty lines from where it is drawn.
  //
  // Transcribed from the published algorithm: signed values, five decimal
  // places, each coordinate a delta on the last.
  function decodePolyline(encoded) {
    var points = [];
    var index = 0, lat = 0, lng = 0;

    while (index < encoded.length) {
      var shift = 0, result = 0, byte;

      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      lat += ((result & 1) ? ~(result >> 1) : (result >> 1));

      shift = 0;
      result = 0;

      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      lng += ((result & 1) ? ~(result >> 1) : (result >> 1));

      // Longitude first: GeoJSON's order and MapLibre's, and the opposite of
      // the lat/lng every other part of this app says. Uganda sits near the
      // equator, so a swap here passes every range check and draws the route
      // in the Indian Ocean.
      points.push([lng / 1e5, lat / 1e5]);
    }

    return points;
  }

  function addRoute(encoded) {
    var coordinates = decodePolyline(encoded);

    if (coordinates.length < 2) { return; }

    map.addSource('route', {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coordinates } }
    });

    // A casing underneath, then the line. A single stroke over a pale basemap
    // loses its edge against the road it is drawn on; the darker casing is
    // what keeps it readable in sunlight, which is the condition this app is
    // designed for.
    map.addLayer({
      id: 'route-casing',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': 9, 'line-color': '${colors.primaryPressed}', 'line-opacity': 0.55 }
    });

    map.addLayer({
      id: 'route',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      // Solid, unlike the dashed direct line — and the difference is the
      // claim. This one followed a road; that one did not.
      paint: { 'line-width': 5, 'line-color': '${colors.primary}' }
    });

    // Framed on the route rather than on the pins: a road that loops around a
    // lake leaves the box the two endpoints would have drawn.
    var bounds = coordinates.reduce(function (box, point) {
      return box.extend(point);
    }, new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));

    map.fitBounds(bounds, { padding: 44, animate: false });
  }

  function addLegs(features) {
    if (!features.length) { return; }

    map.addSource('legs', { type: 'geojson', data: { type: 'FeatureCollection', features: features } });

    // Under the markers, added first. A line drawn over a pin hides the thing
    // the line exists to connect.
    map.addLayer({
      id: 'legs',
      type: 'line',
      source: 'legs',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-width': 4,
        // The leg being driven is the brand green; anything beyond it is
        // muted. Red belongs to the drop-off *pin* — a red line on a road
        // somebody is actively driving reads as a warning, which is how the
        // first version of this looked on a handset.
        'line-color': ['match', ['get', 'tone'], 'approach', '${colors.primary}', '${colors.borderStrong}'],
        // Dashes, never a solid stroke: see the legs docblock above. This is
        // a direct line, and it has to keep saying so at every zoom.
        'line-dasharray': [1.4, 1.4],
        'line-opacity': 0.9
      }
    });
  }

  function addMarker(lngLat, className, label) {
    var el = document.createElement('div');
    el.className = 'marker ' + className;
    // The dot and its name travel together. Three coloured circles on a map
    // are three coloured circles; the words are what make them a pickup, a
    // drop-off and a driver.
    el.innerHTML = '<span class="pin"><i></i></span><span class="tag"></span>';
    el.querySelector('.tag').textContent = label;
    new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
  }

  map.on('load', function () {
    ${routePolyline === null ? '' : `addRoute(${JSON.stringify(routePolyline)});`}
    addLegs(${JSON.stringify(legFeatures)});
    ${marker(pickup, 'pickup', 'Pickup')}
    ${dropoff === null ? '' : marker(dropoff, 'dropoff', 'Drop-off')}
    ${here === null ? '' : marker(here, 'here', 'You')}
    ${
      bounds === null || routePolyline !== null
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
  },
  /**
   * The same map given the whole screen. No border and no corner radius —
   * a full-bleed map with a rounded outline reads as a card that failed to
   * fit, and there is nothing beside it for the border to separate it from.
   */
  fill: {
    flex: 1,
    overflow: 'hidden',
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
