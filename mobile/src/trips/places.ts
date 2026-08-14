import type { Coordinates, TripPlace } from '../api/types';

/**
 * Places, and the distance between them.
 *
 * A module of pure functions over injected values rather than helpers inside
 * a screen, for the reason `jest.setup.ts` gives: these are the parts that can
 * be *wrong* rather than merely ugly, and a component test would have to
 * render and flush to reach them. Everything here is arithmetic and a type
 * guard, and both are worth trusting.
 */

/**
 * A place with both coordinates, narrowed so the pair can be used together.
 *
 * **Both or neither, and the guard exists because "neither" is the common
 * case.** A trip taken over the phone has no coordinates at all, and a
 * corporate trip never has any. A screen that read `latitude ?? 0` would put
 * a Kampala vehicle at 0°N 0°E — in the Atlantic off Ghana, which is exactly
 * where ADR-0020 records a latitude/longitude swap landing one for real.
 * There is no "partially located" state to handle: the server sends both or
 * sends neither (`TripResource::place`), and this refuses to invent the half
 * that is missing.
 */
export type LocatedPlace = TripPlace & { latitude: number; longitude: number };

export function located(place: TripPlace | null | undefined): place is LocatedPlace {
  return (
    place !== null &&
    place !== undefined &&
    typeof place.latitude === 'number' &&
    typeof place.longitude === 'number' &&
    Number.isFinite(place.latitude) &&
    Number.isFinite(place.longitude)
  );
}

const EARTH_RADIUS_KM = 6371;

/**
 * Straight-line kilometres between two points.
 *
 * The same great circle the server ranks offers on (`GreatCircle::kilometres`,
 * ADR-0020 §3) and the same one the tariff estimates from (ADR-0026 §2), so
 * the figure a driver sees here cannot disagree with the one that was on the
 * offer card.
 *
 * **It is not a road distance and must never be divided by an assumed speed
 * to produce an ETA.** ADR-0020 §3 declined to derive minutes from a straight
 * line by name: real roads are longer than the crow's flight, so this
 * under-reads, and the invented minute figure is the one that would have to be
 * defended to a passenger left waiting. `PickupScreen` says "straight line" on
 * the screen for the same reason.
 *
 * Computed on the handset rather than served, and that is deliberate: the
 * distance is from *where the driver is now*, which changes every few seconds
 * while they drive. A server-rendered figure would be stale the moment it
 * arrived.
 */
export function greatCircleKm(from: Coordinates, to: Coordinates): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(dLng / 2) ** 2;

  // `atan2`, not `asin`. The two agree everywhere a taxi goes, and atan2 stays
  // stable at antipodal points where floating point pushes `a` a hair above 1
  // and `asin` returns NaN — a NaN here would render as an em dash on a screen
  // that had a perfectly good distance to show.
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * The box that holds every point given, as MapLibre wants it:
 * `[[west, south], [east, north]]`.
 *
 * **Longitude first in each pair.** That is GeoJSON's order and MapLibre's,
 * and it is the opposite of the `lat, lng` every other part of this app says —
 * which is exactly why `Coordinates` is named fields rather than a positional
 * pair. Uganda sits at ~0.3°N, ~32.6°E, so a swap here passes every range
 * check either number could face and frames the map on the Indian Ocean.
 *
 * A floor on the span, because two points a hundred metres apart give a box of
 * near-zero size, and fitting a map to that asks for infinite zoom — which
 * renders as a grey square. 0.004° is roughly 450 m, close enough to read a
 * junction.
 *
 * Returns null for an empty list: no points is no box, and a map given no box
 * keeps its own default rather than being told to show 0°,0° — a spot in the
 * Atlantic off Ghana that a driver would nonetheless believe.
 */
export function boundsFor(points: Coordinates[]): [[number, number], [number, number]] | null {
  if (points.length === 0) {
    return null;
  }

  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);

  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const padLat = Math.max((maxLat - minLat) * 0.25, 0.004);
  const padLng = Math.max((maxLng - minLng) * 0.25, 0.004);

  return [
    [minLng - padLng, minLat - padLat],
    [maxLng + padLng, maxLat + padLat],
  ];
}

/** A located place as the coordinate pair the rest of this module takes. */
export function toCoordinates(place: LocatedPlace): Coordinates {
  return { lat: place.latitude, lng: place.longitude };
}
