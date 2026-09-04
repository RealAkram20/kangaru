import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import type { Coordinates } from '../api/types';
import { useAfterTransition } from '../navigation/useAfterTransition';
import { mapShell } from './mapShell';
import { boundsFor } from './places';
import { VEHICLE_SPRITES, type VehicleSprite } from './vehicleSprites';
import { colors, radius, typography } from '../ui/theme';

/**
 * The pickup leg, drawn: where the passenger is, where they are going, and
 * where the driver is now.
 *
 * ## A raster map in a WebView, and why not a native one
 *
 * The same choice `TripMap` made and for the same reason, which is worth
 * repeating because it is the one a mockup will keep asking to reverse:
 * **`react-native-maps` renders a grey grid without a Google Maps API key**,
 * in Expo Go and in a standalone Android build alike. This platform has no
 * such key, and buying one would put a billing account between a driver and
 * the street they are standing on.
 *
 * What runs inside the WebView is **Leaflet over CARTO's keyless Positron
 * raster tiles** (ADR-0070). It was MapLibre GL against the same basemap's
 * vector style until the owner reported the map as slow: that document
 * fetched about a megabyte of library from a CDN on every mount and then
 * rendered through WebGL, which is the slow path on the Tecno and Infinix
 * handsets this fleet runs. Leaflet is 160 KB, ships *inside* the bundle
 * (`vendor/leaflet.ts`), and draws images. Only the tiles are fetched.
 *
 * The scaffold — library, tiles, the longitude-first conversion — lives in
 * `mapShell.ts` and is shared with `TripMap`, which is the debt this file's
 * docblock used to record and ADR-0070 paid: the two maps answer different
 * questions (that one asks "does the app know where I am", this one asks
 * "where is the passenger relative to me") but the boilerplate was never
 * what differed.
 *
 * ## The document is built once; everything that moves is injected
 *
 * The document used to be rebuilt whenever any prop changed — and a new
 * `source.html` makes the WebView **reload the whole page**: white flash,
 * tiles refetched, camera snapped back. `TripInProgressScreen` re-renders
 * every second for its elapsed clock, and `pickup` is a fresh object each
 * render, so the map reloaded once a second for the length of a trip. The
 * owner, from a handset: "the screen shakes then shows the route".
 *
 * So the document is now keyed on the coordinates that genuinely cannot
 * change mid-screen — the pickup and drop-off — and everything that can
 * (the driver's position, the leg being driven, the road route) is pushed into
 * the running page with `injectJavaScript`, where the map updates a layer
 * or moves a marker without any flash at all. The camera moves only when the
 * *route geometry* changes, and then it glides (`animate: true`) instead of
 * teleporting.
 *
 * ## What it does not draw
 *
 * **No fabricated route line.** The platform draws a road only when the
 * server measured one (ADR-0031); otherwise the legs are dashed straight
 * lines, because a straight line between two points is not a road — ADR-0020
 * §3 refused to turn one into the other.
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
  leg = 'fare',
  overlay = null,
  routePolyline = null,
  legPolyline = null,
  heading = null,
  vehicle = 'sedan',
}: {
  pickup: Coordinates | null;
  dropoff: Coordinates | null;
  /** The driver's own position, when the handset has a fix. */
  here: Coordinates | null;
  /**
   * Take the whole space available instead of the inline 220pt panel.
   *
   * For `TripMapScreen`, which is the same map given the screen. A prop rather
   * than a second component: everything that makes this hard — the map
   * document, the bounds, the no-coordinates case — is identical, and the only
   * difference is a height.
   */
  fill?: boolean;
  /**
   * Which half of the job this map is drawing.
   *
   * `approach` is the drive to the passenger — the road between accepting and
   * arriving. `fare` is the passenger's own journey, from the pickup to the
   * drop-off. **Exactly one of them is ever drawn**, and the caller says
   * which, because only the caller knows where in the job the driver is.
   *
   * This used to be a `boarded` boolean, and the difference is the bug it
   * fixes. `boarded` said *the passenger is in the car*, and the map inferred
   * the leg from it — so a screen with no fix and no route fell through to the
   * fare leg and drew the passenger's journey on the screen whose entire job
   * is routing the driver *to* the passenger. The owner, from a handset:
   * "i should be seeing where the client is and where i am going". Naming the
   * leg outright means a screen can no longer draw the other one by accident.
   *
   * A leg with nothing to draw draws nothing. That is the honest answer and
   * it is better than the neighbouring line: on a 220pt map at a junction, a
   * driver cannot tell a leg they are on from a leg they are not.
   */
  leg?: 'approach' | 'fare';
  /**
   * Which corner a caller has floated something over, so the map can frame
   * *around* it.
   *
   * Two screens put a stat badge on this map — `PickupScreen` bottom-left,
   * `TripInProgressScreen` bottom-right — and the map framed its pins into the
   * space those badges occupy. On the owner's handset the drop-off marker sat
   * underneath the card describing it.
   *
   * The badge does not move: floating it there is a deliberate design, and a
   * driver glancing at the map should read the distance without looking
   * anywhere else. What was wrong is that the map did not know it was there.
   * The padding below is the whole fix, and it belongs here because
   * `fitBounds` is here.
   */
  overlay?: 'bottom-left' | 'bottom-right' | null;
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
  /**
   * The **whole** leg's road, from the fixed end it started at — as against
   * `routePolyline`, which starts wherever the driver happens to be.
   *
   * This is the fix for a complaint that took a while to name. The map only
   * ever drew the road *ahead*, and then framed the camera on it, so the
   * remaining road filled the screen at every stage: the picture at ten per
   * cent through a job and at ninety looked the same. The owner, from a
   * handset: *"the driver can not see where he is from the entire route so
   * they find it hard to tell the progress visually"*.
   *
   * With this present the map draws the whole leg muted underneath, the road
   * still to drive in brand green on top, and the vehicle at the seam — and
   * **the camera holds still**, refitting only when this geometry changes
   * rather than on every position tick. A frame that holds still is what makes
   * a moving vehicle read as progress; that is the entire mechanism.
   *
   * Null is the ordinary case and it restores exactly the previous picture:
   * the approach leg has no such road (its origin is wherever the driver was
   * when they accepted, which this platform does not record), and neither has
   * a trip whose route the provider could not draw.
   */
  legPolyline?: string | null;
  /**
   * Which way the driver is pointing, in degrees clockwise from true north,
   * or null when the handset did not say.
   *
   * Null leaves the vehicle pointing north, and `FleetMap` records the reason
   * from the console side: *"a rotated vehicle reads as a direction of travel,
   * and inventing one would be a claim"*.
   */
  heading?: number | null;
  /**
   * Which silhouette the driver is drawn as — from `vehicle.category` on the
   * trip, through `spriteFor`.
   *
   * The default is the same generic car `spriteFor` falls back to, so a caller
   * that does not know the vehicle draws a car rather than nothing.
   */
  vehicle?: VehicleSprite;
}) {
  const webRef = useRef<WebView>(null);

  // The map waits for the screen to finish arriving before it mounts
  // (`useAfterTransition`): a WebView mounting mid-push is the stutter the
  // owner reported. Answers `true` at once when there is no stack around it.
  const settled = useAfterTransition();

  // The latest dynamic state, held where the load handler can read it without
  // being in the document's dependency list. Written in an effect rather than
  // during render — a ref assigned in the render body is invisible to the
  // React Compiler, which then cannot memoise this component at all.
  const stateRef = useRef(statePayload(here, leg, routePolyline, legPolyline, heading));

  const hereLat = here?.lat ?? null;
  const hereLng = here?.lng ?? null;

  useEffect(() => {
    stateRef.current = {
      here: hereLat === null || hereLng === null ? null : [hereLng, hereLat],
      leg,
      route: routePolyline,
      legRoute: legPolyline,
      heading,
    };
    // `true;` because injectJavaScript evaluates the string and Android
    // rejects a non-serialisable completion value. Both optional calls are
    // load-bearing: the page may not have finished loading (`onLoadEnd` below
    // replays the state), and the test harness mounts WebView as a bare view
    // with no bridge at all.
    webRef.current?.injectJavaScript?.(
      `window.__applyState && window.__applyState(${JSON.stringify(stateRef.current)}); true;`,
    );
  }, [hereLat, hereLng, leg, routePolyline, legPolyline, heading]);

  // Keyed on the trip's fixed geography only. `pickup` and `dropoff` are new
  // *objects* every render (`toCoordinates` builds them in the render body),
  // so keying on the objects — as this used to — rebuilt the document every
  // render, and a changed `source.html` is a full page reload.
  const html = useMemo(
    () =>
      pickup === null
        ? null
        : mapDocument(
            pickup,
            dropoff,
            fill,
            overlay,
            vehicle,
            statePayload(here, leg, routePolyline, legPolyline, heading),
          ),
    // `vehicle` belongs in this list rather than in the injected state: the
    // sprite is inlined into the document's markup, and a driver does not swap
    // vehicles mid-trip, so it is fixed geography's kind of constant.
    //
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on primitives of the fixed geography only; the dynamic props seed the document when it happens to build and travel via injection ever after
    [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, fill, overlay, vehicle],
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
      {/* The frame keeps its size while empty, so the map landing shifts nothing. */}
      {settled && (
        <WebView
          ref={webRef}
          style={styles.web}
          originWhitelist={['*']}
          source={{ html }}
          // The state again once the page exists. The injection effect above can
          // fire before the document has parsed — most visibly on Android, where
          // the WebView also restarts with its process — and an update sent into
          // a page that is not there yet is silently dropped.
          onLoadEnd={() =>
            webRef.current?.injectJavaScript?.(
              `window.__applyState && window.__applyState(${JSON.stringify(stateRef.current)}); true;`,
            )
          }
          // The screen owns the scroll; the map is a picture as far as touch
          // goes. A driver is holding a steering wheel — a half-dragged map that
          // stays where it was dragged shows the wrong place on the next glance.
          pointerEvents="none"
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          cacheEnabled
          androidLayerType="hardware"
        />
      )}
    </View>
  );
}

/**
 * The dynamic half of the map, as one JSON-serialisable object.
 *
 * The same shape travels three ways: baked into the document as its opening
 * state, replayed on `onLoadEnd`, and injected on every change — so the page
 * has exactly one entry point for "here is the world now" and cannot drift
 * between a load-time and an update-time picture.
 */
function statePayload(
  here: Coordinates | null,
  leg: 'approach' | 'fare',
  routePolyline: string | null,
  legPolyline: string | null,
  heading: number | null,
): {
  here: [number, number] | null;
  leg: 'approach' | 'fare';
  route: string | null;
  legRoute: string | null;
  heading: number | null;
} {
  return {
    here: here === null ? null : [here.lng, here.lat],
    leg,
    route: routePolyline,
    legRoute: legPolyline,
    heading,
  };
}

/**
 * The whole map as one document (ADR-0070).
 *
 * Built on `mapShell`, which brings the library, the tiles and the
 * longitude-first conversion with it; what is here is this map's own — the
 * markers, the roads, the camera rule.
 *
 * Every marker is built from theme tokens interpolated in, never a hand-mixed
 * hex — DESIGN.md §8 fails raw hex in component code, and an HTML string is
 * still component code.
 */
function mapDocument(
  pickup: Coordinates,
  dropoff: Coordinates | null,
  interactive: boolean,
  overlay: 'bottom-left' | 'bottom-right' | null,
  vehicle: VehicleSprite,
  initial: ReturnType<typeof statePayload>,
): string {
  const points = [
    pickup,
    ...(dropoff === null ? [] : [dropoff]),
    ...(initial.here === null ? [] : [{ lat: initial.here[1], lng: initial.here[0] }]),
  ];
  // `boundsFor` speaks GeoJSON — `[[west, south], [east, north]]` — and
  // Leaflet takes `[[south, west], [north, east]]`. Converted here, at the
  // edge, so ADR-0020's swap has exactly one place to happen.
  const box = boundsFor(points);
  const bounds =
    box === null
      ? null
      : [
          [box[0][1], box[0][0]],
          [box[1][1], box[1][0]],
        ];

  return mapShell({
    center: [pickup.lat, pickup.lng],
    zoom: 13,
    interactive,
    css: `
  /*
    The pin sits *on* the coordinate it marks, and its name hangs beside it.

    This was a flex row — pin, gap, tag — centred on the point by the map
    library, which put the pin about 28 px to the *left* of the place it
    marked, at every zoom, on both ends of every job. On a 393 px handset that
    is seven per cent of the screen between a pickup marker and the pickup.
    Found by rendering this document in a browser and measuring the elements,
    not by a test; taking the label out of the flow is the same fix the
    vehicle marker below needed for the same reason.

    **absolute here rather than relative, and it is load-bearing.**
    Leaflet's own stylesheet sets position:absolute on every marker root and
    positions it with a transform, exactly as MapLibre did before it. This
    inline block is parsed after that stylesheet, so declaring relative at the
    same specificity *wins* and drops the marker back into normal flow — the
    vehicle rendered 52 px below the road it was driving on. Mirroring the
    library's declaration keeps the root a containing block for the label
    without fighting it for the property it positions with. (Measured in a
    browser; the map is unchanged and the marker is simply somewhere else,
    which is the kind of wrong no assertion over an HTML string can see.)
  */
  .marker { position: absolute; top: 0; left: 0; width: 26px; height: 26px; }
  .marker .tag { position: absolute; left: 32px; top: 50%; transform: translateY(-50%); }
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
  /*
    The driver, drawn as the vehicle they are driving rather than as a dot.
    The console made this decision first — see vehicleSprites.ts — and the
    size lives here because how big a marker is belongs to the map, not to
    the vehicle.
  */
  .unit { position: absolute; top: 0; left: 0; width: 46px; height: 46px; }
  /*
    A white disc under the vehicle.

    The sedan is a pale silhouette and read perfectly well on its own. The
    boda does not: its rider is drawn in the brand green, and this marker sits
    *on* the brand-green route by design — so a rider, on the one screen a
    rider looks at, merged into the road. Seen by rendering the boda document
    in a browser, not by reasoning about it.

    A disc is also what the reference the owner sent does (a marker inside a
    white circle), and it fixes the general case rather than that one sprite:
    any silhouette, over any line colour, stays a separate object. It does not
    rotate — only the vehicle inside it turns.
  */
  .unit .puck {
    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
    border-radius: 50%; background: ${colors.surface};
    box-shadow: 0 1px 4px ${colors.scrim};
  }
  /* The rotating wrapper. The library owns the marker root's transform for
     positioning, so anything that turns goes on an inner element; the same
     rule fleetMap.css states on the console side, and writing to the root
     fights the library. */
  .unit .turn { position: absolute; top: 6px; left: 6px; right: 6px; bottom: 6px; transform-origin: 50% 50%; }
  .unit svg { display: block; width: 100%; height: 100%; }
  /* Hung underneath rather than laid beside. The pins above are flex rows, so
     a library centres the *row* on the coordinate and the dot sits to the
     left of it — harmless for a dot, wrong for a vehicle, which has to sit on
     the road it is driving. Taking the label out of the flow leaves the
     sprite centred on the fix. */
  .unit .tag { position: absolute; top: 52px; left: 50%; transform: translateX(-50%); }`,
    script: `
  var PICKUP = ${JSON.stringify([pickup.lng, pickup.lat])};
  var DROPOFF = ${dropoff === null ? 'null' : JSON.stringify([dropoff.lng, dropoff.lat])};

  // The driver's own silhouette, inlined rather than fetched: this document
  // has no asset pipeline in front of it, which is exactly what keeps it
  // drawing where there is no signal. Exactly one sprite is ever inlined, so
  // the shared gradient ids inside them cannot collide.
  var VEHICLE = ${JSON.stringify(VEHICLE_SPRITES[vehicle])};

  // Which corner the screen has floated a stat badge over, if any.
  var OVERLAY = ${JSON.stringify(overlay)};

  /**
   * Framing padding, widened on whichever side is covered.
   *
   * Only the *side*, never the bottom, and that is the point. The badge is
   * anchored to a corner, so keeping every pin out of that vertical strip
   * clears it whatever height the badge happens to be — whereas padding the
   * bottom too would eat half of a 220pt map to solve the same problem twice.
   */
  function pad(base) {
    /*
      Every pin carries its name to its *right* — the .marker flex row is the
      pin then the tag — and fitBounds only knows about the point. So a
      destination framed to the pixel puts its own label off the edge of the
      screen, which is what "Drop-off" did: rendered at 393 CSS px wide, the
      pill ended at 393.7.

      It was survivable while the camera re-fitted every hundred metres and
      the clipping moved around. Framing the whole leg makes the drop-off's
      place on screen fixed for the length of the trip, so it would have been
      clipped from the kerb to the door.
    */
    var label = 84;
    var room = base + 110;

    return {
      top: base,
      bottom: base,
      left: OVERLAY === 'bottom-left' ? room : base,
      right: OVERLAY === 'bottom-right' ? room : base + label
    };
  }

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

      // Longitude first: GeoJSON's order and the server's, and the opposite
      // of the lat/lng every other part of this app says. Uganda sits near
      // the equator, so a swap here passes every range check and draws the
      // route in the Indian Ocean. The shell's ll() turns it round for the
      // library, once, where it is drawn.
      points.push([lng / 1e5, lat / 1e5]);
    }

    return points;
  }

  // The geometries the camera last framed, so a re-send of the same one —
  // every position tick re-injects the whole state — never moves the camera.
  var framedRoute = null;
  var framedLeg = null;
  var hereMarker = null;
  var hereTurn = null;

  /*
    The lines, bottom to top, added in that order because that is the order
    the library stacks them. The whole leg first and quietest: what stays
    visible of it is the road already driven, the only thing on this map that
    answers "how far through am I", and it must not compete with where the
    driver is going. Then the live road — a casing underneath, then the line,
    because a single stroke over a pale basemap loses its edge against the
    road it is drawn on and the darker casing is what keeps it readable in
    sunlight, which is the condition this app is designed for. Then the
    dashed direct legs. The markers sit above every line on their own pane.

    The road is solid and the leg is dashed, and the difference is the claim:
    this one followed a road; that one did not.
  */
  var legRouteLine = L.polyline([], {
    // The same width as the live road's core, so the green covers this
    // exactly where the two coincide and leaves it showing where they do
    // not. DESIGN.md's neutral — the palette's own "closed" tone, which is
    // what a stretch of road behind you is. Muted, but not so muted it
    // disappears in Kampala sun: at 0.55 this was a suggestion of a road;
    // 0.7 is a road somebody has driven.
    color: '${colors.textMuted}', weight: 5, opacity: 0.7,
    lineCap: 'round', lineJoin: 'round', interactive: false
  }).addTo(map);
  var routeCasing = L.polyline([], {
    color: '${colors.primaryPressed}', weight: 9, opacity: 0.55,
    lineCap: 'round', lineJoin: 'round', interactive: false
  }).addTo(map);
  var routeLine = L.polyline([], {
    color: '${colors.primary}', weight: 5,
    lineCap: 'round', lineJoin: 'round', interactive: false
  }).addTo(map);
  var legsLayer = L.layerGroup().addTo(map);

  function setLine(line, coordinates) {
    line.setLatLngs(coordinates.map(ll));
  }

  function frameOn(coordinates, animate) {
    // Framed on the line rather than on the pins: a road that loops around a
    // lake leaves the box the two endpoints would have drawn. Animated on an
    // update — a camera that teleports under a driver's eyes reads as the map
    // breaking; the first frame, before the page is visible, snaps.
    fitPadded(coordinates.map(ll), pad(44), animate);
  }

  /**
   * Both roads, and which of them the camera belongs to.
   *
   * **The whole leg wins the camera, and wins it once.** This is the fix the
   * legPolyline prop exists for: framing the *remaining* road re-fitted the
   * view every hundred metres, so the road still to drive always filled the
   * screen and a driver could not tell a job nearly finished from one just
   * begun. Pinned to the whole journey instead, the frame holds still and the
   * vehicle visibly crosses it — which is what reads as progress. Nothing
   * else here had to change for that; it was the fitting that was wrong.
   *
   * The leg is refit only when its own geometry changes, which happens when a
   * stop is added and not otherwise.
   */
  function applyRoutes(state) {
    var road = state.route === null ? [] : decodePolyline(state.route);
    var whole = state.legRoute === null ? [] : decodePolyline(state.legRoute);

    setLine(routeCasing, road);
    setLine(routeLine, road);
    setLine(legRouteLine, whole);

    if (whole.length > 1) {
      if (state.legRoute !== framedLeg) {
        frameOn(whole, framedLeg !== null);
        framedLeg = state.legRoute;
      }

      // Claimed rather than left null, so the branch below can never re-frame
      // on the shrinking road drawn on top of this one.
      framedRoute = state.route;

      return;
    }

    if (road.length > 1 && state.route !== framedRoute) {
      frameOn(road, framedRoute !== null);
      framedRoute = state.route;
    }
  }

  /**
   * The one leg the driver is on, as a straight line.
   *
   * Dashed, and that is the whole argument: this is a direct line between
   * two points and not a road. A dashed line is the map convention for "as
   * the crow flies" — it joins the dots so the relationship between them is
   * legible at a glance, without ever looking like a road to take.
   *
   * A real road wins outright: when a route exists no leg is drawn, because
   * a measured line and a guess on one map are two lines a driver cannot
   * tell apart.
   *
   * **Never both legs, and never the other one.** state.leg says which half
   * of the job this map is for, and a map for the approach draws nothing at
   * all rather than falling through to the passenger's journey — see the
   * leg prop's docblock for the bug that rule exists to close.
   *
   * (No backticks in here. This function lives inside a template literal, and
   * one of them ends the document mid-sentence.)
   */
  function legFeatures(state) {
    if (state.route !== null || state.legRoute !== null) { return []; }

    var legs = [];

    if (state.leg === 'approach') {
      // No fix, no line. The approach is *from the driver*, so without a
      // position there is nothing honest to draw — and the fare leg, which
      // is the only other line available, answers a question this screen is
      // not asking.
      if (state.here !== null) {
        legs.push({ from: state.here, to: PICKUP, tone: 'approach' });
      }
    } else if (DROPOFF !== null) {
      // Once the driver has a fix on the fare leg they are *on* it, so it is
      // drawn from where they actually are rather than from a kerb they left.
      legs.push({ from: state.here === null ? PICKUP : state.here, to: DROPOFF, tone: 'fare' });
    }

    return legs;
  }

  function addLegs(legs) {
    legsLayer.clearLayers();

    legs.forEach(function (item) {
      L.polyline([ll(item.from), ll(item.to)], {
        // The leg being driven is the brand green; anything beyond it is
        // muted. Red belongs to the drop-off *pin* — a red line on a road
        // somebody is actively driving reads as a warning, which is how the
        // first version of this looked on a handset.
        color: item.tone === 'approach' ? '${colors.primary}' : '${colors.borderStrong}',
        weight: 4, opacity: 0.9,
        // Dashes, never a solid stroke: see legFeatures above. This is a
        // direct line, and it has to keep saying so at every zoom.
        dashArray: '6 6',
        lineCap: 'round', lineJoin: 'round', interactive: false
      }).addTo(legsLayer);
    });
  }

  function addMarker(lngLat, className, label) {
    var icon = L.divIcon({
      className: 'marker ' + className,
      html: '<span class="pin"><i></i></span><span class="tag"></span>',
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });
    var marker = L.marker(ll(lngLat), { icon: icon, interactive: false }).addTo(map);

    // The dot and its name travel together. Three coloured circles on a map
    // are three coloured circles; the words are what make them a pickup, a
    // drop-off and a driver.
    marker.getElement().querySelector('.tag').textContent = label;

    return marker;
  }

  /**
   * Which way the vehicle points.
   *
   * On the inner element, never on the marker root — the library owns that
   * one. **No rotation at all when the handset reported no bearing**, which
   * is the ordinary answer at a standstill: an unrotated sprite points north,
   * which reads as an icon, where a guessed angle would read as a course.
   */
  function pointVehicle(heading) {
    hereTurn.style.transform = heading === null ? '' : 'rotate(' + heading + 'deg)';
  }

  function setHere(state) {
    var lngLat = state.here;
    var hasRoute = state.route !== null || state.legRoute !== null;

    if (lngLat === null) {
      if (hereMarker !== null) { hereMarker.remove(); hereMarker = null; hereTurn = null; }
      return;
    }

    if (hereMarker !== null) {
      // The whole point of injecting instead of reloading: a position tick is
      // one vehicle gliding, not a page rebuilding.
      hereMarker.setLatLng(ll(lngLat));
      pointVehicle(state.heading);
      return;
    }

    var unit = L.divIcon({
      className: 'unit',
      html: '<span class="puck"></span><span class="turn">' + VEHICLE + '</span><span class="tag"></span>',
      iconSize: [46, 46],
      iconAnchor: [23, 23]
    });

    // Above the two pins, as the vehicle was when it was added last.
    hereMarker = L.marker(ll(lngLat), { icon: unit, interactive: false, zIndexOffset: 1000 }).addTo(map);

    var el = hereMarker.getElement();
    // Drawn *and* named. A silhouette says "a vehicle"; the word is what says
    // it is this driver, beside a pickup and a drop-off that are both labelled
    // too. docs/screen-rules.md 6: meaning never rests on the picture alone.
    el.querySelector('.tag').textContent = 'You';
    hereTurn = el.querySelector('.turn');
    pointVehicle(state.heading);

    if (!hasRoute) {
      // The first fix after load, on a map framed without it: widen to take
      // the driver in, once. Position ticks after this move only the marker —
      // a camera that chases every tick is the shake this file was rebuilt
      // to remove.
      var all = [PICKUP].concat(DROPOFF === null ? [] : [DROPOFF]).concat([lngLat]);
      fitPadded(all.map(ll), pad(28), true);
    }
  }

  addMarker(PICKUP, 'pickup', 'Pickup');
  if (DROPOFF !== null) { addMarker(DROPOFF, 'dropoff', 'Drop-off'); }

  ${
    bounds === null
      ? ''
      : `if (${JSON.stringify(initial.route)} === null && ${JSON.stringify(initial.legRoute)} === null) { fitPadded(${JSON.stringify(bounds)}, pad(28), false); }`
  }

  function applyState(state) {
    applyRoutes(state);
    addLegs(legFeatures(state));
    setHere(state);
  }

  // The one entry point React Native injects into. A raster map is ready the
  // moment it is built, so there is nothing to park: the opening state is
  // applied now, and onLoadEnd on the native side replays it in case the
  // injection raced the parse.
  window.__applyState = applyState;

  applyState(${JSON.stringify(initial)});`,
  });
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
