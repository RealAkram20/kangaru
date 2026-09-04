import { colors } from '../ui/theme';
import { LEAFLET_CSS, LEAFLET_JS } from './vendor/leaflet';

/**
 * The one document every map in the app is built on (ADR-0070).
 *
 * `TripMap` and `PickupMap` used to carry their own copy of the same
 * scaffold — viewport, stylesheet, library, map construction — and both
 * docblocks recorded that as a debt to pay "once neither file is being
 * actively rewritten". Both were rewritten for the raster map, so this is
 * where the scaffold lives now. Each map supplies only what is its own: the
 * CSS for its markers and the script that draws and moves them.
 *
 * ## Inlined, not fetched
 *
 * The library is `LEAFLET_JS` from the vendored module, written into the
 * document as a string. The previous scaffold fetched about a megabyte of
 * MapLibre GL from a CDN on every mount, which was most of *"the map is too
 * slow"*; this document brings roughly 160 KB with it from the bundle and
 * fetches nothing but tiles.
 *
 * ## What the page gets
 *
 * A global `map`, already built and positioned; `ll(lngLat)`, which turns the
 * longitude-first pairs `places.ts` and the server speak into the
 * latitude-first pairs Leaflet takes — the conversion happens here, at the
 * edge, so ADR-0020's swap can only ever happen in one line; and
 * `fitPadded(latLngs, padding, animate)`, which frames a set of points with
 * per-side pixel padding, the way both maps frame a leg around a floated
 * badge.
 *
 * ## Attribution is visible
 *
 * The previous documents hid it. CARTO's basemap terms require it, so this
 * shows Leaflet's compact control in caption type — a compliance correction,
 * recorded in ADR-0070, that the owner can overrule knowingly.
 */

/** CARTO Positron, raster, keyless. `{r}` becomes `@2x` on a dense screen. */
export const RASTER_TILES = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

export function mapShell({
  center,
  zoom,
  interactive,
  css,
  script,
}: {
  /** Latitude, longitude — Leaflet's order, converted by the caller. */
  center: [number, number];
  /** An integer: raster tiles are sharp at the zoom they were rendered for. */
  zoom: number;
  /** Whether the reader may drag and zoom. A card is a picture; a full screen is a map. */
  interactive: boolean;
  /** The map's own marker styles. Theme tokens interpolated in, never raw hex. */
  css: string;
  /** The map's own script. Runs after `map`, `ll` and `fitPadded` exist. */
  script: string;
}): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>${LEAFLET_CSS}</style>
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: ${colors.surfaceSunken}; }
  .leaflet-container { background: ${colors.surfaceSunken}; font-family: -apple-system, Roboto, sans-serif; }
  /* Every marker here is a divIcon. Leaflet's default gives one a white box
     and a border, which would put a square behind every pin. */
  .leaflet-div-icon { background: transparent; border: 0; }
  /* Caption type, quiet, and present: see the docblock on attribution. */
  .leaflet-control-attribution { font-size: 9px; line-height: 1.4; padding: 1px 5px; color: ${colors.textMuted}; background: ${colors.surface}; opacity: 0.85; }
  .leaflet-control-attribution a { color: ${colors.textMuted}; text-decoration: none; }
${css}
</style>
</head>
<body>
<div id="map"></div>
<script>${LEAFLET_JS}</script>
<script>
  var INTERACTIVE = ${interactive ? 'true' : 'false'};

  var map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    dragging: INTERACTIVE,
    touchZoom: INTERACTIVE,
    doubleClickZoom: INTERACTIVE,
    scrollWheelZoom: false,
    boxZoom: false,
    keyboard: false,
    zoomAnimation: true,
    fadeAnimation: true,
    markerZoomAnimation: true
  }).setView(${JSON.stringify(center)}, ${JSON.stringify(zoom)});

  L.tileLayer(${JSON.stringify(RASTER_TILES)}, {
    subdomains: 'abcd',
    maxZoom: 20,
    attribution: ${JSON.stringify(TILE_ATTRIBUTION)}
  }).addTo(map);

  L.control.attribution({ prefix: false, position: 'bottomright' }).addTo(map);

  if (INTERACTIVE) {
    L.control.zoom({ position: 'topright' }).addTo(map);
  }

  // Longitude first is what the server, GeoJSON and places.ts speak;
  // latitude first is what Leaflet takes. One conversion, here.
  function ll(lngLat) { return [lngLat[1], lngLat[0]]; }

  function fitPadded(latLngs, padding, animate) {
    map.fitBounds(L.latLngBounds(latLngs), {
      paddingTopLeft: [padding.left, padding.top],
      paddingBottomRight: [padding.right, padding.bottom],
      animate: animate,
      duration: 0.6
    });
  }
${script}
</script>
</body>
</html>`;
}
