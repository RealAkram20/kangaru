import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { Trip } from '../api/types';
import { TripMapScreen } from './TripMapScreen';

/**
 * That the full-screen map mounts, and points at the right end of the job.
 *
 * The one rule with teeth here is which place it sends the driver to: before
 * the passenger is aboard that is the pickup, and after it is the drop-off.
 * Getting it backwards sends a driver to a kerb they already left.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

const mockUseTrip = jest.fn();
const mockPosition = jest.fn();
const mockUseTripRoute = jest.fn();
const mockOpenDirections = jest.fn();

jest.mock('../trips/queries', () => ({
  useTrip: (id: number) => mockUseTrip(id),
  // The arguments are forwarded, not swallowed. Which *leg* this screen asks
  // for is the assertion two tests below exist to make, and a mock that drops
  // its arguments is how the wrong leg shipped: every visible thing on the
  // screen respected `boarded` except the request that drew the road.
  useTripRoute: (...args: unknown[]) => mockUseTripRoute(...args),
}));
jest.mock('../location/usePosition', () => ({ usePosition: () => mockPosition() }));
jest.mock('../trips/directions', () => ({
  openDirections: (...args: unknown[]) => mockOpenDirections(...args),
}));

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 42,
    tenant_id: null,
    customer_id: 9,
    booking_id: null,
    vehicle_id: 7,
    driver_id: 3,
    origin: 'Acacia Mall',
    destination: 'Kololo Airstrip',
    pickup: { label: 'Acacia Mall', latitude: 0.3346, longitude: 32.5906 },
    dropoff: { label: 'Kololo Airstrip', latitude: 0.3268, longitude: 32.6011 },
    service_type: 'ride',
    reference: null,
    package: null,
    status: 'trip_started',
    allowed_transitions: ['waiting', 'trip_completed'],
    pickup_wait_target_seconds: 300,
    odometer_max_km_per_trip: 2000,
    payment: null,
    odometer_start: null,
    odometer_end: null,
    odometer_start_photo_url: null,
    odometer_end_photo_url: null,
    distance_km: null,
    gps_distance_km: null,
    distance_variance_flagged: null,
    unplanned_stop_count: 0,
    started_at: null,
    completed_at: null,
    duration_minutes: null,
    fare: null,
    estimated_fare: null,
    passenger_contact: null,
    earnings: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

async function renderMap(value: Trip = trip()) {
  mockUseTrip.mockReturnValue({ data: value, isLoading: false });
  mockPosition.mockReturnValue({ lat: 0.3532, lng: 32.5825 });

  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <TripMapScreen
        route={{ key: 'm', name: 'TripMap', params: { tripId: value.id } }}
        navigation={{ navigate: jest.fn(), goBack: jest.fn() } as never}
      />
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  mockOpenDirections.mockClear();
  // Cleared, not merely re-stubbed. `mockReturnValue` leaves the call log
  // alone, and the leg assertions below read that log — without this they
  // pass on a call some earlier test made.
  mockUseTripRoute.mockClear();
  mockUseTrip.mockClear();
  // No route by default — the state this app ships in, with no key
  // configured. Set here rather than inside the render helper, which would
  // overwrite whatever a test had just asked for.
  mockUseTripRoute.mockReturnValue({ data: null });
});

it('points at the drop-off once the passenger is aboard', async () => {
  const { getByText } = await renderMap();

  expect(getByText('Drop-off')).toBeTruthy();
  expect(getByText('Kololo Airstrip')).toBeTruthy();
});

it('points at the pickup before the passenger is aboard', async () => {
  // Sending a driver to a kerb they already left is the kind of small
  // wrongness that makes an app feel like it is not paying attention.
  const { getByText } = await renderMap(trip({ status: 'driver_en_route' }));

  expect(getByText('Pickup')).toBeTruthy();
  expect(getByText('Acacia Mall')).toBeTruthy();
});

it('still says the distance is a straight line, not a road', async () => {
  const { getByText } = await renderMap();

  expect(getByText('straight line — not the road distance')).toBeTruthy();
});

it('keeps the hand-off to a real maps app, as a choice rather than the only door', async () => {
  const { getByLabelText } = await renderMap();

  void fireEvent.press(getByLabelText('Open in Maps'));

  expect(mockOpenDirections).toHaveBeenCalledWith(
    { lat: 0.3268, lng: 32.6011 },
    'Kololo Airstrip',
  );
});

it('offers no hand-off for a trip with no coordinates', async () => {
  const { queryByLabelText } = await renderMap(
    trip({ dropoff: { label: 'Kololo Airstrip', latitude: null, longitude: null } }),
  );

  expect(queryByLabelText('Open in Maps')).toBeNull();
});

/** The HTML handed to the WebView, dug out of the rendered tree. */
function mapHtml(tree: unknown): string {
  let found = '';

  const walk = (node: unknown): void => {
    const n = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown[] };

    if (typeof n !== 'object' || n === null) {
      return;
    }

    if (n.type === 'WebView') {
      const source = n.props?.source as { html?: string } | undefined;
      found = source?.html ?? '';
    }

    for (const child of n.children ?? []) {
      walk(child);
    }
  };

  walk(tree);

  return found;
}

it('names every marker, rather than leaving three coloured dots', async () => {
  // The complaint that produced this: "we cannot see where we are and where we
  // are going". All three points were on screen the whole time — as a green
  // ring, a red dot and a blue dot, with nothing saying which was which.
  // `docs/screen-rules.md` §6 forbids meaning by colour alone, and the
  // full-screen map has no rail beneath it to name the ends in words.
  const view = await renderMap();
  const html = mapHtml(view.toJSON());

  expect(html).toContain("'Pickup'");
  expect(html).toContain("'Drop-off'");
  expect(html).toContain("'You'");

  // The words reaching the document is not the same as the document drawing
  // them, and Jest does not execute the WebView — so the mechanism is pinned
  // too. Written after a mutation survived: deleting the line that writes the
  // label into the element left the three strings sitting in the HTML as
  // arguments to a call that no longer used them, and the assertions above
  // passed happily.
  expect(html).toContain('class="tag"');
  expect(html).toContain('textContent = label');
});

it('lets the driver pan and zoom when the map has the whole screen', async () => {
  // `interactive: false` is right for the 220pt panel — it sits in a
  // ScrollView and a pannable map swallows the drag meant to scroll the page.
  // On a full screen it meant a driver could not zoom in to see anything.
  const view = await renderMap();

  expect(mapHtml(view.toJSON())).toContain('interactive: true');
});

it('joins the points with a dashed line, never a solid one', async () => {
  // The interim until Google Directions lands, and the fallback for ever
  // after: Directions needs a network, and this app is built for a country
  // where a driver loses signal for whole stretches of a trip.
  //
  // Dashed is the map convention for "as the crow flies". A solid line is the
  // thing the standing rule forbids — something a driver would follow — and
  // the dash is what keeps this from becoming that.
  const view = await renderMap();
  const html = mapHtml(view.toJSON());

  expect(html).toContain("'line-dasharray'");
  expect(html).toContain('LineString');
});

// ── The real road, when there is one ──────────────────────────────────────

const ROAD = {
  polyline: 'a~l~Fjk~uOwHJy@P',
  distance_km: 6.1,
  duration_seconds: 780,
  provider: 'google' as const,
  is_estimate: true as const,
}

it('draws the road and drops the direct line when a route exists', async () => {
  // Never both. A measured road and a crow's-flight guess on one map is two
  // lines a driver cannot tell apart.
  mockUseTripRoute.mockReturnValue({ data: ROAD })

  const view = await renderMap();
  const html = mapHtml(view.toJSON());

  expect(html).toContain('applyRoutes(');
  expect(html).toContain(ROAD.polyline);

  // The dash *styling* is always in the document — it is a paint block in a
  // function definition. The legs themselves are now derived inside the page
  // (`legFeatures`), because position ticks are injected rather than
  // rebuilding the document — so what is pinned is the guard that derivation
  // hangs every leg on. Deleting this one early return puts a dashed guess
  // under a measured road.
  expect(html).toContain(
    'if (state.route !== null || state.legRoute !== null) { return []; }',
  );
});

// ── Which leg, which is the whole question ────────────────────────────────

it('asks for the road to the passenger before they are aboard', async () => {
  // The bug this pins. The header said "Pickup", the target pin was the
  // pickup and "Open in Maps" opened the pickup — while the drawn road and
  // the by-road distance were the *fare*, because the route request took the
  // default leg. On a real order that was 7.3 km of approach rendered as
  // 71.0 km of somebody else's journey.
  await renderMap(trip({ status: 'driver_en_route' }));

  expect(mockUseTripRoute).toHaveBeenCalledWith(42, expect.anything(), 'pickup', true);
});

it('switches to the road the passenger paid for once they are aboard', async () => {
  await renderMap();

  expect(mockUseTripRoute).toHaveBeenCalledWith(42, expect.anything(), 'dropoff', true);
});

it('asks nothing at all until it knows which leg it is asking about', async () => {
  // The leg is read off the trip's status, and on a cold open there is no
  // cached trip to read. Firing anyway would ask for the approach and then
  // ask again for the fare a tick later: two requests, one of them a guess,
  // and Directions bills per request.
  mockUseTrip.mockReturnValue({ data: undefined, isLoading: true });
  mockPosition.mockReturnValue({ lat: 0.3532, lng: 32.5825 });

  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <TripMapScreen
        route={{ key: 'm', name: 'TripMap', params: { tripId: 42 } }}
        navigation={{ navigate: jest.fn(), goBack: jest.fn() } as never}
      />
    </SafeAreaProvider>,
  );

  expect(mockUseTripRoute).toHaveBeenCalledWith(42, expect.anything(), 'pickup', false);
});

it('never draws the passenger journey on the way to the passenger', async () => {
  // With no route and no fix there is nothing honest to draw for the
  // approach, and the map draws nothing — rather than falling through to the
  // one line it does have, which answers a question this screen is not
  // asking. The owner: "i should be seeing where the client is and where i am
  // going".
  mockPosition.mockReturnValue(null);
  mockUseTrip.mockReturnValue({ data: trip({ status: 'driver_en_route' }), isLoading: false });

  const view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <TripMapScreen
        route={{ key: 'm', name: 'TripMap', params: { tripId: 42 } }}
        navigation={{ navigate: jest.fn(), goBack: jest.fn() } as never}
      />
    </SafeAreaProvider>,
  );

  const html = mapHtml(view.toJSON());

  // The seed state the document opens with, and the branch it takes: an
  // approach map with no fix produces no legs at all.
  expect(html).toContain('"leg":"approach"');
  expect(html).toContain("if (state.leg === 'approach')");
  expect(html).toContain('if (state.here !== null)');
});

it('states the road distance, not the straight line, once routed', async () => {
  // The road ahead only, and no whole leg — so this figure is the only one on
  // the card. Stated explicitly rather than left to a mock that answers both
  // questions the same way, which would put "6.1 km" on screen twice and make
  // the assertion below ambiguous about which of them it found.
  routes({ road: ROAD, leg: null });

  const { getByText, queryByText } = await renderMap();

  expect(getByText('6.1 km')).toBeTruthy();
  expect(queryByText(/straight line/)).toBeNull();
});

it('shows minutes only because the provider sent them', async () => {
  mockUseTripRoute.mockReturnValue({ data: ROAD });

  const { getByText } = await renderMap();

  expect(getByText('by road · about 13 min')).toBeTruthy();
});

it('shows no minutes at all when the provider sent none', async () => {
  // ADR-0031 §6, and the half of ADR-0020 §3 that is not lifted: the app never
  // derives a duration, whatever distance it is holding.
  mockUseTripRoute.mockReturnValue({ data: { ...ROAD, duration_seconds: null } });

  const { getByText, queryByText } = await renderMap();

  expect(getByText('by road')).toBeTruthy();
  expect(queryByText(/min/)).toBeNull();
});

it('frames the pins clear of a badge floated over the map', async () => {
  // The owner's handset, mid-trip: the stat card sat on top of the drop-off
  // marker it was describing. The badge is a deliberate design and does not
  // move — what was wrong is that the map framed its pins into space the badge
  // occupies. Padding one *side* rather than the bottom clears a
  // corner-anchored card whatever height it happens to be, without eating half
  // of a 220pt map to do it.
  const view = await renderMap();
  const html = mapHtml(view.toJSON());

  // Every camera move goes through it — the route fit, the first-fix widen,
  // and the opening frame. A `padding: 28` left behind anywhere is a corner
  // that still collides.
  expect(html).toContain('function pad(base)');
  expect(html).not.toMatch(/padding: \d+,/);

  // The full-screen map floats nothing, so it pays nothing for the badge.
  expect(html).toContain('var OVERLAY = null;');

  // It still pays for the *labels*, and that is a separate debt. Every pin
  // carries its name to its right, and `fitBounds` only knows about the
  // point — so a drop-off framed to the pixel pushes its own pill off the
  // edge, which is exactly what it did: 393.7 px of label in a 393 px
  // viewport. Survivable while the camera re-fitted every hundred metres and
  // the clipping moved; permanent once the frame holds still on the whole
  // leg, which is why it is fixed here rather than noted.
  expect(html).toContain('var label = 84;');
  expect(html).toContain("right: OVERLAY === 'bottom-right' ? room : base + label");
});

// ── The whole route, and where the driver is on it ────────────────────────
//
// The owner, from a handset: "the driver can not see where he is from the
// entire route so they find it hard to tell the progress visually". Two
// things caused that and both are pinned below — the map only ever held the
// road *ahead*, and the camera re-fitted itself to that road every hundred
// metres, so it filled the screen at every stage of every job.

/** The whole leg — from the pickup, and longer than what is left of it. */
const WHOLE_LEG = {
  polyline: 'wzl~F|k~uOaBcAoC_BsDkB',
  distance_km: 12.2,
  duration_seconds: 1500,
  provider: 'osrm' as const,
  is_estimate: true as const,
};

/**
 * Two different answers for two different questions.
 *
 * The screen asks twice — once from the driver's own fix for the road ahead,
 * once with **no origin at all** for the whole leg — and a mock returning one
 * value for both would make every assertion below meaningless. The `from`
 * argument is what tells them apart, which is also exactly what makes the
 * whole-leg request cacheable.
 */
function routes({ road, leg }: { road: unknown; leg: unknown }) {
  mockUseTripRoute.mockImplementation((_id: number, from: unknown) => ({
    data: from === null ? leg : road,
  }));
}

it('asks for the whole leg with no origin, so the answer is cacheable', async () => {
  routes({ road: ROAD, leg: WHOLE_LEG });

  await renderMap();

  // No position in the arguments means no position in the query key, which is
  // what makes this one request per trip rather than one per hundred metres —
  // and it is byte for byte the request the waiting screen already made, so
  // on the ordinary flow it is answered from cache. ADR-0031 §5 is why that
  // sentence is worth a test: Directions bills per request.
  expect(mockUseTripRoute).toHaveBeenCalledWith(42, null, 'dropoff', true);
});

it('does not ask for a whole leg on the way to the passenger', async () => {
  // The approach has no whole road. Its origin is wherever the driver was
  // when they accepted, which this platform does not record — so there is
  // nothing to measure against, and asking would spend a request to find that
  // out.
  routes({ road: ROAD, leg: WHOLE_LEG });

  await renderMap(trip({ status: 'driver_en_route' }));

  expect(mockUseTripRoute).toHaveBeenCalledWith(42, null, 'dropoff', false);
});

it('stops measuring progress once the circuit has left the pickup behind', async () => {
  // The bank case: five ATMs, one driver. After the first is worked the leg
  // runs stop to stop, so a road measured *from the pickup* is a different
  // journey — and on a circuit whose second stop is near the branch it
  // started from, comparing them reads as negative progress on a driver who
  // has done most of the work.
  routes({ road: ROAD, leg: WHOLE_LEG });

  await renderMap(
    trip({
      stops: [
        {
          id: 1,
          sequence: 1,
          label: 'Centenary Bank, Kabalagala',
          latitude: 0.3,
          longitude: 32.6,
          source: 'planned',
          status: 'done',
          arrived_at: null,
          departed_at: null,
          skip_reason: null,
          client_place_id: null,
        },
      ],
    }),
  );

  expect(mockUseTripRoute).toHaveBeenCalledWith(42, null, 'dropoff', false);
});

it('shows no whole-leg figure mid-circuit even when the cache still holds one', async () => {
  /*
    The outcome, not the mechanism — and the distinction is a bug this suite
    shipped. The test above asserts the *request* is withheld, which it was,
    and that is not the same as the figure being withheld: a disabled
    `useQuery` still returns whatever its key already holds, and
    `WaitingForPassengerScreen` warms this exact key on every job.

    So `routes()` here answers regardless of the enabled flag, which is what a
    warm cache does. On the emulator this rendered **83.8 km to go, of
    69.4 km** — the remaining road longer than the whole journey it was being
    compared against, on a Jinja circuit whose first stop was already worked.
  */
  routes({ road: ROAD, leg: WHOLE_LEG });

  const { getByText, queryByText } = await renderMap(
    trip({
      stops: [
        {
          id: 1,
          sequence: 1,
          label: 'Jinja Main Market',
          latitude: 0.44,
          longitude: 33.2,
          source: 'planned',
          status: 'done',
          arrived_at: null,
          departed_at: null,
          skip_reason: null,
          client_place_id: null,
        },
      ],
    }),
  );

  // The road ahead is still stated — that one is measured from where the
  // driver actually is and is true whatever the circuit has done.
  expect(getByText('6.1 km')).toBeTruthy();

  // The whole-leg total, and therefore the bar, are gone.
  expect(queryByText('12.2 km')).toBeNull();
  expect(queryByText(/of 12\.2 km/)).toBeNull();
});

it('holds the camera on the whole leg instead of chasing the road ahead', async () => {
  // **This is the fix.** `fitBounds` on the remaining road fired on every
  // changed geometry — which is every ~100 m of movement — so the road left
  // always filled the screen and ten per cent through a job looked like
  // ninety. Framed on a line that does not move, the vehicle crosses it.
  routes({ road: ROAD, leg: WHOLE_LEG });

  const view = await renderMap();
  const html = mapHtml(view.toJSON());

  // The branch, and the guard that makes it fire once rather than per tick.
  expect(html).toContain('if (whole.length > 1) {');
  expect(html).toContain('if (state.legRoute !== framedLeg) {');
  // And the claim that stops the shrinking road re-framing underneath it.
  expect(html).toContain('framedRoute = state.route;');
});

it('draws the road already driven, so there is something to be part-way along', async () => {
  routes({ road: ROAD, leg: WHOLE_LEG });

  const view = await renderMap();
  const html = mapHtml(view.toJSON());

  // Both geometries reach the page: the whole leg underneath, the road still
  // to drive on top of it. What stays visible of the first is the part the
  // second no longer covers, which is the road behind the driver.
  expect(html).toContain(WHOLE_LEG.polyline);
  expect(html).toContain(ROAD.polyline);
  expect(html).toContain("id: 'leg-route'");
  // Under the live road, never over it — a covered road drawn on top of the
  // one still to drive would hide the half that matters.
  expect(html.indexOf("id: 'leg-route'")).toBeLessThan(html.indexOf("id: 'route-casing'"));
});

it('draws the driver as the vehicle they are actually in', async () => {
  // The console made this decision first, after the owner read a coloured dot
  // as "a dot where the vehicle should be". The driver app kept the dot.
  routes({ road: ROAD, leg: WHOLE_LEG });

  const view = await renderMap(
    trip({
      vehicle: {
        id: 7,
        registration_number: 'UBK 123A',
        make: null,
        model: null,
        category: 'boda',
      },
    }),
  );
  const html = mapHtml(view.toJSON());

  expect(html).toContain('boda boda with rider');
  expect(html).not.toContain('four-door sedan');
  // The silhouette is not the whole marker: the word is still there, because
  // §6 does not let meaning rest on a picture any more than on a colour.
  expect(html).toContain("'You'");
});

it('falls back to a generic car rather than nothing when the category is unknown', async () => {
  // A walk-in trip whose vehicle never loaded, or a category added to the
  // office's table after this build shipped. `spriteFor`'s own fallback, and
  // the server's.
  routes({ road: ROAD, leg: WHOLE_LEG });

  const view = await renderMap();

  expect(mapHtml(view.toJSON())).toContain('four-door sedan');
});

it('points the vehicle where the handset says, and nowhere when it does not', async () => {
  routes({ road: ROAD, leg: WHOLE_LEG });

  const view = await renderMap();
  const html = mapHtml(view.toJSON());

  // Rotation on the inner element — MapLibre owns the marker root's transform
  // — and no rotation at all without a bearing. An unrotated sprite points
  // north, which reads as an icon; a guessed angle would read as a course.
  expect(html).toContain(
    "hereTurn.style.transform = heading === null ? '' : 'rotate(' + heading + 'deg)';",
  );
});

it('states how far through the drive is, from two measured roads', async () => {
  routes({ road: ROAD, leg: WHOLE_LEG });

  const { getByText } = await renderMap();

  // What is left, big; the whole leg at the far end of the bar, because that
  // is where the journey ends. Without a stated total, a bar is something
  // filling at a rate somebody chose.
  expect(getByText('6.1 km')).toBeTruthy();
  expect(getByText('12.2 km')).toBeTruthy();
});

it('speaks both distances rather than a percentage', async () => {
  routes({ road: ROAD, leg: WHOLE_LEG });

  const { getByLabelText } = await renderMap();

  // One sentence for the whole card: a headline, a bar and a caption
  // linearise into three fragments, and the bar into nothing at all.
  expect(
    getByLabelText('6.1 km to go of 12.2 km by road. About 13 minutes, estimated.'),
  ).toBeTruthy();
});

it('draws no bar at all when the whole leg was never measured', async () => {
  // The ordinary case with routing off, and the corporate circuit whose trip
  // has no order request to route from. An empty bar would say "no progress";
  // no bar says "nobody measured this", which is what has happened.
  routes({ road: ROAD, leg: null });

  const { getByText, queryByText } = await renderMap();

  expect(getByText('6.1 km')).toBeTruthy();
  expect(queryByText('12.2 km')).toBeNull();
});

it('leaves MapLibre owning where every marker sits', async () => {
  // The bug this pins cost two renders to find and no assertion could see.
  //
  // MapLibre's own stylesheet sets `position: absolute` on each marker root
  // and then positions it with a transform. Sizing the roots so a pin sits on
  // its coordinate meant giving them a box — and declaring `position:
  // relative` to hang the label off. That inline `<style>` is parsed *after*
  // the MapLibre link, so at equal specificity it won: the roots dropped back
  // into normal flow and the vehicle rendered 52 px away from the road it was
  // driving on, on a map that was otherwise perfect.
  //
  // Nothing in an HTML string says that. It is only visible by rendering the
  // document in a browser and measuring the elements, which is how it was
  // found — so the rule is pinned here to stop it coming back.
  const view = await renderMap();
  const html = mapHtml(view.toJSON());

  expect(html).toContain('.marker { position: absolute; top: 0; left: 0;');
  expect(html).toContain('.unit { position: absolute; top: 0; left: 0;');
  expect(html).not.toMatch(/\.(marker|unit) \{ position: relative/);
});
