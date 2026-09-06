# ADR-0070: The map library ships in the bundle

**Status:** Accepted — 4 September 2026

**Depends on:** ADR-0020 (coordinates are named fields, and the longitude-first
trap), ADR-0031 (the road route arrives as an encoded polyline), ADR-0045
(multi-stop journeys and the whole-leg road).

**Amends:** nothing about the *renderer*. The "MapLibre in a WebView, and why
not a native map" rationale in `mobile/src/trips/PickupMap.tsx` and
`TripMap.tsx` stands in full. What changes is where the library comes from.

## Context

The owner, from a handset, on 3 September: *"I feel like the Map is too
slow."* Read together with the same day's transition work — a native push on
every stack, with the map deferring its mount until the slide ends — the map
became the last thing on the screen to appear, and the slowest.

What the map actually did on every mount was measured from the document, not
guessed. Two costs:

1. **`<script src="https://unpkg.com/maplibre-gl@4.7.1/…">` plus its
   stylesheet — about 870 KB fetched from a CDN each time a map mounted.**
   The WebView cache helps on a warm handset and does nothing on a cold one,
   an evicted one, or the first run — which is the run a new driver judges the
   app by. On a boda's connection at the kerb this is the wait you feel.
2. **A WebGL render of vector tiles.** This fleet runs Tecno, Infinix and
   Xiaomi handsets; WebGL inside a WebView on that class of GPU is the slow
   path.

Only one of the two can be fixed without a Google-sized billing relationship.

## Decision

**MapLibre GL is vendored into the app bundle and inlined into every map
document. The renderer, the basemap and both map components are unchanged.**

- `tools/vendor-maplibre.mjs` writes `maplibre-gl@4.7.1`'s minified JS and CSS
  into `mobile/src/trips/vendor/maplibre.ts` as string constants. Both
  documents inline them in place of the two CDN tags. The library now loads
  from the bundle with **no network at all**; only the vector tiles are
  fetched.
- `JSON.stringify`, not a template literal, so no backtick or `${` in a future
  MapLibre release can end the string it is written into. The generator
  refuses a build whose JS contains `</script`, which no escaping could fix.
- The basemap stays **CARTO's Positron vector style**, which is keyless —
  verified on the day: the style JSON names no key, and its tile endpoint
  returns a 121 KB protobuf tile with no credentials.

## What was tried first, and why it failed

**A raster map on Leaflet.** Leaflet is a fifth of MapLibre's size and needs no
WebGL, so it would have fixed *both* costs. It was built, it worked, and it
was reverted, because CARTO's raster endpoint is not the same product as its
vector style:

| Endpoint | Result, measured 4 Sep 2026 |
|---|---|
| `basemaps.cartocdn.com` **vector** tiles | 200, 121 KB protobuf, no key |
| `basemaps.cartocdn.com` **raster** tiles | 200, and every tile stamped **"API KEY REQUIRED — carto.com/basemaps/apikey"** |

The failure mode is worth recording because it is the shape this codebase
keeps meeting: **a quiet 200.** Nothing errored, nothing logged, the map drew
streets, the markers and route were correct — and a watermark ran diagonally
across every tile. It was invisible to typecheck, to lint, to 1243 passing
tests and to a bundle grep. It was found by installing the build on an
emulator and *looking at the screen*.

No keyless raster basemap is available to a commercial fleet:
OpenStreetMap's own tiles serve fine but the OSMF usage policy specifically
forbids distributing an app that uses them; Esri, Stadia, Thunderforest and
MapTiler all require a key or a subscription. An API key is the one thing this
platform has refused since the beginning, and for the reason the map docblocks
have always given: it puts a billing account between a driver and the street.

So the renderer stays as it was, and the library — the half that *can* be
fixed for free, and the half that hurts most on a poor connection — moves into
the bundle.

## Consequences

- The JS bundle grows by ~880 KB, once. Every map mount stops downloading
  ~870 KB.
- **The WebGL cost is untouched**, and remains the map's floor on a low-end
  handset. If the map is still the slowest thing on the screen, the next lever
  is keeping one warm map WebView alive across screens rather than mounting a
  new one per screen — a larger refactor, deliberately not taken here.
- The document string now carries the library, so it is ~870 KB rather than a
  few KB. It is built once per screen (`useMemo`, keyed on the fixed geography)
  and crosses the bridge once per mount — a memcpy, not a round trip.
- A MapLibre bump is `npm install maplibre-gl@x` in `mobile/` then
  `node tools/vendor-maplibre.mjs`.
- `vendor/` in the root `.gitignore` is Composer's and matches at any depth, so
  it swallowed the generated module — a build input, absent from a fresh clone
  and from CI, present only on the machine that generated it. The same bug the
  file already documents for Laravel's published mail views. Negated
  explicitly.

## Verification

- The built bundle contains `maplibre-gl` and the Positron style URL, and
  **zero** matches for `unpkg.com`.
- On a handset: the trip map draws streets, the road in brand green with the
  whole leg muted beneath, both markers with their words, and the vehicle on
  the road — **with no watermark on any tile**. That last clause is the one
  this ADR exists to make somebody check.
