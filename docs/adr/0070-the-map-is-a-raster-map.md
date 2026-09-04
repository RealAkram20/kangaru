# ADR-0070: The map is a raster map

**Status:** Accepted — 3 September 2026

**Depends on:** ADR-0020 (coordinates are named fields, and the longitude-first
trap), ADR-0031 (the road route arrives as an encoded polyline), ADR-0045
(multi-stop journeys and the whole-leg road).

**Amends:** the "MapLibre in a WebView, and why not a native map" rationale in
`mobile/src/trips/PickupMap.tsx` and `TripMap.tsx`. Its first half — *no
Google Maps key, so no `react-native-maps`* — stands. Its second half, that
the WebView should run MapLibre GL against CARTO's vector style, is what this
decision replaces. It also pays the debt those docblocks recorded: *"fold both
onto one document builder once neither file is being actively rewritten."*

## Context

The owner, from a handset, on 3 September: *"I feel like the Map is too
slow."* Read together with the same day's *"screen transitions are lagging,
it's giving immature vibes"*, the map was the heaviest thing on the screens
that lagged, and the transition work (a native push on every stack, and the
map deferring its mount until the slide ends) made the map's first paint land
*later* still — the slide got smooth and the map got a beat slower to appear.

What the map actually did on every mount was measured from the document, not
guessed:

- `<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js">` and
  its stylesheet — **about a megabyte, fetched from a CDN each time a map
  mounted.** The WebView cache helps on a warm handset and does nothing on a
  cold one, an evicted one, or the first run — which is the run a new driver
  judges the app by.
- `https://basemaps.cartocdn.com/gl/positron-gl-style/style.json`, then vector
  tiles, then a **WebGL** render. This fleet runs Tecno, Infinix and Xiaomi
  handsets; WebGL inside a WebView on that class of GPU is the slow path, and
  on a desk emulator without hardware acceleration it is unusable — which is
  how the transition measurement found it.

Two of the three costs are the renderer's, not the network's. Bundling
MapLibre locally would remove the fetch and keep the WebGL.

## Decision

**The driver's maps are Leaflet drawing CARTO's Positron raster tiles, with
Leaflet vendored into the app bundle.**

- **Leaflet 1.9.4** (BSD-2), 147 KB of JS and 15 KB of CSS, written into
  `mobile/src/trips/vendor/leaflet.ts` by `tools/vendor-leaflet.mjs` and
  inlined into every map document. The library loads from the bundle: no
  network, no CDN, present with no signal at all. Only the tiles are fetched.
- **Raster tiles from the same keyless CARTO basemap**
  (`basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`), so the map keeps the
  Positron look the console uses and the no-key decision holds. `{r}` serves
  `@2x` tiles on a dense screen. No WebGL: raster tiles are images, and an
  image is the one thing every WebView on every handset draws fast.
- **One shell, two maps.** `mapShell.ts` owns the document scaffold — the
  inlined library, the tile layer, the interactivity switches, the
  longitude-first conversion — and each map supplies only its own markers and
  state logic. That is the fold the docblocks asked for.
- **Everything that made the previous documents right is kept**, because none
  of it was about the renderer: the document is built once and keyed on the
  fixed geography, every movement travels through `injectJavaScript`, the whole
  leg wins the camera and wins it once, a road route replaces the dashed
  direct lines outright, the vehicle rotates on an inner element and never on
  the marker root the library positions, and no marker is drawn without its
  word.
- **Attribution is shown.** The previous documents hid it. CARTO's basemap
  terms require it, and a public app on a public map should carry it; it is
  Leaflet's compact control, bottom-right, in caption type. This is a
  compliance correction rather than a design preference, and the owner can
  overrule it knowingly.

## Consequences

- The app bundle grows by roughly 160 KB, once. Every map mount stops
  downloading roughly a megabyte.
- The map draws on the CPU's terms rather than the GPU's. On the fleet's
  handsets that is the faster path; on a flagship the vector map was crisper
  at odd zooms, and that is the trade.
- Integer zooms. Raster tiles are sharp at the zoom they were rendered for and
  scaled between them, so the card map sits at 14 rather than 14.2.
- Leaflet's own stylesheet references marker and control images that are not
  shipped. Nothing here uses them — every marker is a `divIcon` — and the
  requests never fire.
- `places.ts` still returns longitude-first pairs, as GeoJSON and the server
  do; the document converts at the edge. The shared helper's contract did not
  change, and neither did the ADR-0020 warning about swapping the two.
- A future Leaflet bump is `npm install leaflet@x` in `mobile/` then
  `node tools/vendor-leaflet.mjs`; the generator refuses a build whose JS would
  close its own `<script>` tag.

## Alternatives considered

- **Bundle MapLibre GL locally, keep the vector map.** Removes the fetch, keeps
  WebGL and the megabyte in the bundle. Rejected because the renderer is the
  larger of the two costs on this fleet.
- **Keep one warm WebView and re-point it between screens.** The biggest
  perceived win and a much larger refactor of both map components and their
  screens; not needed once the library is local and the render is cheap. It
  remains available if the map is still the slowest thing on the screen.
- **`react-native-maps`.** A native map, and the fastest. Still needs a Google
  Maps key on Android, which puts a billing account between a driver and the
  street — the reason ADR-0020's era chose a WebView, unchanged.

## Verification

- `TripMapScreen.test.tsx` keeps every assertion it had — the sprite title
  text, the word beside the vehicle, the exact rotation line, the marker roots
  positioned by the library — because the rules they pin did not change.
- The built bundle contains `leaflet` and does **not** contain
  `unpkg.com/maplibre-gl` or `positron-gl-style`.
- On a handset: a trip screen's map appears with the screen, the road draws
  in brand green with the whole leg muted beneath, the vehicle sits on the
  road and turns with the heading, and the attribution reads in the corner.
